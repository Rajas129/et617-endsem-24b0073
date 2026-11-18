import type {
  FoodWeb, SimResult, SeriesPoint, SpeciesOutcome, DecidingAssumption,
} from "./types";
import { withEdgeDeleted, speciesName, edgeLabel, preyOf, pluralLower, agrees } from "./web";

export const STEPS = 12;

/**
 * Carrying capacities.
 *
 * At baseline: foodScore = 1 (diet shares sum to 1) and predPressure = Σ dependency.
 * For delta = r·p·(foodScore − predPressure − p/K) to be zero we need
 *     K = baseline / (1 − Σ dependency)
 * which makes an untouched web sit exactly at equilibrium, so every change the
 * learner sees is attributable to something she did.
 *
 * Computed once per web at creation and then carried on the web, never recomputed
 * after an edit — see the note on FoodWeb.k.
 */
export function computeK(web: FoodWeb): Record<string, number> {
  const K: Record<string, number> = {};
  for (const n of web.nodes) {
    const depSum = web.edges
      .filter((e) => e.from === n.id)
      .reduce((s, e) => s + e.dependency, 0);
    K[n.id] = n.baseline / Math.max(1 - depSum, 0.05);
  }
  return K;
}

function capacities(web: FoodWeb): Record<string, number> {
  return web.k ?? computeK(web);
}

function extinctionFloor(baseline: number) {
  return Math.max(0.02 * baseline, 0.5);
}

/**
 * A consumer with no food left does not drift slowly downward under crowding —
 * it starves. Without this, a species whose entire diet was removed still shows
 * a gentle decline, and the difference between "survives on backup food" and
 * "dies out" never becomes visible in 12 steps. That difference is the whole
 * lesson, so it gets its own rule.
 */
const STARVATION_FOOD_THRESHOLD = 0.02;
const STARVATION_LOSS_PER_STEP = 0.35;

/** One discrete step of the population model. Pure arithmetic — no AI anywhere. */
function step(web: FoodWeb, pops: Record<string, number>, K: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  const aliveNodes = web.nodes.filter((n) => n.alive);

  const totalNow = aliveNodes.reduce((s, n) => s + (pops[n.id] ?? 0), 0);
  const totalBase = web.nodes.reduce((s, n) => s + n.baseline, 0);

  for (const n of web.nodes) {
    if (!n.alive) { next[n.id] = 0; continue; }
    const p = pops[n.id] ?? 0;

    let foodScore: number;
    if (n.role === "producer") {
      foodScore = 1;                                  // sunlight: always available
    } else if (n.role === "decomposer") {
      foodScore = totalBase > 0 ? totalNow / totalBase : 0;   // dead matter from everyone
    } else {
      foodScore = 0;
      for (const e of preyOf(web, n.id)) {
        const prey = web.nodes.find((s) => s.id === e.from);
        if (!prey || !prey.alive) continue;           // dead prey contributes nothing
        foodScore += e.dietShare * ((pops[e.from] ?? 0) / prey.baseline);
      }
    }

    let predPressure = 0;
    for (const e of web.edges.filter((x) => x.from === n.id)) {
      const pred = web.nodes.find((s) => s.id === e.to);
      if (!pred || !pred.alive) continue;             // removing a predator lifts pressure
      predPressure += e.dependency * ((pops[e.to] ?? 0) / pred.baseline);
    }

    let value: number;
    if (n.role === "consumer" && foodScore <= STARVATION_FOOD_THRESHOLD) {
      value = p * (1 - STARVATION_LOSS_PER_STEP);
    } else {
      const crowding = p / (K[n.id] || n.baseline);
      value = p + n.growth * p * (foodScore - predPressure - crowding);
    }
    next[n.id] = value < extinctionFloor(n.baseline) ? 0 : value;
  }
  return next;
}

function classify(start: number, end: number): SpeciesOutcome["direction"] {
  if (start <= 0) return "steady";
  const ratio = end / start;
  if (end <= 0 || ratio <= 0.1) return "crashed";
  if (ratio < 0.85) return "fell";
  if (ratio >= 2) return "boomed";
  if (ratio > 1.15) return "rose";
  return "steady";
}

/** Hop distance ignoring arrow direction — "how far from what the learner touched". */
function hopDistances(web: FoodWeb, fromId: string): Record<string, number> {
  const dist: Record<string, number> = { [fromId]: 0 };
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift()!;
    const neighbours = web.edges
      .filter((e) => e.from === cur || e.to === cur)
      .map((e) => (e.from === cur ? e.to : e.from));
    for (const nb of neighbours) {
      if (dist[nb] === undefined) { dist[nb] = dist[cur] + 1; queue.push(nb); }
    }
  }
  return dist;
}

export function simulate(web: FoodWeb, removedId: string | null): SimResult {
  const pops: Record<string, number> = {};
  for (const n of web.nodes) pops[n.id] = n.alive ? n.baseline : 0;

  const K = capacities(web);
  const series: SeriesPoint[] = [{ step: 0, pops: { ...pops } }];
  let cur = pops;
  for (let i = 1; i <= STEPS; i++) {
    cur = step(web, cur, K);
    series.push({ step: i, pops: { ...cur } });
  }

  const hops = removedId ? hopDistances(web, removedId) : {};

  const outcomes: SpeciesOutcome[] = web.nodes.map((n) => {
    const vals = series.map((s) => s.pops[n.id] ?? 0);
    const start = vals[0];
    const end = vals[vals.length - 1];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return {
      id: n.id,
      name: n.name,
      start: round(start), min: round(min), max: round(max), end: round(end),
      direction: classify(start, end),
      dippedThenRecovered: start > 0 && min < 0.85 * start && end > min * 1.2 && end > 0,
      hopsFromRemoval: removedId ? (hops[n.id] ?? null) : null,
    };
  });

  const indirectEffects = outcomes
    .filter((o) => o.id !== removedId && (o.hopsFromRemoval ?? 0) >= 2 && o.start > 0 &&
                   Math.abs(o.end - o.start) / o.start > 0.15)
    .map((o) => o.id);

  return {
    removedId,
    steps: STEPS,
    series: series.map((s) => ({
      step: s.step,
      pops: Object.fromEntries(Object.entries(s.pops).map(([k, v]) => [k, round(v)])),
    })),
    outcomes,
    indirectEffects,
    cascade: buildCascade(web, series, outcomes, removedId),
    decidingAssumption: removedId ? findDecidingAssumption(web, removedId) : null,
  };
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * Plain-language cascade, generated in code (never by the model) so that the
 * narrative the learner reads cannot drift from the numbers.
 */
function buildCascade(
  web: FoodWeb, series: SeriesPoint[], outcomes: SpeciesOutcome[], removedId: string | null,
): string[] {
  if (!removedId) return [];
  const node = web.nodes.find((n) => n.id === removedId);
  const name = node?.name ?? speciesName(web, removedId);
  const lines = [`Step 0: all the ${pluralLower(name)} ${agrees(name, node?.uncountable)} gone.`];

  const notable = outcomes
    .filter((o) => o.id !== removedId && o.direction !== "steady")
    .sort((a, b) => (a.hopsFromRemoval ?? 9) - (b.hopsFromRemoval ?? 9));

  for (const o of notable) {
    const startVal = o.start;
    const crossStep = series.findIndex(
      (s) => startVal > 0 && Math.abs((s.pops[o.id] ?? 0) - startVal) / startVal > 0.15,
    );
    const atStep = crossStep > 0 ? crossStep : 1;
    const reason = reasonFor(web, o.id, removedId, o.direction);
    const shape = o.dippedThenRecovered
      ? `dipped to ${o.min} and came back to ${o.end}`
      : `went ${o.start} → ${o.end}`;
    lines.push(`Step ${atStep}: ${o.name} ${shape}${reason ? ` — ${reason}` : ""}.`);
  }
  return lines;
}

function reasonFor(
  web: FoodWeb, id: string, removedId: string, dir: SpeciesOutcome["direction"],
): string {
  const lostPredator = web.edges.some((e) => e.from === id && e.to === removedId);
  const lostPrey = web.edges.some((e) => e.from === removedId && e.to === id);
  if (lostPrey && (dir === "fell" || dir === "crashed")) return "it lost a food source";
  if (lostPredator && (dir === "rose" || dir === "boomed")) return "nothing was eating it any more";
  if (dir === "crashed" || dir === "fell") return "the knock-on effect reached it";
  if (dir === "rose" || dir === "boomed") return "the pressure on it dropped";
  return "";
}

/**
 * The engine of the disagreement feature.
 *
 * When a species is removed, look for a predator of it that has ANOTHER prey.
 * Re-run the simulation with that alternate-food arrow deleted. If the predator's
 * fate flips, we have a disagreement that one runnable experiment can settle —
 * which is exactly the invariant the conflict detector requires.
 */
export function findDecidingAssumption(web: FoodWeb, removedId: string): DecidingAssumption | null {
  const predators = web.edges.filter((e) => e.from === removedId);

  for (const pe of predators) {
    const predator = web.nodes.find((n) => n.id === pe.to);
    if (!predator || !predator.alive) continue;

    const alternates = web.edges.filter(
      (e) => e.to === predator.id && e.from !== removedId &&
             web.nodes.find((n) => n.id === e.from)?.alive,
    );

    for (const alt of alternates) {
      const withAlt = simulateShallow(web, removedId);
      const withoutAlt = simulateShallow({ ...withEdgeDeleted(web, alt.from, predator.id), k: capacities(web) }, removedId);

      const a = withAlt.outcomes.find((o) => o.id === predator.id)!;
      const b = withoutAlt.outcomes.find((o) => o.id === predator.id)!;

      const severityA = sev(a.direction);
      const severityB = sev(b.direction);

      if (severityB > severityA) {
        return {
          predatorId: predator.id,
          predatorName: predator.name,
          altPreyId: alt.from,
          altPreyName: speciesName(web, alt.from),
          edgeLabel: edgeLabel(web, alt.from, predator.id),
          withAlt: { end: a.end, direction: a.direction },
          withoutAlt: { end: b.end, direction: b.direction },
          flips: true,
        };
      }
    }
  }
  return null;
}

const sev = (d: SpeciesOutcome["direction"]) =>
  ({ boomed: 0, rose: 1, steady: 2, fell: 3, crashed: 4 }[d]);

/** simulate() without recursing back into findDecidingAssumption(). */
function simulateShallow(web: FoodWeb, removedId: string | null): SimResult {
  const pops: Record<string, number> = {};
  for (const n of web.nodes) pops[n.id] = n.alive ? n.baseline : 0;
  const K = capacities(web);
  const series: SeriesPoint[] = [{ step: 0, pops: { ...pops } }];
  let cur = pops;
  for (let i = 1; i <= STEPS; i++) { cur = step(web, cur, K); series.push({ step: i, pops: { ...cur } }); }

  const outcomes: SpeciesOutcome[] = web.nodes.map((n) => {
    const vals = series.map((s) => s.pops[n.id] ?? 0);
    return {
      id: n.id, name: n.name,
      start: round(vals[0]), min: round(Math.min(...vals)),
      max: round(Math.max(...vals)), end: round(vals[vals.length - 1]),
      direction: classify(vals[0], vals[vals.length - 1]),
      dippedThenRecovered: false, hopsFromRemoval: null,
    };
  });
  return { removedId, steps: STEPS, series, outcomes, indirectEffects: [], cascade: [], decidingAssumption: null };
}

/** Compact brief handed to the Evidence Checker — small on purpose (C1). */
export function simBrief(sim: SimResult, web: FoodWeb) {
  return {
    removed: sim.removedId ? speciesName(web, sim.removedId) : null,
    steps: sim.steps,
    outcomes: sim.outcomes.map((o) => ({
      name: o.name, start: o.start, min: o.min, end: o.end,
      direction: o.direction, dippedThenRecovered: o.dippedThenRecovered,
      hops: o.hopsFromRemoval,
    })),
    indirectEffects: sim.indirectEffects.map((id) => speciesName(web, id)),
    cascade: sim.cascade,
    decidingAssumption: sim.decidingAssumption && {
      arrow: sim.decidingAssumption.edgeLabel,
      withArrow: sim.decidingAssumption.withAlt,
      withoutArrow: sim.decidingAssumption.withoutAlt,
    },
  };
}
