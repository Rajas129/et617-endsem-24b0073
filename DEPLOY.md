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
