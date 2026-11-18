# Food Web Council — ET 617 end-semester submission

Username - priya , password- frogs123

**Card:** P3 · P3-T4 · L5 · C1 · **24B0073**

A Class 7 activity on what happens to a food web when one species is removed.

The learner signs in, reads a short explanation of what a food chain is, names any animal she
likes, and the model builds a 3–5 stage food web around it — what it eats and what eats it.
She then takes a species out. Three AI agents take distinct educational roles, genuinely
disagree about what will happen, and she settles the argument by editing the web and
re-running the simulation. A separate "Ask Mira" chat is open the whole time for doubts.

See [DESIGN.md](DESIGN.md) for the learning design, [PRD.md](PRD.md) for the full spec,
and [DEPLOY.md](DEPLOY.md) for Vercel setup.

## Run it

```bash
npm install
cp .env.example .env.local   # add your keys
npm run dev
```

You need `APP_USERS` set before you can sign in. Past that, the app still runs with no model
keys: the simulator is local arithmetic, web generation falls back to a built-in web, and the
agents fall back to a labelled recorded conversation.

## Where the keys go

**`.env.local`**, next to `package.json`. `cp .env.example .env.local`, then fill in the
blanks. It is gitignored. On Vercel the same names go in **Project → Settings →
Environment Variables**.

### Sign-in

| Variable | Purpose |
|---|---|
| `APP_USERS` | accounts as `username:password` pairs, comma separated |
| `AUTH_SECRET` | signs the session cookie so it cannot be forged |

> **This is a classroom gate, not real authentication.** Passwords sit in an environment
> variable in plain text, there is no database, no reset flow and no rate limiting. What it
> does do properly: the password never reaches the browser, the session cookie is HMAC-signed,
> and the comparison is timing-safe. It exists so each learner's progress is saved separately —
> do not reuse it for anything that matters.

### Model slots

Three independent slots, each with its own key, provider and model.

| Variable | Purpose |
|---|---|
| `SLOT1_PROVIDER` / `SLOT1_API_KEY` / `SLOT1_MODEL` | Google AI Studio by default |
| `SLOT2_PROVIDER` / `SLOT2_API_KEY` / `SLOT2_MODEL` | Google AI Studio, second key |
| `SLOT3_PROVIDER` / `SLOT3_API_KEY` / `SLOT3_MODEL` | OpenRouter |
| `PREDICT_SLOT` / `ADJUDICATE_SLOT` / `BUILD_SLOT` / `CHAT_SLOT` | which slot each job prefers |

`SLOT*_PROVIDER` is `google` (keys from https://aistudio.google.com/apikey, bare model ids
like `gemma-4-31b-it`) or `openrouter` (https://openrouter.ai/keys, namespaced ids like
`google/gemma-3-27b-it:free`).

Separate keys are not redundancy theatre: free tiers are limited **per key**, and the phases
of a turn fire back to back, so putting them on different keys is what stops a single 429 from
taking down a round mid-viva. Each job prefers its own slot and falls through the others; if
all three fail, the app shows a labelled recorded conversation and the simulator keeps working.

Model ids are sent to the provider **verbatim** and never validated in code, so any id your
account can serve works the moment you set it. An unrecognised id returns 404 and the next
slot takes over.

## Why plain `fetch` instead of an AI SDK

Gemma supports neither structured output / response schemas nor function calling, and Gemma 2
has no system role at all. `generateObject`-style helpers therefore cannot be used: role
instructions go in the user turn and responses are parsed by a tolerant JSON extractor with a
repair pass (`lib/llm.ts`). Dropping the SDK also keeps the bundle small, which is the C1
constraint.

## Architecture

```
lib/auth.ts       classroom sign-in: env accounts, HMAC-signed cookie
lib/webgen.ts     builds a food web around the animal the learner names.
                  The model proposes STRUCTURE; all coefficients are computed in code.
lib/chat.ts       the "Ask Mira" doubt chat, separate from the council pipeline
lib/web.ts        the built-in web + the learner's edit operations (ground truth)
lib/simulate.ts   population model. Pure arithmetic, no AI, runs in the browser.
                  Also finds the "deciding assumption" that makes a disagreement decidable.
lib/agents.ts     the two-phase agent pipeline, conflict detector, verification guard,
                  and the deterministic Dr. Sen used on failure
lib/llm.ts        OpenRouter → Google → recorded fallback, plus tolerant JSON parsing
lib/feedback.ts   misconception feedback, written in code so it cannot drift
app/api/auth      login / logout / who am I
app/api/web       generate a food web from a named animal
app/api/chat      the doubt chat
app/api/turn      phase "predict" (Mira + Aarav, blind to the simulator)
                  phase "adjudicate" (Dr. Sen, the only agent who sees it)
```

Per learner round: the simulator runs **first**, Mira and Aarav predict **blind**, and Dr. Sen
adjudicates **last** against the numbers. That ordering is what makes the disagreement honest
and the facts checkable.

## How a generated web is made safe to simulate

The model is asked only for **structure**: plausible species, who eats whom, which trophic
stage each sits at. Every number that makes the simulation behave is computed in
`lib/webgen.ts`:

- diet shares normalised to sum to 1 per predator (the "main" food takes 0.55)
- predation dependency capped at 0.7 total per prey, keeping carrying capacity positive
- baselines from an abundance tier, growth rate from trophic level
- carrying capacities derived so the untouched web sits exactly at equilibrium

Asking a small model for coefficients that must satisfy those constraints produces a web that
drifts at rest and teaches nothing. Asking it whether a frog eats grasshoppers is a question it
answers well.

`ensureDecidable()` guarantees at least one predator with two food sources. Without one, no two
agents can disagree about something a single run settles, and the activity collapses into a
plain simulation.

## Checking the simulator

```bash
npx tsc lib/*.ts scripts/sim-check.ts --outDir /tmp/fw --module commonjs --target es2022 --moduleResolution node --skipLibCheck && node /tmp/fw/scripts/sim-check.js
```

Prints the control run (must be perfectly flat), the frog removal, the resolution experiment
and the predator-removal case.
