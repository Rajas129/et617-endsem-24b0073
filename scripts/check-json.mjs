import { readFileSync } from "node:fs";
const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i === -1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

// The shape the app actually asks for.
const REAL = `You are running two characters in a Class 7 science app about food webs.
Reply with JSON only. No explanation outside the JSON.

THE FOOD WEB RIGHT NOW
Species present: Grass, Grasshopper, Rat, Snake, Hawk.
Species removed by the learner: Frog.
Feeding arrows: Grass is eaten by Grasshopper; Frog is eaten by Snake; Rat is eaten by Snake.

THE QUESTION ON THE TABLE
What happens to the snakes now that the frogs are gone?

JSON shape:
{"intake":{"kind":"answer_attempt","claims":[],"proposedEdit":null,"misconceptionSignals":[]},
 "guide":{"say":"...","prediction":"...","nextAction":"..."},
 "colearner":{"say":"...","prediction":"...","stance":"disagree"}}`;

function extractJSON(text) {
  const cands = [];
  const f = text.match(/```(?:json)?\s*([\s\S]*?)```/i); if (f) cands.push(f[1]);
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a !== -1 && b > a) cands.push(text.slice(a, b + 1));
  cands.push(text);
  for (const c of cands) { try { return JSON.parse(c); } catch {} }
  return null;
}

async function run(n) {
  const provider = env[`SLOT${n}_PROVIDER`], model = env[`SLOT${n}_MODEL`], key = env[`SLOT${n}_API_KEY`];
  let status, raw = "", text = "";
  try {
    if (provider === "google") {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: REAL }] }], generationConfig: { maxOutputTokens: 420, temperature: 0.6 } }),
      });
      status = r.status; raw = await r.text();
      try { text = JSON.parse(raw).candidates?.[0]?.content?.parts?.map(p=>p.text).join("") ?? ""; } catch {}
    } else {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: REAL }], max_tokens: 420, temperature: 0.6 }),
      });
      status = r.status; raw = await r.text();
      try { const j = JSON.parse(raw); text = j.choices?.[0]?.message?.content ?? ""; } catch {}
    }
  } catch (e) { console.log(`SLOT${n}: network ${e.message}`); return; }

  const parsed = extractJSON(text);
  console.log(`\n─── SLOT${n} (${provider} / ${model}) — HTTP ${status}`);
  console.log(`  returned ${text.length} chars`);
  console.log(`  extractJSON -> ${parsed ? "✅ PARSED" : "❌ NULL  (this is what shows 'offline')"}`);
  if (parsed) console.log(`  guide.say: ${JSON.stringify(parsed.guide?.say ?? "(missing)").slice(0,110)}`);
  console.log("  RAW (first 320):\n" + (text.slice(0, 320) || "(((EMPTY)))").split("\n").map(l=>"    "+l).join("\n"));
  if (!text && status === 200) console.log("  FULL BODY:\n" + raw.slice(0, 500).split("\n").map(l=>"    "+l).join("\n"));
}

for (const n of [1,2,3]) await run(n);
console.log();
