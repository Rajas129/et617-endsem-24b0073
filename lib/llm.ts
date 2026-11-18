/**
 * Provider layer.
 *
 * Three independently configured slots, each with its OWN api key and its OWN
 * model id. Separate keys are not redundancy theatre: free tiers are rate
 * limited per key, and the two phases of a turn fire back to back, so putting
 * them on different keys is what stops one 429 from taking down the round.
 *
 * Each phase prefers its own slot and falls through the others in order. If every
 * slot fails, the caller falls back to recorded content and the app keeps working.
 *
 * Deliberately plain `fetch` rather than an SDK: Gemma models support neither
 * structured output / response schemas nor function calling, and older Gemma has
 * no system role, so `generateObject`-style helpers cannot be used. One fewer
 * dependency also keeps the bundle small, which is the C1 constraint.
 */

export type Provider = "openrouter" | "google";
export type Role = "predict" | "adjudicate" | "build" | "chat";

export type Slot = {
  id: string;
  provider: Provider;
  key: string;
  model: string;
};

export type LLMResult = {
  text: string;
  provider: Provider;
  model: string;
  slot: string;
  bytes: number;
  ms: number;
};

export class LLMUnavailable extends Error {
  constructor(public attempts: string[]) {
    super("All model slots failed: " + attempts.join(" | "));
  }
}

/**
 * Why we ended up on recorded content. These are genuinely different situations
 * and the learner is told different things, so they are not collapsed into one
 * "offline" flag: a model that replied but rambled is not an outage.
 */
export type FailureKind = "unreachable" | "unparseable" | "busy";

/**
 * 429 and 503 are not outages — they are "come back in a minute". Telling a
 * learner the helpers are offline when they are merely busy sends her away for
 * the wrong reason, so this case gets its own message and its own advice.
 */
export function isBusy(attempts: string[]): boolean {
  if (!attempts.length) return false;
  return attempts.every((a) => / 429| 503|rate.?limit|high demand|overload/i.test(a));
}

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 20000);

/**
 * Total wall-clock budget for one callJSON, kept under the serverless function's
 * own limit so we always return something rather than being killed mid-chain.
 */
const DEFAULT_BUDGET_MS = Number(process.env.LLM_BUDGET_MS ?? 42000);

/** Extra token budget for OpenRouter, where a routed model may reason first. */
const ROUTER_HEADROOM = Number(process.env.OPENROUTER_HEADROOM ?? 3);

/**
 * Re-attaches the prefilled opening brace — but only when the model actually
 * continued from it.
 *
 * Providers differ: some honour an assistant prefill and return the remainder of
 * the object, others ignore it and return a complete object starting with "{".
 * Prepending blindly turns the second case into "{{…", which never parses. This
 * is what made the auto-router look broken when it was answering perfectly well.
 */
function rejoinPrefill(text: string, prefilled: boolean): string {
  if (!prefilled) return text;
  return text.trimStart().startsWith("{") ? text : "{" + text;
}

/**
 * Model ids are passed through to the provider verbatim and are never validated
 * here, so any id your account can serve will work the moment you set it. An id
 * the provider does not recognise returns 404 and the next slot takes over.
 */
function slots(): Slot[] {
  const read = (n: 1 | 2 | 3): Slot => ({
    id: `slot${n}`,
    provider: (process.env[`SLOT${n}_PROVIDER`] ?? "openrouter") as Provider,
    key: process.env[`SLOT${n}_API_KEY`] ?? "",
    model: process.env[`SLOT${n}_MODEL`] ?? "",
  });
  return [read(1), read(2), read(3)].filter((s) => s.key && s.model);
}

/** Which slot each phase reaches for first. The rest become its failover chain. */
function orderFor(role: Role): Slot[] {
  const all = slots();
  if (!all.length) return [];
  const pick: Record<Role, string | undefined> = {
    predict: process.env.PREDICT_SLOT ?? "1",
    adjudicate: process.env.ADJUDICATE_SLOT ?? "2",
    build: process.env.BUILD_SLOT ?? "3",
    chat: process.env.CHAT_SLOT ?? "3",
  };
  const preferred = Number(pick[role] ?? 1);
  const first = all.filter((s) => s.id === `slot${preferred}`);
  const rest = all.filter((s) => s.id !== `slot${preferred}`);
  return [...first, ...rest];
}

async function callOpenRouter(slot: Slot, prompt: string, maxTokens: number, prefill: boolean, budgetMs = TIMEOUT_MS): Promise<LLMResult> {
  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(Math.max(3000, budgetMs)),
    headers: {
      Authorization: `Bearer ${slot.key}`,
      "Content-Type": "application/json",
      "X-Title": "ET617 Food Web Council",
    },
    body: JSON.stringify({
      model: slot.model,
      messages: prefill
        ? [{ role: "user", content: prompt }, { role: "assistant", content: "{" }]
        : [{ role: "user", content: prompt }],
      // An auto-router such as "openrouter/free" picks whatever has capacity,
      // which is the point — but it can land on a reasoning model. Those spend
      // tokens thinking before they answer, so they need real headroom or they
      // hit the limit mid-thought and return content: null. Asking for low
      // reasoning effort is ignored by models that do not reason.
      max_tokens: Math.round(maxTokens * ROUTER_HEADROOM),
      temperature: prefill ? 0.35 : 0.6,
      reasoning: { effort: "low" },
    }),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`${slot.id} openrouter ${res.status}: ${raw.slice(0, 160)}`);

  const json = JSON.parse(raw);
  const choice = json?.choices?.[0];
  let text: string = choice?.message?.content ?? "";
  let fromReasoning = false;

  if (!text) {
    // A routed reasoning model returns content: null and puts everything in
    // `reasoning`. The answer we want is usually in there, so read it rather
    // than throwing away a response we were charged for.
    const reasoning: string = choice?.message?.reasoning ?? "";
    if (reasoning && reasoning.includes("{")) {
      text = reasoning;
      fromReasoning = true;
    } else {
      const why = reasoning
        ? `reasoned but never answered (finish_reason ${choice?.finish_reason})`
        : "empty completion";
      throw new Error(`${slot.id} openrouter: ${why}`);
    }
  }

  return {
    // Reasoning text already contains a whole object, so it is never rejoined.
    text: fromReasoning ? text : rejoinPrefill(text, prefill),
    provider: "openrouter",
    model: (json?.model as string) || slot.model,   // the router says what it picked
    slot: slot.id,
    bytes: Buffer.byteLength(raw) + Buffer.byteLength(prompt),
    ms: Date.now() - started,
  };
}

async function callGoogle(slot: Slot, prompt: string, maxTokens: number, prefill: boolean, budgetMs = TIMEOUT_MS): Promise<LLMResult> {
  const started = Date.now();
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${slot.model}:generateContent` +
    `?key=${encodeURIComponent(slot.key)}`;

  // No systemInstruction and no responseSchema: Gemma supports neither.
  //
  // Instead we PREFILL the model's own turn with "{". Gemma otherwise opens with
  // paragraphs of thinking-out-loud before any JSON ("* Context: ... wait, let"),
  // which parses to nothing. Starting its turn mid-object leaves it nowhere to
  // put a preamble. We put the "{" back on the front of what comes out.
  const contents: object[] = [{ role: "user", parts: [{ text: prompt }] }];
  if (prefill) contents.push({ role: "model", parts: [{ text: "{" }] });

  const res = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(Math.max(3000, budgetMs)),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature: prefill ? 0.35 : 0.6 },
    }),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`${slot.id} google ${res.status}: ${raw.slice(0, 160)}`);

  const json = JSON.parse(raw);
  const text = (json?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new Error(`${slot.id} google: empty completion`);

  return {
    text: rejoinPrefill(text, prefill), provider: "google", model: slot.model, slot: slot.id,
    bytes: Buffer.byteLength(raw) + Buffer.byteLength(prompt),
    ms: Date.now() - started,
  };
}

export async function callLLM(
  role: Role, prompt: string, maxTokens: number, prefill = false,
  deadline = Infinity, callTimeoutMs = TIMEOUT_MS,
): Promise<LLMResult> {
  const chain = orderFor(role);
  if (!chain.length) throw new LLMUnavailable(["no slot has both an API key and a model id"]);

  const attempts: string[] = [];
  for (const slot of chain) {
    // Walking a three-slot chain with a per-call timeout can outlast the
    // serverless function itself, which gets killed mid-request and returns
    // nothing at all. Stop early and fall back to recorded content instead.
    const left = deadline - Date.now();
    if (left < 3000) { attempts.push(`${slot.id}: skipped, out of time`); continue; }

    try {
      return slot.provider === "google"
        ? await callGoogle(slot, prompt, maxTokens, prefill, Math.min(left, callTimeoutMs))
        : await callOpenRouter(slot, prompt, maxTokens, prefill, Math.min(left, callTimeoutMs));
    } catch (err) {
      attempts.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new LLMUnavailable(attempts);
}

export type JSONResult<T> = {
  value: T | null;
  bytes: number;
  provider?: string;
  failure?: FailureKind;
  detail?: string;
};

/**
 * The single way the app asks a model for JSON.
 *
 * Prefills the opening brace, and if the reply still will not parse, retries once
 * down the whole chain with a blunter instruction. Centralised so the agent
 * pipeline, the web builder and the chat all get the same treatment — and so the
 * caller learns WHY it failed, since "the model rambled" and "the model is down"
 * need different things said to the learner.
 */
/** How long to wait for a slot before also starting the next one. */
const HEDGE_MS = Number(process.env.LLM_HEDGE_MS ?? 6000);

export async function callJSON<T>(
  role: Role, prompt: string, maxTokens: number,
  budgetMs = DEFAULT_BUDGET_MS, callTimeoutMs = TIMEOUT_MS,
): Promise<JSONResult<T>> {
  const deadline = Date.now() + budgetMs;
  const chain = orderFor(role);
  if (!chain.length) {
    return { value: null, bytes: 0, failure: "unreachable",
             detail: "no slot has both an API key and a model id" };
  }

  let bytes = 0;
  let provider: string | undefined;
  const failures: string[] = [];
  let sawReply = false;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * Hedged requests rather than strict sequential failover.
   *
   * Sequential looks tidy but fails badly here: a slot that HANGS rather than
   * erroring burns its whole timeout, and with three slots the request runs out
   * of budget before it ever reaches a healthy one. Measured, that is exactly
   * what happened — "slot3: skipped, out of time" while slot3 was working fine.
   *
   * So each slot starts HEDGE_MS after the one before it, they run concurrently,
   * and the first reply that actually parses wins. A stalled slot now costs a few
   * seconds of overlap instead of the entire budget. The preferred slot still
   * goes first and usually answers before any other is started, so the extra
   * calls only happen when something is genuinely slow.
   */
  async function attempt(text: string, tokens: number): Promise<T | null> {
    const left = () => deadline - Date.now();
    const runners = chain.map(async (slot, i) => {
      if (i > 0) await sleep(Math.min(i * HEDGE_MS, Math.max(left() - 4000, 0)));
      if (left() < 4000) throw new Error(`${slot.id}: out of time`);

      const res = await callLLM(
        role, text, tokens, true, deadline, Math.min(callTimeoutMs, left()),
      );
      bytes += res.bytes;

      const parsed = extractJSON<T>(res.text);
      if (!parsed) {
        sawReply = true;
        throw new Error(`${res.slot}(${res.model}): ${res.text.length} chars, no JSON`);
      }
      provider = `${res.slot} · ${res.provider}/${res.model}`;
      return parsed;
    });

    const results = await Promise.allSettled(runners);
    for (const r of results) {
      if (r.status === "fulfilled") return r.value;
      failures.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
    return null;
  }

  const first = await attempt(prompt, maxTokens);
  if (first) return { value: first, bytes, provider };

  // A blunter instruction can fix rambling; it cannot talk a 503 into answering.
  if (sawReply && deadline - Date.now() > 12000) {
    const strict = `${prompt}\n\nIMPORTANT: your entire reply must be one JSON object and nothing else.\nDo not explain. Do not think out loud. Do not use markdown. Start at the opening brace.`;
    const second = await attempt(strict, Math.round(maxTokens * 1.4));
    if (second) return { value: second, bytes, provider };
  }

  return {
    value: null, bytes, provider,
    failure: sawReply ? "unparseable" : isBusy(failures) ? "busy" : "unreachable",
    detail: failures.join(" | ").slice(0, 400),
  };
}

// ── Tolerant JSON parsing ──────────────────────────────────────────────────
// Gemma cannot be constrained to a schema, so it will wrap JSON in prose, fence it,
// use smart quotes or leave a trailing comma. We repair rather than fail, and the
// caller still falls back to recorded content if this returns null.

export function extractJSON<T>(text: string): T | null {
  const candidates: string[] = [];

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);

  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  candidates.push(text);

  for (const c of candidates) {
    const parsed = tryParse<T>(c);
    if (parsed) return parsed;
  }
  return null;
}

function tryParse<T>(s: string): T | null {
  for (const v of [s, s.trim(), repair(s)]) {
    try { return JSON.parse(v) as T; } catch { /* next */ }
  }
  return null;
}

function repair(s: string): string {
  return s
    .replace(/[“”]/g, '"')      // smart double quotes
    .replace(/[‘’]/g, "'")      // smart single quotes
    .replace(/,(\s*[}\]])/g, "$1")        // trailing commas
    .replace(/^\s*[^{\[]*/, "")           // prose before the object
    .replace(/[^}\]]*$/, "")              // prose after it
    .trim();
}

/**
 * Values that are the template showing through rather than an answer.
 *
 * A model handed a JSON shape with "..." in it will sometimes return the shape
 * verbatim. That passes a non-empty check and reaches the learner as a speech
 * bubble containing "...", so it has to be caught explicitly.
 */
const PLACEHOLDER = /^(\.{2,}|…+|<[^>]*>|\[[^\]]*\]|string|text|your answer|n\/?a|tbd|xxx+)$/i;

export function isPlaceholder(v: unknown): boolean {
  return typeof v !== "string" || PLACEHOLDER.test(v.trim());
}

export function clampText(s: unknown, max: number, fallback = ""): string {
  if (typeof s !== "string") return fallback;
  const t = s.trim().replace(/\s+/g, " ");
  if (!t || PLACEHOLDER.test(t)) return fallback;
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
