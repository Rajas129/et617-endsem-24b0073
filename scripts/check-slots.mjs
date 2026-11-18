/**
 * Diagnoses each model slot against the real provider using the keys in
 * .env.local. Prints the provider's actual status and error text. Never prints
 * a key — only whether one is present and its length.
 *
 *   node scripts/check-slots.mjs
 */
import { readFileSync } from "node:fs";

const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
} catch {
  console.log("Could not read .env.local — are you in the project root?");
  process.exit(1);
}

const PROMPT = 'Reply with exactly this JSON and nothing else: {"ok":true}';

async function hitGoogle(model, key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: PROMPT }] }],
      generationConfig: { maxOutputTokens: 40 },
    }),
  });
  return { status: res.status, body: await res.text() };
}

async function hitOpenRouter(model, key) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, messages: [{ role: "user", content: PROMPT }], max_tokens: 40,
    }),
  });
  return { status: res.status, body: await res.text() };
}

for (const n of [1, 2, 3]) {
  const provider = env[`SLOT${n}_PROVIDER`] ?? "(unset)";
  const model = env[`SLOT${n}_MODEL`] ?? "(unset)";
  const key = env[`SLOT${n}_API_KEY`] ?? "";

  console.log(`\n─── SLOT${n} ─────────────────────────────`);
  console.log(`  provider : ${provider}`);
  console.log(`  model    : ${model}`);
  console.log(`  key      : ${key ? `present (${key.length} chars, starts "${key.slice(0, 6)}…")` : "MISSING"}`);

  if (!key || model === "(unset)") { console.log("  RESULT   : skipped — not configured"); continue; }

  try {
    const r = provider === "google" ? await hitGoogle(model, key) : await hitOpenRouter(model, key);
    if (r.status === 200) {
      let text = "";
      try {
        const j = JSON.parse(r.body);
        text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("")
            ?? j?.choices?.[0]?.message?.content ?? "";
      } catch { /* ignore */ }
      console.log(`  RESULT   : ✅ 200 OK — replied ${JSON.stringify((text || "").trim().slice(0, 60))}`);
    } else {
      let msg = r.body;
      try { msg = JSON.parse(r.body)?.error?.message ?? msg; } catch { /* ignore */ }
      console.log(`  RESULT   : ❌ ${r.status} — ${String(msg).slice(0, 220)}`);
    }
  } catch (e) {
    console.log(`  RESULT   : ❌ network — ${e.message}`);
  }
}

// What models does this Google key actually have?
const gkey = [1, 2, 3].map((n) => env[`SLOT${n}_PROVIDER`] === "google" ? env[`SLOT${n}_API_KEY`] : null).find(Boolean);
if (gkey) {
  console.log("\n─── Gemma models this Google key can actually serve ───");
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(gkey)}&pageSize=200`);
    const j = await res.json();
    const names = (j.models ?? []).map((m) => m.name.replace("models/", ""));
    const gemma = names.filter((x) => x.toLowerCase().includes("gemma"));
    console.log("  " + (gemma.length ? gemma.join("\n  ") : "(no gemma models available to this key)"));
  } catch (e) { console.log("  could not list:", e.message); }
}
console.log();
