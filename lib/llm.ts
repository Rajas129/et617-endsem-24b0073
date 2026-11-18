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

async function callOpenRouter(slot: Slot, prompt: string, maxTokens: number, prefill: boolean): Promise<LLMResult> {
  const started = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
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
      max_tokens: maxTokens,
      temperature: prefill ? 0.35 : 0.6,
    }),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`${slot.id} openrouter ${res.status}: ${raw.slice(0, 160)}`);

  const json = JSON.parse(raw);
  const choice = json?.choices?.[0];
  const text = choice?.message?.content ?? "";
  if (!text) {
    // An auto-router can land on a reasoning model: content comes back null with
    // everything in `reasoning`, and finish_reason "length" means it never got
    // round to answering. Pin a concrete instruct model rather than a router.
    const why = choice?.message?.reasoning
      ? `reasoned but never answered (finish_reason ${choice?.finish_reason})`
      : "empty completion";
    throw new Error(`${slot.id} openrouter: ${why}`);
  }

  return {
    text: prefill ? "{" + text : text, provider: "openrouter", model: slot.model, slot: slot.id,
    bytes: Buffer.byteLength(raw) + Buffer.byteLength(prompt),
    ms: Date.now() - started,
  };
}

async function callGoogle(slot: Slot, prompt: string, maxTokens: number, prefill: boolean): Promise<LLMResult> {
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
    signal: AbortSignal.timeout(TIMEOUT_MS),
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
    text: prefill ? "{" + text : text, provider: "google", model: slot.model, slot: slot.id,
    bytes: Buffer.byteLength(raw) + Buffer.byteLength(prompt),
    ms: Date.now() - started,
  };
}

export async function callLLM(
  role: Role, prompt: string, maxTokens: number, prefill = false,
): Promise<LLMResult> {
  const chain = orderFor(role);
  if (!chain.length) throw new LLMUnavailable(["no slot has both an API key and a model id"]);

  const attempts: string[] = [];
  for (const slot of chain) {
    try {
      return slot.provider === "google"
        ? await callGoogle(slot, prompt, maxTokens, prefill)
        : await callOpenRouter(slot, prompt, maxTokens, prefill);
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
export async function callJSON<T>(
  role: Role, prompt: string, maxTokens: number,
): Promise<JSONResult<T>> {
  let bytes = 0;
  let provider: string | undefined;
  let detail = "";

  const attempts = [
    prompt,
    `${prompt}

IMPORTANT: your entire reply must be one JSON object and nothing else.
Do not explain. Do not think out loud. Do not use markdown. Start at the opening brace.`,
  ];

  for (const [i, text] of attempts.entries()) {
    try {
      const res = await callLLM(role, text, i === 0 ? maxTokens : Math.round(maxTokens * 1.4), true);
      bytes += res.bytes;
      provider = `${res.slot} · ${res.provider}/${res.model}`;
      const parsed = extractJSON<T>(res.text);
      if (parsed) return { value: parsed, bytes, provider };
      detail = `replied ${res.text.length} chars but no JSON in it`;
    } catch (err) {
      if (!(err instanceof LLMUnavailable)) throw err;
      // No point re-prompting when nothing answered: a blunter instruction cannot
      // fix a 503. Return straight away rather than burning a second full pass.
      return {
        value: null, bytes, provider,
        failure: isBusy(err.attempts) ? "busy" : "unreachable",
        detail: err.attempts.join(" | ").slice(0, 300),
      };
    }
  }

  return { value: null, bytes, provider, failure: "unparseable", detail };
}

/** Exposed for the About screen so the configuration is inspectable at a glance. */
export function slotSummary() {
  return slots().map((s) => ({ id: s.id, provider: s.provider, model: s.model }));
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

export function clampText(s: unknown, max: number, fallback = ""): string {
  if (typeof s !== "string") return fallback;
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return fallback;
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}
