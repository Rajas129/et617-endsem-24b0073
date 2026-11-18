# DESIGN.md — Food Web Council

**Card:** P3 (multi-agent) · **P3-T4** Food chains: effect of removing a species (Cl. 7) ·
L5 (repeating the topic after failing once, high anxiety) · C1 (low bandwidth) · **24B0073**

Live: `et617-24b0073.vercel.app` · Repo: `et617-endsem-24b0073`

---

## D1 · The educational problem

Class 7 learners can read a single food chain left to right, but they treat it as a line
rather than a web. When one species is removed they predict an effect only on the animal
immediately next to it, and they assume removing a predator is straightforwardly good for
its prey. Both ideas survive ordinary teaching because a textbook diagram is static: there
is no way to pull a species out and watch what happens three arrows away. A learner who has
already failed this unit once has also learned to expect being told she is wrong, so any
design that feels like a test will stop her before the content does.

**Measurable outcomes**

1. **Predict** the effect of removing one species on at least two species that are *not*
   adjacent to it in the web.
2. **Explain** why a predator may survive losing one prey species, referring to its
   alternate feeding links.
3. **Compare** two conflicting predictions and identify the assumption that separates them.

**Context of use.** On her own, away from the classroom where she failed, on a phone or a
shared computer over an unreliable connection. She works through it as many times as she
wants before the re-test.

> **Constraint note.** Our card is **C1 (low bandwidth)**. Session length is C4 and
> one-handed mobile layout is C3 — neither is our constraint, and nothing in this design is
> justified by them. The app has no timer and makes no claim about how long a sitting is.

---

## D2 · Learner persona

**Seed: L5 — a learner repeating the topic after failing it once; high anxiety, low
self-efficacy.** Expanded, and expanded *only* from that seed.

**Priya Kamble, 13.** Repeating Class 7 science after failing the ecosystems unit last term.
She has sat through this exact topic before, which shapes everything below.

- **Prior knowledge.** Not a beginner, and this matters: she has already been taught food
  chains once. She names producer, consumer and decomposer correctly and reads a single chain
  left to right. What did not survive the first attempt is the *web* — two arrows arriving at
  one animal — which is precisely what she was tested on and failed.
- **Misconception 1 — linear chain.** Removing a species affects only the animal directly
  above it. *"Frogs gone, so snakes. Grass is far away, grass is fine."*
- **Misconception 2 — predator removal is good.** Removing a predator simply means more prey,
  and more is good. Misses the overgrazing crash that follows the boom.
- **Language.** Simple English. Under stress she re-reads the same sentence and stops, so
  every sentence she is shown is short and plainly worded.
- **Device.** A phone or a shared computer on a connection she cannot rely on.
- **Time.** Unbounded and self-paced. She may repeat the activity as often as she likes
  before the re-test; nothing in the app is timed or capped.
- **Motivation.** Low and defensive. She is not trying to learn ecology, she is trying not to
  fail again — so the activity has to be worth doing before it is worth finishing.
- **Affect.** The defining trait. She has already been publicly wrong about this topic. She
  freezes at scores and red marks, will not type into a box she thinks is graded, and reads
  any confident correction as evidence that she is bad at science. Being wrong a second time
  is the thing she is protecting herself against, so the design has to make being wrong
  survivable before it can make it useful.

---

## D3 · The learning activity

A seven-species web: Grass, Grasshopper, Rat, Frog, Snake, Hawk, Decomposers. The snake eats
frogs (0.55 of its diet) **and rats** (0.45). That one split is the whole lesson.

**Sequence.** Explore the web → tick who you think changes → commit a prediction → the three
helpers respond and two of them disagree → you decide who is right → run 12 generations →
the Evidence Checker reports the numbers → you delete the deciding arrow and run it again.

**Five tasks in four formats**

| # | Format | Task | Targets |
|---|---|---|---|
| 1 | Multi-select | "Tick everyone who changes." Correct: Grasshopper, Snake, **Grass**, **Hawk** | Misconception 1 |
| 2 | Prediction commit | "Do the snakes die out, drop, hold, or rise?" | Outcome 1 |
| 3 | Free text | "Snakes survived. Why?" — read against the simulation | Outcome 2 |
| 4 | Model edit | "Delete one arrow so the snakes *do* die out." | Outcome 3 |
| 5 | Adjudication | "Mira and Aarav disagree. Who is right, and what would settle it?" | Outcome 3 |

**Verified results** (from the simulator, not estimates):

- Remove Frog → Grasshopper 60 → **188** (boomed), Snake 40 → **19**, **Grass 100 → 58**,
  Hawk 20 → 16. Grass and Hawk are two hops away and still move.
- Same removal with the Rat → Snake arrow deleted → Snake 40 → **0**, extinct.
- Remove Snake → Rat 40 → **91** (boomed), but **Grasshopper 60 → 11**: the boom turns into a
  crash two hops down. This is misconception 2 defeated by the learner's own experiment.

**Feedback, written in code so it cannot drift**

- *Correct:* "You got Grass and Hawk too. That's the hard one — most people stop at the animal
  right next to the frog."
- *Misconception 1 fires:* "Snake is right — good. But let's keep going down the arrows. If the
  frogs are gone, who stops being eaten? And then what happens to what they eat? Look at Grass
  and Hawk." She is shown the cascade, never told the answer.
- *Misconception 2 fires:* "Grasshopper did boom — up to 196 around step 8. But look at Grass:
  100 → 58. More grasshoppers was not simply good news. Why do you think Grass dropped?"

---

## D7 (summary) · Why it is built this way

**Three agents, disjoint authority.** Mira guides and is the only one who may say what to do
next. Aarav is a classmate who challenges and is deliberately wrong about a third of the time.
Dr. Sen is the only agent who sees the simulation; every factual claim he makes is checked
against it before the learner sees it, and a claim that contradicts the numbers is thrown away
and replaced by a summary generated from the simulation itself.

**The design challenge — conflicting advice.** Three invariants: at most one open disagreement
at a time; agents may disagree about *predictions* but never about *instructions*; and every
disagreement must be decidable by one simulator run, or it is suppressed. A conflict is rendered
as a single **Two Views** card with four options including "they're both wrong", and it resolves
only when the learner runs the experiment. In the worked case Aarav says the snakes die out,
Mira says they survive — the truth is 19, so Mira is right; then the learner deletes the
Rat → Snake arrow, the snakes hit 0, and **Aarav turns out to be right after a change she made.**
Neither agent was foolish; they were picturing different webs.

**L5 — repeating after failing, high anxiety, low self-efficacy.** Every choice below comes
from that seed and nothing else.

| L5 trait | Design response |
|---|---|
| Has already failed this topic | No re-teaching from zero. The first turn is diagnostic: it finds what survived the first attempt and starts there. |
| High anxiety | No score, no timer, no streak, no red X. A wrong prediction is called "a guess worth making". |
| Low self-efficacy | Aarav is a peer who is visibly wrong about a third of the time. She watches someone like her be wrong without consequence before she risks it herself. |
| Expects to be told she is wrong | Nobody corrects her. The simulation shows her, and she is the one who runs it. |
| Will not type if graded | Every free-text box carries the label "not marked". |
| Protecting against failing twice | "What we settled" accumulates all session and is attributed to her — visible, cumulative evidence of competence. |
| Reads confident correction as proof she is bad at science | The disagreement resolves to *"neither of them was wrong — they were picturing different webs"*, so being wrong is reframed as having assumed something different, not as being stupid. |

**C1.** No images, audio, video or web fonts; inline SVG only; ~120 KB first load. The simulator
is ordinary arithmetic in the browser, so the entire activity works with no network. Two model
calls per round at most, with per-agent token caps that also keep the reading level low. A
labelled recorded conversation covers an outage, and the footer shows live data use.
