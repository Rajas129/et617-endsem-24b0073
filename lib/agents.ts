import type {
  Session, Intake, GuideRecord, CoLearnerRecord, CheckerRecord, Disagreement,
  ClaimVerdict, MisconceptionId, SimResult, FoodWeb,
} from "./types";
import { callJSON, clampText, oneOf } from "./llm";
import { simBrief } from "./simulate";
import { speciesName, CANONICAL_IDS, pluralLower } from "./web";
import { contested } from "./proposition";

// Per-agent output caps. Short replies serve two masters at once: bandwidth (C1)
// and a 13-year-old's reading stamina (L5).
// Gemma is verbose even when prefilled; too small a budget truncates it mid-object.
const MAX = { intakeGuideColearner: 750, checker: 750 };
const SAY = { mira: 240, aarav: 160, sen: 420 };

// ── Shared prompt fragments ────────────────────────────────────────────────

function webSummary(web: FoodWeb): string {
  const alive = web.nodes.filter((n) => n.alive).map((n) => n.name);
  const dead = web.nodes.filter((n) => !n.alive).map((n) => n.name);
  const arrows = web.edges
    .map((e) => `${speciesName(web, e.from)} is eaten by ${speciesName(web, e.to)}`)
    .join("; ");
  return [
    `Species present: ${alive.join(", ")}.`,
    dead.length ? `Species removed by the learner: ${dead.join(", ")}.` : "",
    `Feeding arrows: ${arrows}.`,
  ].filter(Boolean).join("\n");
}

function learnerSummary(s: Session): string {
  const mis = s.learner.misconceptions
    .map((m) => `${m.label} (belief strength ${m.confidence.toFixed(2)})`).join("; ");
  const threads = s.learner.openThreads.filter((t) => !t.addressed).map((t) => `"${t.doubt}"`);
  return [
    `Learner: ${s.learner.name}, repeating this topic after failing it once.`,
    `She is highly anxious about this topic and believes she is bad at science.`,
    `She expects to be told she is wrong, and will stop if anything feels like a test.`,
    `Never test her. Never score her. Never say "wrong" to her directly.`,
    `Use short simple sentences and familiar words. Say "we" and "let's".`,
    `Likely wrong ideas we are tracking: ${mis}.`,
    threads.length ? `Her unanswered questions so far: ${threads.join(", ")}` : "",
    `Support level needed: ${s.learner.scaffoldLevel} of 3 (3 = most support).`,
  ].filter(Boolean).join("\n");
}

// ── Proposition: the single thing both agents must predict ─────────────────
// Computed in code so the two predictions are always about the same claim and
// the conflict detector can actually compare them.

export function proposition(session: Session): { text: string; speciesRef: string } | null {
  const c = contested(session.web, session.sim);
  return c ? { text: c.text, speciesRef: c.name } : null;
}

/**
 * Aarav's stance is scheduled deterministically, not left to the model.
 *
 * Two reasons. First, a disagreement must be demonstrable on demand (the viva
 * walkthrough needs it). Second, Aarav's wrongness rate is a pedagogical
 * parameter for an L5 learner — she needs to watch a peer be wrong without
 * consequence at a predictable rate, not at the model's whim.
 */
export function scheduleStance(session: Session, decidable: boolean): CoLearnerRecord["stance"] {
  if (session.openDisagreement && !session.openDisagreement.resolved) return "probe";
  if (!decidable) return "probe";
  if (session.learner.turnsSinceDisagreement >= 2) return "disagree";
  return session.learner.turn <= 1 ? "disagree" : "probe";
}

// ── Phase 1: intake + Guide + Co-learner, in ONE call, blind to the simulator ──

export type PredictPhase = {
  intake: Intake;
  guide: GuideRecord;
  colearner: CoLearnerRecord;
  disagreement: Disagreement | null;
  bytes: number;
  source: "model" | "fallback";
  provider?: string;
  failure?: "unreachable" | "unparseable" | "busy";
  detail?: string;
};

function predictPrompt(session: Session, utterance: string, stance: CoLearnerRecord["stance"]): string {
  const prop = proposition(session);
  const stanceBrief = {
    disagree: `Aarav must DISAGREE with Mira about this exact question. He should argue the simple food-chain view: the predator has lost its food, so it will die out. He states this confidently, as a classmate would. He may well be wrong — that is fine and expected.`,
    agree: `Aarav agrees with Mira but adds one extra worry of his own.`,
    probe: `Aarav does not take a side. He asks one short curious question about something that has not been tested yet.`,
  }[stance];

  return `You are running three characters in a Class 7 science app about food webs.
Reply with JSON only. No explanation outside the JSON.

THE FOOD WEB RIGHT NOW
${webSummary(session.web)}

THE LEARNER
${learnerSummary(session)}

WHAT THE LEARNER JUST TYPED
"${utterance}"

${prop ? `THE QUESTION ON THE TABLE\n${prop.text}\nBoth Mira and Aarav must give their own prediction about the ${prop.speciesRef}.` : ""}

THE CHARACTERS
- Mira is a warm guide. She explains and gives confidence. She is the ONLY one who may
  say what to do next. Max ${SAY.mira} characters.
- Aarav is a classmate the same age. He is also unsure of things. ${stanceBrief}
  Max ${SAY.aarav} characters.

CRITICAL RULES
- You do NOT know the simulation result. Do not pretend to. Give honest predictions
  by reasoning from the arrows above.
- Never mention populations as exact numbers. You have not run anything yet.
- Never tell the learner she is wrong. Never use the words test, marks, score or exam.
- Mira and Aarav must address the SAME question.

Classify what the learner typed:
- "answer_attempt" she is answering or predicting
- "doubt" she is asking a what-if or expressing confusion
- "web_edit_request" she wants to add or remove a feeding arrow (e.g. "hawks eat rats too")
- "help_request" she is stuck and asking for help
Valid species ids for proposedEdit: ${CANONICAL_IDS.join(", ")}.
Valid misconception ids: "linear-chain" (thinks only the neighbour is affected),
"predator-removal-is-good" (thinks removing a predator just helps the prey).

JSON shape:
{"intake":{"kind":"...","claims":["..."],"proposedEdit":null,"misconceptionSignals":[]},
 "guide":{"say":"...","prediction":"...","nextAction":"..."},
 "colearner":{"say":"...","prediction":"...","stance":"${stance}"}}`;
}

export async function runPredictPhase(session: Session, utterance: string): Promise<PredictPhase> {
  const decidable = Boolean(session.sim?.decidingAssumption);
  const stance = scheduleStance(session, decidable);
  const prompt = predictPrompt(session, utterance, stance);

  const res = await callJSON<{
    intake?: Partial<Intake>;
    guide?: Partial<GuideRecord>;
    colearner?: Partial<CoLearnerRecord>;
  }>("predict", prompt, MAX.intakeGuideColearner);

  const { bytes, provider } = res;
  const parsed = res.value;

  if (!parsed) {
    const fb = recordedPredict(session, utterance, stance);
    return { ...fb, bytes, source: "fallback", provider, failure: res.failure, detail: res.detail };
  }

  const prop = proposition(session);

  const intake: Intake = {
    kind: oneOf(parsed.intake?.kind,
      ["answer_attempt", "doubt", "web_edit_request", "help_request", "other"] as const, "other"),
    claims: Array.isArray(parsed.intake?.claims)
      ? parsed.intake!.claims!.slice(0, 4).map((c) => clampText(c, 160)).filter(Boolean) : [],
    proposedEdit: validateEdit(parsed.intake?.proposedEdit),
    misconceptionSignals: validateMisconceptions(parsed.intake?.misconceptionSignals),
  };

  const guide: GuideRecord = {
    agent: "mira",
    say: clampText(parsed.guide?.say, SAY.mira, "Let's look at the arrows together and see what they tell us."),
    prediction: clampText(parsed.guide?.prediction, 160) || null,
    targetProposition: prop?.text ?? null,
    nextAction: clampText(parsed.guide?.nextAction, 120, "Make your guess, then we run it."),
    scaffoldLevel: session.learner.scaffoldLevel,
  };

  const colearner: CoLearnerRecord = {
    agent: "aarav",
    say: clampText(parsed.colearner?.say, SAY.aarav, "Wait — I'm not sure that's right. Can we check it?"),
    prediction: clampText(parsed.colearner?.prediction, 160) || null,
    stance: stance,                               // scheduled in code, never by the model
    targetProposition: prop?.text ?? null,
  };

  return {
    intake, guide, colearner,
    disagreement: detectConflict(guide, colearner, prop, decidable),
    bytes, source: "model", provider,
  };
}

// ── Conflict detector (deterministic) ──────────────────────────────────────

export function detectConflict(
  guide: GuideRecord,
  colearner: CoLearnerRecord,
  prop: { text: string; speciesRef: string } | null,
  decidable: boolean,
): Disagreement | null {
  // Invariant 3: a disagreement we cannot settle with one simulator run is suppressed.
  if (!decidable || !prop) return null;
  if (colearner.stance !== "disagree") return null;
  if (!guide.prediction || !colearner.prediction) return null;
  if (guide.targetProposition !== colearner.targetProposition) return null;

  return {
    proposition: prop.text,
    miraClaim: guide.prediction,
    aaravClaim: colearner.prediction,
    decidable: true,
    learnerChoice: null,
    resolved: false,
  };
}

// ── Phase 2: the Evidence Checker, the only agent that sees the simulator ──

export type AdjudicatePhase = {
  checker: CheckerRecord;
  bytes: number;
  source: "model" | "fallback";
  provider?: string;
  failure?: "unreachable" | "unparseable" | "busy";
  detail?: string;
};

function checkerPrompt(session: Session): string {
  const sim = session.sim!;
  const d = session.openDisagreement;
  return `You are Dr. Sen, the evidence checker in a Class 7 science app about food webs.
Reply with JSON only.

SIMULATION RESULT (this is the ground truth — never contradict it)
${JSON.stringify(simBrief(sim, session.web))}

${session.ui.resolutionRun && session.ui.resolutionBaseline ? `THIS IS THE RESOLUTION RUN.
The learner has just deleted the "${session.ui.resolutionBaseline.edgeLabel}" arrow and run the
same experiment again. In the PREVIOUS run the ${session.ui.resolutionBaseline.predatorName} ended at
${Math.round(session.ui.resolutionBaseline.withArrowEnd)}. Compare the two runs directly, say who
turns out to have been right, and make clear that both of them were reasoning about
different webs rather than one of them being foolish. Credit the learner for settling it.` : ""}

${d ? `MIRA PREDICTED: "${d.miraClaim}"
AARAV PREDICTED: "${d.aaravClaim}"
THE LEARNER PICKED: ${d.learnerChoice ?? "did not pick"}
You must say plainly who was right and who was wrong, using the numbers above.` : ""}

THE LEARNER
${learnerSummary(session)}

YOUR JOB
- Report what the numbers actually show. Quote real figures from the data above.
- If a prediction was wrong, say so kindly but clearly. Do not soften it into mush.
- If the result depends on one feeding arrow, name that arrow and tell the learner
  to delete it and run it again. That experiment is how we settle the argument.
- End with one thing we now know for sure.
- Max ${SAY.sen} characters. Short sentences.

For each claim, set direction to "up", "down" or "flat" to match the numbers, and
speciesRef to the species name it is about.

JSON shape:
{"say":"...","perClaim":[{"claim":"...","status":"supported|contradicted|depends_on_assumption","speciesRef":"Snake","direction":"down","evidence":"snake 40 to 18.6"}],
 "keyAssumption":"...","whoWasRight":"mira|aarav|both_partly|neither|not_applicable",
 "settled":{"question":"...","answer":"...","howWeKnow":"..."}}`;
}

export async function runAdjudicatePhase(session: Session): Promise<AdjudicatePhase> {
  if (!session.sim) throw new Error("adjudicate called with no simulation");

  const res = await callJSON<Partial<CheckerRecord>>(
    "adjudicate", checkerPrompt(session), MAX.checker,
  );
  const { bytes, provider } = res;
  const parsed = res.value;

  if (!parsed) {
    return {
      checker: templatedChecker(session, "Here are the numbers on their own."),
      bytes, source: "fallback", provider, failure: res.failure, detail: res.detail,
    };
  }

  const perClaim: ClaimVerdict[] = Array.isArray(parsed.perClaim)
    ? parsed.perClaim.slice(0, 5).map((c) => ({
        claim: clampText(c?.claim, 160),
        status: oneOf(c?.status, ["supported", "contradicted", "depends_on_assumption"] as const, "depends_on_assumption"),
        speciesRef: clampText(c?.speciesRef, 40) || null,
        direction: oneOf(c?.direction, ["up", "down", "flat"] as const, "flat"),
        evidence: clampText(c?.evidence, 120),
      }))
    : [];

  const draft: CheckerRecord = {
    agent: "sen",
    say: clampText(parsed.say, SAY.sen, ""),
    perClaim,
    keyAssumption: clampText(parsed.keyAssumption, 160) || null,
    whoWasRight: oneOf(parsed.whoWasRight,
      ["mira", "aarav", "both_partly", "neither", "not_applicable"] as const, "not_applicable"),
    settled: parsed.settled && typeof parsed.settled === "object" ? {
      question: clampText(parsed.settled.question, 160),
      answer: clampText(parsed.settled.answer, 200),
      howWeKnow: clampText(parsed.settled.howWeKnow, 200),
    } : null,
    verified: true,
  };

  // D6 output check: the only agent allowed to state facts gets those facts checked.
  const verified = verifyChecker(draft, session.sim);
  if (!verified.ok) {
    return {
      checker: templatedChecker(session, verified.reason),
      bytes, source: "model", provider,
    };
  }

  return { checker: draft, bytes, source: "model", provider };
}

/**
 * Checks every directional claim against the simulator, and scans the prose for
 * invented numbers. A contradiction means we throw the model's text away entirely
 * rather than show a learner a confident falsehood.
 */
export function verifyChecker(c: CheckerRecord, sim: SimResult): { ok: boolean; reason: string } {
  if (!c.say) return { ok: false, reason: "The helper sent an empty reply." };

  for (const claim of c.perClaim) {
    if (!claim.speciesRef || !claim.direction) continue;
    const o = sim.outcomes.find(
      (x) => x.name.toLowerCase() === claim.speciesRef!.toLowerCase(),
    );
    if (!o) return { ok: false, reason: `The helper talked about "${claim.speciesRef}", which is not in this web.` };
    if (o.start <= 0) continue;

    const ratio = o.end / o.start;
    const actual = ratio > 1.15 ? "up" : ratio < 0.85 ? "down" : "flat";
    if (actual !== claim.direction) {
      return { ok: false, reason: `The helper said ${o.name} went ${claim.direction}, but the numbers say ${actual}.` };
    }
  }

  // Numbers in the prose must correspond to something the simulator produced.
  const allowed = new Set<number>([sim.steps, 0, 1, 2, 100]);
  for (const o of sim.outcomes) [o.start, o.min, o.max, o.end].forEach((v) => allowed.add(v));

  const found = (c.say.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 2);
  const unmatched = found.filter(
    (n) => ![...allowed].some((a) => Math.abs(a - n) <= 1.5),
  );
  if (unmatched.length > 1) {
    return { ok: false, reason: `The helper quoted numbers (${unmatched.join(", ")}) that are not in the result.` };
  }

  return { ok: true, reason: "" };
}

/**
 * The deterministic voice of Dr. Sen. Used when the model is unavailable or when
 * it failed verification. Built entirely from simulator output, so it is always
 * true — which is what lets the app keep teaching with no working AI at all.
 */
export function templatedChecker(session: Session, note: string): CheckerRecord {
  const sim = session.sim!;
  const web = session.web;
  const d = session.openDisagreement;
  const da = sim.decidingAssumption;

  const lines: string[] = [];
  if (note) lines.push(note);

  if (sim.removedId) {
    lines.push(`We took out the ${pluralLower(speciesName(web, sim.removedId))} and ran ${sim.steps} generations.`);
  }

  const moved = sim.outcomes
    .filter((o) => o.id !== sim.removedId && o.direction !== "steady")
    .sort((a, b) => (a.hopsFromRemoval ?? 9) - (b.hopsFromRemoval ?? 9))
    .slice(0, 4);
  for (const o of moved) {
    lines.push(`${o.name}: ${Math.round(o.start)} → ${Math.round(o.end)}.`);
  }

  if (sim.indirectEffects.length) {
    const ns = sim.indirectEffects.map((id) => speciesName(web, id));
    const names = ns.length <= 1 ? ns[0] : `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`;
    lines.push(`${names} changed too, and ${sim.indirectEffects.length > 1 ? "they are" : "it is"} not even next to what we removed.`);
  }

  let whoWasRight: CheckerRecord["whoWasRight"] = "not_applicable";

  // The resolution run. This is the moment the whole activity exists for, so it is
  // generated in code and cannot be lost to a model outage or a bad parse.
  const rb = session.ui.resolutionBaseline;
  if (rb && session.ui.resolutionRun) {
    const after = sim.outcomes.find((o) => o.name === rb.predatorName);
    const died = !after || after.end <= 0;
    whoWasRight = died ? "aarav" : "both_partly";
    lines.push(
      died
        ? `Now look at the difference. With the ${rb.edgeLabel} arrow the ${pluralLower(rb.predatorName)} ended at ${Math.round(rb.withArrowEnd)}. Without it they ended at 0.`
        : `With the ${rb.edgeLabel} arrow they ended at ${Math.round(rb.withArrowEnd)}. Without it, ${Math.round(after!.end)}.`,
      died
        ? `So Aarav was right after all — but only in a web where the ${pluralLower(rb.predatorName)} have nothing else to eat.`
        : `So the arrow mattered, but not as much as Aarav thought.`,
      `Neither of them was wrong about nature. They were picturing different webs. That one arrow was the whole argument, and you settled it yourself.`,
    );
    return {
      agent: "sen",
      say: lines.join(" "),
      perClaim: [],
      keyAssumption: rb.edgeLabel,
      whoWasRight,
      settled: {
        question: `Do the ${pluralLower(rb.predatorName)} survive losing their main food?`,
        answer: `Only if they have another food source. With the ${rb.edgeLabel} arrow they survive at ${Math.round(rb.withArrowEnd)}. Without it they die out.`,
        howWeKnow: `We deleted the ${rb.edgeLabel} arrow and ran the same experiment again. The ${pluralLower(rb.predatorName)} went from ${Math.round(rb.withArrowEnd)} to 0.`,
      },
      verified: false,
    };
  }

  if (d && da) {
    const survived = da.withAlt.direction !== "crashed";
    whoWasRight = survived ? "mira" : "aarav";
    lines.push(
      survived
        ? `So the ${pluralLower(da.predatorName)} did not die out. They dropped to ${Math.round(da.withAlt.end)} and held on.`
        : `So the ${pluralLower(da.predatorName)} did die out.`,
    );
    lines.push(`The reason is one arrow: ${da.edgeLabel}. Delete that arrow and run it again.`);
  }

  return {
    agent: "sen",
    say: lines.join(" "),
    perClaim: moved.map((o) => ({
      claim: `${o.name} changed after the removal`,
      status: "supported" as const,
      speciesRef: o.name,
      direction: (o.end / Math.max(o.start, 0.001) > 1.15 ? "up" : o.end / Math.max(o.start, 0.001) < 0.85 ? "down" : "flat") as "up" | "down" | "flat",
      evidence: `${o.name} ${o.start} → ${o.end}`,
    })),
    keyAssumption: da ? da.edgeLabel : null,
    whoWasRight,
    // While a deciding arrow is still untested, nothing is settled — saying it is
    // would hand the learner a conclusion she has not earned, and would duplicate
    // the entry the resolution run writes a moment later.
    settled: da ? null : sim.removedId ? {
      question: `What happens when the ${pluralLower(speciesName(web, sim.removedId))} are removed?`,
      answer: moved.length
        ? `${moved.map((o) => `${o.name} ${o.start > o.end ? "falls" : "rises"} to ${Math.round(o.end)}`).join(", ")}.`
        : `Nothing much changes.`,
      howWeKnow: `We removed them and ran ${sim.steps} generations.`,
    } : null,
    verified: false,
  };
}

// ── Recorded fallback for phase 1 ──────────────────────────────────────────

function recordedPredict(session: Session, _utterance: string, stance: CoLearnerRecord["stance"]) {
  const prop = proposition(session);
  const da = session.sim?.decidingAssumption;
  const pred = da ? pluralLower(da.predatorName) : "the animals above it";

  const guide: GuideRecord = {
    agent: "mira",
    say: `Let's read the arrows again. Look at what the ${pred} can eat. I don't think they lose everything — I think they drop but hold on.`,
    prediction: `The ${pred} will drop but survive, because they have another food source.`,
    targetProposition: prop?.text ?? null,
    nextAction: "Make your guess, then we run it.",
    scaffoldLevel: session.learner.scaffoldLevel,
  };

  const colearner: CoLearnerRecord = {
    agent: "aarav",
    say: stance === "disagree"
      ? `I don't agree. If their food is gone, they've got nothing left. I think the ${pred} die out completely.`
      : `What happens to the plants at the bottom? Nobody has checked those yet.`,
    prediction: stance === "disagree" ? `The ${pred} will die out completely.` : null,
    stance,
    targetProposition: prop?.text ?? null,
  };

  return {
    intake: { kind: "answer_attempt", claims: [], proposedEdit: null, misconceptionSignals: [] } as Intake,
    guide,
    colearner,
    disagreement: detectConflict(guide, colearner, prop, Boolean(da)),
  };
}

// ── validators ─────────────────────────────────────────────────────────────

function validateEdit(e: unknown): Intake["proposedEdit"] {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const op = oneOf(o.op, ["add_edge", "delete_edge"] as const, "add_edge");
  const from = String(o.from ?? "");
  const to = String(o.to ?? "");
  if (!CANONICAL_IDS.includes(from) || !CANONICAL_IDS.includes(to) || from === to) return null;
  return { op, from, to };
}

function validateMisconceptions(v: unknown): MisconceptionId[] {
  const allowed: MisconceptionId[] = ["linear-chain", "predator-removal-is-good"];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is MisconceptionId => allowed.includes(x as MisconceptionId));
}
