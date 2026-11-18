# PRD — Food Web Council
### ET 617 End-Sem · Card: **P3 · T4 · L5 · C1**

| Field | Value |
|---|---|
| **P — Problem** | P3 Multi-agent collaborative learning environment |
| **T — Topic** | **P3-T4** Food chains: effect of removing a species (Cl. 7) |
| **L — Learner context** | L5 Learner repeating the topic after failing it once; high anxiety, low self-efficacy |
| **C — Design constraint** | C1 Low bandwidth |
| **ID** | `<rollno>` — shown in footer of every screen + About |
| **Deploy** | `et617-<rollno>.vercel.app` · repo `et617-endsem-<rollno>` |

> Note on card: "Food chains: effect of removing a species" is **T4** in the P3 column, not T3. Declare P3-T4.

---

## 0. One-paragraph summary

**Food Web Council** is a text-only web app where a Class 7 learner builds and breaks a food web
and argues about what will happen with three AI agents who each do a different job. The learner
removes a species, *commits a prediction*, and a deterministic in-browser simulator runs the
cascade. Three agents — a Guide, a peer Co-learner, and an Evidence Checker — read the same
shared state, pass each other structured records, and sometimes **disagree**. When they do, the
app does not show two walls of text; it raises a *Two Views* card, makes the learner predict
which is right, and then resolves it by **editing the web and re-running the simulation**. The
learner is the tiebreaker; the simulator is the referee.

---

## 1. The core design decision: nothing about the topic is hardcoded

The app has no script. There is one **shared mutable state object** that all three agents read
and write, and every agent turn is generated *from that state*. Because the learner can change
the state in three different ways, the same app produces different later turns for different
learners.

### What the learner can mutate

| Learner action | What it changes | How later agent turns change |
|---|---|---|
| Remove / restore a species | `web.nodes[].alive` | Simulator produces a different cascade; all agents are briefed on the new `simResult` |
| **Add or delete a feeding link** ("but hawks also eat rats!") | `web.edges` | The *ground truth changes*. A claim that was wrong becomes right. This is the main lever. |
| Add a new species | `web.nodes` | New indirect paths appear; Co-learner's counter-cases retarget |
| Ask a free-text doubt | `learner.openThreads[]` | Becomes a queued obligation the Co-learner must raise on a later turn |
| Answer / explain in free text | `learner.misconceptions[].confidence` | Guide's scaffolding level and the Checker's probing both shift |

### The non-hardcoding rule

> **No agent prompt ever contains the correct answer as a string.**
> Agents receive the *current web* and the *simulator output* as JSON and must reason over it.
> If the learner deletes the snake→rat edge, no prompt edit is needed — the simulator returns a
> different cascade, and the agents' positions flip on their own.

This is also the D6 verification story: the simulator is computed first, in code, and every
factual agent claim is checked against it before the learner sees it.

### Learner-raised doubts steer the session (worked example)

Learner types: *"but what if the hawk eats rats too?"*

1. Intake classifies this as `web_edit_request` → proposes edge `rat → hawk`.
2. App asks the learner to confirm: **"Add this arrow and see what changes?"** (agency: the learner edits the model, not the AI).
3. Simulator re-runs. Rats now have a predator; the earlier "rats boom forever" result no longer holds.
4. Evidence Checker notes the *old* conclusion is now outdated and says so.
5. Co-learner's next counter-case is generated against the *new* topology — it asks about something
   that did not exist two turns ago.
6. The doubt is logged in `settled[]` as a thing the learner discovered, not a thing they got wrong.

---

## 2. The three agents

Agents are personas with **disjoint jobs, disjoint information, and disjoint authority**.

| | **Mira — the Guide** | **Aarav — the Co-learner** | **Dr. Sen — the Evidence Checker** |
|---|---|---|---|
| Educational role | Explains, scaffolds, lowers anxiety | Challenges reasoning, raises counter-cases, voices doubts | Evaluates evidence against the simulation, gives feedback, closes loops |
| Tone | Warm, short sentences, Class-7 vocabulary | Curious classmate, informal, **sometimes wrong** | Neutral, cites numbers from the sim |
| Sees | `verdict`, `learnerModel`, `web` | `verdict`, Mira's draft, `learnerModel`, `web` | `web`, **`simResult`**, learner's raw utterance |
| Does **not** see | raw `simResult` (so she can be wrong) | raw `simResult` (so he can be wrong) | — |
| May decide "what to do next" | **Yes (sole authority)** | No | No |
| May assert what will happen | Yes | Yes | Yes, and only he is checked |

**Why Aarav is a peer and not an examiner** — this is an L5 decision. A learner repeating the topic
after failing cannot absorb a third adult voice telling them they are wrong. Aarav is a classmate
who is *also* unsure, who is wrong roughly a third of the time, and whose wrongness is visible to
the learner. The learner spends the session watching someone like them be wrong without
consequence, which is the point.

---

## 3. Collaboration protocol — how the agents exchange information

Agents never free-talk to each other. They write **typed JSON records to a blackboard** in a fixed
order. This keeps payloads tiny (C1), keeps every factual claim checkable (D6), and makes the
whole exchange inspectable in the viva.

### Per-turn pipeline

```
learner utterance
   │
   ├─1. INTAKE (deterministic rules + 1 cheap LLM call, strict JSON)
   │     → { kind: answer_attempt | doubt | web_edit_request | help_request,
   │         claims: [...], proposedEdit?: {...}, misconceptionSignals: [...] }
   │
   ├─2. SIMULATOR  (pure TypeScript, client-side, NO AI)   ◄── ground truth
   │     → simResult { series[], cascade[], indirectEffects[], assumptionsThatMatter[] }
   │
   ├─3. EVIDENCE CHECKER  (LLM call A — sees simResult)
   │     → verdict { perClaim: [{claim, status: supported|contradicted|depends_on_assumption,
   │                              evidence: "snake 40→26 by step 6"}],
   │                 keyAssumption: "snake has alternate prey (rat)" }
   │
   ├─4. GUIDE + CO-LEARNER  (LLM call B — ONE call, two outputs, both blind to simResult)
   │     Guide    → { say, scaffoldLevel, nextAction }
   │     Co-learner → { say, stance: agree|disagree|probe, targetProposition }
   │
   ├─5. CONFLICT DETECTOR  (deterministic)
   │     if co-learner.stance == "disagree" AND same targetProposition as guide
   │        AND the proposition is simulator-decidable
   │     → render TWO VIEWS CARD instead of two chat bubbles
   │
   └─6. STATE WRITE-BACK
         misconception confidences, openThreads, settled[], testedAssumptions[]
```

**Why Guide and Co-learner share one LLM call:** C1. Three sequential round-trips is three times the
latency and payload on a slow connection. One call returns both agent objects, and because the
Co-learner's slot is generated *after* the Guide's in the same output, he still sees and can
contradict her draft. Sequential dependency is preserved; the network cost is halved. **Two LLM
calls per learner turn, total.**

### The blackboard (shared state)

```ts
type Session = {
  web: { nodes: Species[]; edges: Edge[] };        // learner-editable ground truth
  simResult: SimResult | null;                      // recomputed after every edit
  learner: {
    name: string;
    misconceptions: { id: 'linear-chain' | 'predator-removal-is-good';
                      confidence: number }[];       // 0..1, updated every turn
    openThreads: { id: string; doubt: string; raisedAt: number; addressed: boolean }[];
    predictions: { proposition: string; learnerGuess: string; outcome: string }[];
  };
  settled: { question: string; answer: string; howWeKnow: string }[];
  openDisagreement: Disagreement | null;            // invariant: at most ONE
};
```

### Conflict policy — three invariants

1. **At most one open disagreement at a time.** If one is unresolved, the Co-learner's stance is
   forced to `probe`. Confusion comes from *stacked* unresolved conflicts, not from one.
2. **Agents may disagree about predictions. They may never disagree about instructions.**
   Only Mira issues `nextAction`. The learner is never told two different things to do.
3. **Every disagreement must be simulator-decidable.** If the conflict detector cannot map it to a
   runnable experiment, it is suppressed and downgraded to a probe. No unresolvable arguments.

### Learner agency

- The learner **commits a prediction before** the simulation runs (and before seeing who was right).
- The learner **chooses the experiment** that settles it.
- The learner may **side with neither** agent ("I think you're both wrong") — a first-class button.
- Resolutions accumulate in **"What we settled"**, attributed to the learner.

---

## 4. The required disagreement moment (D5 / design challenge)

### The web (starting state)

```
Grass ──► Grasshopper ──► Frog ──► Snake ──► Hawk
  └─────► Rat ──────────────────────┘ (rat → snake)
  Decomposers ◄── all
```
Snake diet shares: **frog 0.6, rat 0.4.**

### The moment

Learner removes **Frog** and predicts: *"Snakes will die because they eat frogs."*

> **Aarav (Co-learner):** "I agree with you, actually. No frogs means snakes have nothing to eat. I think the snakes crash to almost zero."
>
> **Mira (Guide):** "I don't think they crash. Look at the arrows again — snakes also eat rats. I think snakes dip a little and then hold steady."

Conflict detector fires: same proposition (`snake population after frog removal`), opposite
predictions, simulator-decidable.

### What the learner sees

```
┌────────────────────────────────────────────┐
│  ⚡ Mira and Aarav disagree                │
│                                            │
│  AARAV says:  snakes crash to near zero    │
│  MIRA says:   snakes dip, then hold        │
│                                            │
│  You decide. What do you think happens?    │
│  [ Aarav is right ] [ Mira is right ]      │
│  [ Both are wrong ] [ I'm not sure yet ]   │
│                                            │
│  then →  [ Run 10 generations ]            │
└────────────────────────────────────────────┘
```

### The resolution

Simulator output: snakes fall 40 → 26 by step 4, **recover to 33 by step 10** (the rat edge carries
them) — then dip again at step 12 as grass crashes under the grasshopper boom and rats decline too.

> **Dr. Sen (Evidence Checker):** "Here are the numbers. Snakes went 40 → 26, then back up to 33.
> So Aarav was wrong that they crash — but Mira was also not fully right, because they dipped again
> later. **Both of you missed something.** The real reason snakes survived is one arrow: snake → rat.
> That arrow is the whole argument.
>
> So let's settle it properly. **Delete the snake → rat arrow and run it again.**"

Learner deletes the edge, re-runs: **snakes crash to 4.**

> **Dr. Sen:** "Now Aarav is right. Neither of them was wrong about ecology — they were assuming
> different webs. In a web with backup food, removing one prey is survivable. Without it, it isn't."
>
> **Aarav:** "Oh. So I wasn't wrong, I was just thinking of a simpler chain than the one we had."
>
> **Mira:** "That's the real lesson, and you found it by running it. Let's write it down."

**Settled card added:** *"A predator survives losing one prey only if it has another prey. We know
because we deleted the snake→rat arrow and snakes crashed from 33 to 4."*

**Why this answers the design challenge.** The disagreement is never left hanging, never resolved by
authority, and never confusing — it is converted into one runnable experiment with a binary
outcome. The learner performs the resolution. And because both agents turn out to be
conditionally right, the learner learns that the *assumption* was the real subject, which is the
actual Class 7 learning objective about indirect effects.

---

## 5. Learner persona (D2)

**Priya Kamble, 13, Class 7.** Zilla Parishad school, semi-urban Maharashtra; Marathi at home,
simple English at school. Repeating the Life Processes / ecosystems unit after failing the Class 7
science exam last term.

- **Prior knowledge:** can read a single food chain left-to-right and name producer/consumer/decomposer. Cannot handle a *web* (multiple arrows into one animal). Does not connect plants to animal populations.
- **Misconception 1 — "linear chain":** removing a species only affects the animal **directly above** it. ("Frogs gone → snakes affected. Grass is fine, it's far away.")
- **Misconception 2 — "predator removal is good for prey":** removing a predator just means more prey, and more is good. (Misses overgrazing → food crash → prey collapse.)
- **Device / time:** parent's 3-year-old Android, Chrome, 360 px, patchy 3G. ~15 min at a time in the evening.
- **Motivation:** low. Wants to not fail again. Believes she is "bad at science". Stops immediately if she feels tested.
- **Affect:** freezes on red marks and on scores. Will not type a free-text answer if she thinks it will be graded.

### How L5 shaped the design (for D7)

| L5 trait | Design response |
|---|---|
| High anxiety | No score, no timer, no streak, no red X. Wrong predictions are called "a guess worth making". |
| Low self-efficacy | Aarav is wrong ~1 in 3 turns, visibly. She is not the only one who gets things wrong. |
| Failed before | "What we settled" list grows all session — visible evidence of competence, attributed to her. |
| Won't type if graded | Every free-text box is labelled "thinking out loud — not marked". |
| Afraid of being tested | Predictions are *commitments*, not questions. Framed as "what scientists do first". |
| Repeating the topic | No re-teaching from zero. Diagnostic first turn finds what she already has. |

Language level is deliberately held at short declarative sentences, familiar vocabulary, active
voice and "let's / we" — targeting the **C3 language comprehensibility** and **P5 cognitive
engagement** rubric rows.

---

## 6. C1 — low bandwidth, visibly satisfied (D4 / D7)

| Requirement | Implementation |
|---|---|
| Core activity on a slow connection | **The simulator is client-side and needs zero network.** Building the web, removing species, predicting and running 10 generations all work fully offline. AI is commentary on top, never load-bearing. |
| No media over 1 MB | **Zero images, zero audio, zero video, zero webfonts.** Food web is inline SVG (<20 KB), system font stack. Target first load < 150 KB gzipped. |
| Clear fallback when an AI call fails | On timeout/429/5xx: a banner — *"Mira, Aarav and Dr. Sen are offline. Here's a saved example conversation, and you can keep running experiments."* Pre-recorded agent bundle for the frog-removal path, **labelled as recorded**, plus the simulator stays fully live. |
| Visible to the examiner | Footer shows **`Data used this session: 41 KB`** (live byte counter) and a **"Low-data mode: ON"** indicator. One API round-trip = one visible counter tick. |

Additional C1-driven choices: 2 LLM calls per turn instead of 4 (see §3); streamed responses with
skeleton text; `maxOutputTokens` capped per agent (Mira 120, Aarav 70, Dr. Sen 150) so replies are
short — which *also* serves Priya's reading level; state persisted to `localStorage` so a dropped
connection never loses the session.

---

## 7. Learning design

### Outcomes (D1, measurable)

1. **Predict** the effect of removing one species on at least two species that are *not* adjacent to it in the web.
2. **Explain** why a predator may survive the loss of one prey species, referring to alternate feeding links.
3. **Compare** two conflicting predictions and identify the assumption that distinguishes them.

### Activity sequence (10–15 min, resumable)

1. **Diagnostic (1 turn).** "Grass, grasshopper, frog, snake. If all the frogs disappear, who else changes?" → classifies both misconceptions immediately and sets `scaffoldLevel`.
2. **Explore the web.** Tap any species → see what it eats and what eats it.
3. **Predict & remove.** Commit a prediction, then remove a species.
4. **The disagreement.** Two Views card → learner decides → simulation → Dr. Sen closes the loop.
5. **Learner's own experiment.** Learner edits an edge or species and re-runs. Agents respond to the new topology.
6. **Settle.** "What we settled" updated; resume point saved.

### 5 tasks in 3 formats (D3)

| # | Format | Task | Targets |
|---|---|---|---|
| 1 | Multi-select | "Frogs are gone. Tick everyone who changes." (correct: grasshopper, snake, **grass**, rat) | Misconception 1 |
| 2 | Prediction commit | "Will snakes crash or hold? Commit before we run it." | Outcome 1 |
| 3 | Free-text explanation | "Snakes survived. Why?" → evaluated against `simResult` | Outcome 2 |
| 4 | Web edit (manipulation) | "Change one arrow so snakes *do* crash." | Outcome 3 |
| 5 | Adjudication | "Mira and Aarav disagree. Who's right, and what would settle it?" | Outcome 3 |

### Feedback (D3) — exact text

- **Correct (task 1):** *"You got grass too. That's the hard one — most people stop at snakes. Grass changed because nothing was eating the grasshoppers any more."*
- **Misconception 1 fires** (ticked only snake): *"Snake is right. But let's follow it further — if frogs are gone, who stops eating grasshoppers? And then what happens to the grass? Run it and watch the grass line."* → simulator highlights the grass curve. Never told the answer; shown the cascade.
- **Misconception 2 fires** ("more grasshoppers is good"): *"Grasshoppers did boom — you were right about that. Watch what happens at step 8 though. Why do you think they crashed after booming?"* → the overshoot is the teacher.

---

## 8. Screen map (D4, 7 screens/states)

1. **Home** — "Continue where you left off" / fresh start. Identity token.
2. **Web Explorer** — SVG food web, tap a species for its links. Edit mode (add/delete arrow, add species).
3. **Predict** — commit a prediction before removing a species.
4. **Council** — the three-agent conversation; includes the **Two Views** card state.
5. **Simulation** — 10-generation population chart (inline SVG), cascade step list, "what surprised you?".
6. **What we settled** — accumulated findings + resume point.
7. **About** — identity token, AI disclosure, offline-mode toggle, data counter.

Required transitions: Explorer → Predict → Council → Two Views → Simulation → Council → Settled,
with Explorer reachable from Council at any time (learner-initiated edits).

---

## 9. Technical specification

```
Next.js (App Router) + TypeScript + Tailwind
Vercel AI SDK (`ai` + `@ai-sdk/google`)  — Gemini free tier
Zod                                      — strict agent output schemas
Inline SVG                               — web + charts (no chart library)
localStorage                              — resume (C1)
```

- `lib/web.ts` — default food web; node/edge types; learner edit operations.
- `lib/simulate.ts` — **pure, no AI.** Discrete-time update per species:
  `delta = r * p * (foodScore - predPressure - p/K)` where
  `foodScore = Σ dietShare * (prey.p / prey.baseline)` and
  `predPressure = Σ (pred.p / pred.baseline) * dependency`.
  Run 12 steps. Also returns `indirectEffects` (species ≥2 hops from the removal that moved >15%)
  and `assumptionsThatMatter` (edges whose deletion flips a sign) — the latter is what generates
  decidable disagreements.
- `app/api/turn/route.ts` — the pipeline in §3. Two `generateObject` calls, Zod-validated. **Guard:
  if the Checker's verdict contradicts `simResult`, discard and fall back to a templated numeric
  summary** (D6 output check).
- `lib/fallback.ts` — recorded agent bundle for offline mode.
- Env: `GOOGLE_GENERATIVE_AI_API_KEY` as a Vercel environment variable. Never committed.

---

## 10. Evaluation plan (D8)

| Outcome | Assessment item | Log data | Success threshold |
|---|---|---|---|
| 1 Predict non-adjacent effects | Task 1 multi-select, post-activity on a *new* web | `nonAdjacentSpeciesTicked`, pre vs post | ≥60% of learners name ≥1 non-adjacent species post, from a ≤20% pre baseline |
| 2 Explain predator survival | Task 3 free-text, 3-level rubric (no link / names link / explains dependence) | stored explanation text + rubric score | ≥50% reach level 3 |
| 3 Identify the deciding assumption | Task 4 (edit an arrow to flip the outcome) | `editsAttempted`, `flippedOutcome` bool, time-to-first-edit | ≥40% flip it within 3 edits |

Also logged: turns to first self-initiated web edit (agency), Two-Views choice distribution
(are learners just siding with the authority figure?), `settled[]` length at exit, abandonment
point, and — for L5 specifically — free-text submission rate (does the "not marked" framing work?).

**Instrumentation caveat for the report:** adaptivity based on interaction logs (rubric P13_CP point 3)
is designed into `learner.misconceptions[].confidence`, which updates from response *and*
help-request counts — i.e. profile + performance + interaction, targeting the "at least 2 of 3"
exemplary band.

---

## 11. Build order (2 hours)

| Time | Build | Checkpoint |
|---|---|---|
| 0:00–0:10 | Repo created, `create-next-app`, declare card on the Excel sheet | repo timestamped after start |
| 0:10–0:30 | Write `DESIGN.md` from §1/§5/§7 of this PRD | **DESIGN.md committed by 0:30** |
| 0:30–0:50 | `lib/web.ts` + `lib/simulate.ts` + SVG web render. **Works with no AI at all.** | commit |
| 0:50–1:00 | Deploy to Vercel | **first deploy live by 1:00** |
| 1:00–1:20 | `/api/turn` pipeline, Zod schemas, three agent prompts | commit |
| 1:20–1:35 | Two Views card, conflict detector, "What we settled", footer identity + data counter, offline fallback | commit, redeploy |
| 1:35–1:55 | Run both D5 scenarios on the live app, screenshot, write the report | final deploy |
| 1:55–2:00 | Moodle submit | — |

**Risk order:** the simulator ships before any AI. If Gemini dies, the app is still a working
interactive ecology lab with a labelled recorded conversation, and D6 still specifies real AI
behaviour — which §6 of the exam paper explicitly permits.

---

## 12. Open items

- Confirm current Gemini free-tier rate limits before relying on 2 calls/turn.
- Pick the final species set (6–8 nodes keeps the SVG readable at 360 px).
- Decide whether Aarav's wrongness rate is prompt-controlled or deterministically scheduled (deterministic is easier to demo in the viva).
- This planning conversation goes in the **AI-use log**.
