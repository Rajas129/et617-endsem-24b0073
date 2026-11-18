import type { SimResult, FoodWeb, MisconceptionId } from "./types";
import { speciesName, pluralLower } from "./web";

const n = (v: number) => Math.round(v);

const listJoin = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "")
  : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/**
 * Deterministic feedback. Written in code rather than generated, because the
 * response to a misconception is the most important text in the app and must not
 * drift between runs — and because it has to work with no network (C1).
 */

export type Feedback = {
  text: string;
  fired: MisconceptionId | null;
  correctIds: string[];
  missedIds: string[];
};

/** Task 1 — "tick everyone who changes". Targets the linear-chain misconception. */
export function whoChangesFeedback(sim: SimResult, web: FoodWeb, picked: string[]): Feedback {
  const correct = sim.outcomes
    .filter((o) => o.id !== sim.removedId && o.direction !== "steady")
    .map((o) => o.id);

  const missed = correct.filter((id) => !picked.includes(id));
  const far = correct.filter((id) => {
    const o = sim.outcomes.find((x) => x.id === id)!;
    return (o.hopsFromRemoval ?? 0) >= 2;
  });
  const missedFar = far.filter((id) => !picked.includes(id));
  const removed = sim.removedId ? pluralLower(speciesName(web, sim.removedId)) : "those species";

  // Correct, including the distant ones — the hard part.
  if (missed.length === 0) {
    const farNames = listJoin(far.map((id) => speciesName(web, id)));
    return {
      text: far.length
        ? `You got ${farNames} too. That's the hard one — most people stop at the animal right next to the ${removed}. ${farNames} changed because the whole web is joined up.`
        : `That's exactly right. You followed every arrow.`,
      fired: null, correctIds: correct, missedIds: [],
    };
  }

  // Missed a species two or more hops away: the linear-chain misconception.
  if (missedFar.length) {
    const neighbourHit = picked.find((id) => {
      const o = sim.outcomes.find((x) => x.id === id);
      return o && o.hopsFromRemoval === 1 && o.direction !== "steady";
    });
    const missedNames = listJoin(missedFar.map((id) => speciesName(web, id)));
    return {
      text: [
        neighbourHit ? `${speciesName(web, neighbourHit)} is right — good.` : `Let's follow this further.`,
        `But let's keep going down the arrows. If the ${removed} are gone, who stops being eaten? And then what happens to what they eat?`,
        `Look at ${missedNames}.`,
      ].join(" "),
      fired: "linear-chain", correctIds: correct, missedIds: missed,
    };
  }

  const missedNames = listJoin(missed.map((id) => speciesName(web, id)));
  return {
    text: `Close. You missed ${missedNames}. Have a look at ${missedNames} now.`,
    fired: null, correctIds: correct, missedIds: missed,
  };
}

/**
 * Task 2 feedback — fires after the run. Targets the predator-removal
 * misconception by pointing at the boom that turns into a crash.
 */
export function overshootNote(sim: SimResult, web: FoodWeb): string | null {
  if (!sim.removedId) return null;

  const boomed = sim.outcomes.find((o) => o.id !== sim.removedId && o.direction === "boomed");
  const crashed = sim.outcomes.find(
    (o) => o.id !== sim.removedId && (o.direction === "fell" || o.direction === "crashed") &&
           (o.hopsFromRemoval ?? 0) >= 2,
  );
  if (!boomed) return null;

  const peakStep = sim.series.reduce(
    (best, s) => ((s.pops[boomed.id] ?? 0) > (sim.series[best].pops[boomed.id] ?? 0) ? s.step : best), 0,
  );

  if (crashed) {
    return `${boomed.name} did boom — up to ${n(boomed.max)} around step ${peakStep}. But look at ${crashed.name}: ${n(crashed.start)} → ${n(crashed.end)}. More ${pluralLower(boomed.name)} was not simply good news. Why do you think ${crashed.name} dropped?`;
  }
  return `${boomed.name} boomed to ${n(boomed.max)} by step ${peakStep}. Nothing was eating them any more.`;
}

/** The far-away change, stated plainly. This is the sentence the whole topic turns on. */
export function indirectNote(sim: SimResult, web: FoodWeb): string | null {
  if (!sim.indirectEffects.length || !sim.removedId) return null;
  const names = sim.indirectEffects.map((id) => speciesName(web, id));
  const removed = pluralLower(speciesName(web, sim.removedId));
  return `${listJoin(names)} ${names.length > 1 ? "are" : "is"} not even touching the ${removed} in the web, and ${names.length > 1 ? "they" : "it"} still changed.`;
}
