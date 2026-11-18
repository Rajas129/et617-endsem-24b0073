# Deploying to Vercel

The repo is connected, so every push to `main` triggers a deploy. Two things must be done in
the Vercel dashboard before the app works.

---

## 1. The URL must be `et617-24b0073.vercel.app`

**This is graded.** Deliverable D4 requires the app at `et617-<rollno>.vercel.app`. The repo is
named `et617-endsem-24b0073`, so Vercel's default URL will be
`et617-endsem-24b0073.vercel.app` — **the wrong address**.

Fix it one of two ways:

- **Rename the project.** Settings → General → Project Name → `et617-24b0073`. Vercel reassigns
  the `.vercel.app` subdomain to match. Simplest option.
- **Or add the domain.** Settings → Domains → Add → `et617-24b0073.vercel.app`.

Then confirm the address actually resolves before you submit the Moodle link.

---

## 1b. Framework preset must be "Next.js"

If the build fails with:

```
Error: [STATIC_BUILD_NO_OUT_DIR] No Output Directory named "public" found
```

Vercel is treating this as a **static site**, not a Next.js app — it ran the build and then
went looking for a `public/` folder to publish. This happens when the project was connected to
Vercel while the repo still had no `package.json`: Vercel detected "Other" then and does not
re-detect later.

`vercel.json` in the repo root now declares the framework, and settings there override the
dashboard:

```json
{ "framework": "nextjs" }
```

If it still fails after that, set it by hand: **Settings → Build and Deployment →
Framework Preset → Next.js**, and make sure **Root Directory** is empty (not `app`, not `src`).

> **Do not "fix" this by creating an empty `public/` directory.** The error goes away because
> Vercel then has something to publish — a blank static site, with none of the app and none of
> the API routes. Next.js does not need a `public/` folder; this project deliberately ships no
> static assets at all (C1).

---

## 2. Environment variables

Settings → Environment Variables. Tick **Production**, **Preview** and **Development** for each.

| Name | Value |
|---|---|
| `APP_USERS` | `learner:yourpassword,teacher:anotherpassword` |
| `AUTH_SECRET` | a long random string — see below |
| `SLOT1_PROVIDER` | `google` |
| `SLOT1_API_KEY` | your first Google AI Studio key |
| `SLOT1_MODEL` | `gemma-4-31b-it` |
| `SLOT2_PROVIDER` | `google` |
| `SLOT2_API_KEY` | your second Google AI Studio key |
| `SLOT2_MODEL` | `gemma-4-26b-it` |
| `SLOT3_PROVIDER` | `openrouter` |
| `SLOT3_API_KEY` | your OpenRouter key |
| `SLOT3_MODEL` | `google/gemma-3-27b-it:free` |
| `PREDICT_SLOT` | `1` |
| `ADJUDICATE_SLOT` | `2` |
| `BUILD_SLOT` | `1` |
| `CHAT_SLOT` | `3` |
| `LLM_TIMEOUT_MS` | `20000` |
| `NEXT_PUBLIC_ROLL_NO` | `24B0073` |

Generate a secret:

```bash
openssl rand -hex 32
```

### Two that are not optional

- **`AUTH_SECRET`** — the development fallback is published in this public repo, so in
  production the app refuses to use it. Without this variable, sign-in returns
  *"The server is missing AUTH_SECRET"* and nobody can get in. This is deliberate: silently
  accepting forgeable session cookies would be worse than failing.
- **`APP_USERS`** — without it there are no accounts and sign-in says so.

`NEXT_PUBLIC_ROLL_NO` is read at **build time**, so changing it needs a redeploy, not just a
restart. It falls back to `24B0073` in code, so the identity token is correct either way.

---

## 3. After the first deploy

Check these in order — each one isolates a different layer:

1. **The app loads and the footer shows `24B0073`.** → the build and the static shell are fine.
2. **You can sign in** with a pair from `APP_USERS`. → `AUTH_SECRET` and `APP_USERS` are set.
3. **Name an animal and the web builds.** If the offline banner appears instead, the model
   slots are failing — the app falls back to a built-in web rather than erroring, so this is
   the symptom to watch for. Check Vercel → Deployments → Functions → `/api/web` logs for the
   provider's actual error (a wrong model id shows up as a 404).
4. **Remove a species and run it.** This needs no network at all — if it works while step 3
   fails, the problem is definitely the keys and not the app.

## Model ids

They are sent to the provider verbatim and never validated in code, so whatever your account
serves will work. An id the provider does not recognise returns 404 and the next slot takes
over, which is why a wrong id shows up as "offline" rather than a crash.

## If a function times out

`/api/web` is capped at 45s and the others at 30s, inside Vercel's 60s limit. A slow free-tier
model can still exceed `LLM_TIMEOUT_MS` (20s) — that is by design on a low-bandwidth brief:
fail fast to the fallback rather than leave the learner on a spinner. Raise it if your models
are consistently slower.

---

## Diagnosing "the helpers are offline"

`node scripts/check-slots.mjs` tests every slot against the real provider using the keys in
`.env.local` and prints the actual status. It never prints a key. It also lists the Gemma model
ids your Google key can genuinely serve, which is the fastest way to catch a typo in a model id.

`node scripts/check-json.mjs` goes one step further and shows whether the reply actually parses
as JSON — the case where the model answers but rambles.

### The three different causes, and what each looks like

| Banner | Cause | What to do |
|---|---|---|
| "very busy right now" | every slot returned 429 or 503 | wait a minute; nothing is broken |
| "got muddled" | a model replied, but not with JSON | the prompt or model needs attention |
| "can't be reached" | network, bad key, or wrong model id | run `check-slots.mjs` and read the status |

A **404** from `check-slots.mjs` means the model id is wrong. Google ids are bare
(`gemma-4-31b-it`); OpenRouter ids are namespaced (`google/gemma-4-31b-it:free`). The two are
not interchangeable.

### Gemma 4 is heavily loaded

At the time of writing both Google AI Studio Gemma 4 endpoints frequently return
*"This model is currently experiencing high demand"*, and the OpenRouter `:free` route is rate
limited. The app degrades correctly — the simulator never needs the network and every number
stays real — but the agents will fall back often.

If you have OpenRouter credit, the single most effective change is to point one slot at the
**paid** route, which is not subject to the free tier's limits:

```
SLOT3_MODEL=google/gemma-4-31b-it
```

(no `:free` suffix). Keeping one paid slot in the chain is the difference between the agents
working during a viva and showing a recorded conversation.

### Avoid auto-routers

`openrouter/free` is an auto-router and can land on a reasoning model, which returns
`content: null` with everything in `reasoning` and `finish_reason: "length"` — it reasons until
it runs out of tokens and never answers. Pin a concrete instruct model instead.
