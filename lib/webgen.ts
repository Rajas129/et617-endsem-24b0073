import type { FoodWeb, Species, Edge, Role } from "./types";
import { callLLM, extractJSON, clampText, LLMUnavailable } from "./llm";
import { computeK } from "./simulate";

/**
 * Builds a food web around an animal the learner names.
 *
 * Division of labour: the model proposes *structure* — plausible species, who eats
 * whom, which trophic stage each sits at. All the numbers that make the simulation
 * behave (diet shares, predation dependency, baselines, carrying capacities) are
 * computed here in code.
 *
 * That split is deliberate. Asking a small model for coefficients that must satisfy
 * "shares sum to 1 per predator" and "dependency stays under 1 per prey" produces a
 * web that silently drifts at equilibrium and teaches nothing. Asking it only for
 * "a frog eats grasshoppers and is eaten by snakes" is a question it answers well.
 */

type RawSpecies = {
  id?: string; name?: string; role?: string;
  level?: number; uncountable?: boolean; abundance?: string;
};
type RawLink = { eaten?: string; eatenBy?: string; main?: boolean };
type RawWeb = { species?: RawSpecies[]; links?: RawLink[] };

const ABUNDANCE: Record<string, number> = {
  "very common": 100, common: 70, uncommon: 45, rare: 25,
};

/** Lower trophic levels respond faster. */
const GROWTH_BY_LEVEL = [0.5, 0.35, 0.26, 0.2, 0.16, 0.14];

export type GenResult = { web: FoodWeb; bytes: number; source: "model" | "fallback"; note?: string };

function prompt(subject: string): string {
  return `Build a simple food web around "${subject}" for a Class 7 science lesson.
Reply with JSON only. No text outside the JSON.

RULES
- Between 6 and 8 species in total.
- Exactly 3 to 5 trophic stages (level 0 = plant/producer, then up).
- Include "${subject}" itself, placed at whatever level it really belongs to.
- Include at least one producer at level 0.
- Include one decomposer.
- IMPORTANT: at least one animal must eat TWO different things. This matters:
  it is what lets a learner test whether a predator survives losing one food source.
- Use real species that plausibly share one habitat. Use common English names a
  13-year-old knows. No scientific names.
- Every non-producer must have at least one food listed in "links".

FIELDS
- level: 0 for producers, 1 for plant-eaters, 2, 3, 4 going up.
- abundance: one of "very common", "common", "uncommon", "rare". Things lower
  down the web should generally be more common than things above them.
- uncountable: true for mass nouns like grass or algae, false for countable animals.
- links: "eaten" is the food, "eatenBy" is the one doing the eating.
  "main": true for the predator's single most important food.

JSON shape:
{"species":[{"id":"grass","name":"Grass","role":"producer","level":0,"abundance":"very common","uncountable":true}],
 "links":[{"eaten":"grass","eatenBy":"rabbit","main":true}]}`;
}

export async function generateWeb(subject: string): Promise<GenResult> {
  let bytes = 0;
  let raw: RawWeb | null = null;

  try {
    const res = await callLLM("build", prompt(subject), 900);
    bytes = res.bytes;
    raw = extractJSON<RawWeb>(res.text);
  } catch (err) {
    if (!(err instanceof LLMUnavailable)) throw err;
  }

  if (!raw) return { web: fallbackWeb(subject), bytes, source: "fallback" };

  const built = assemble(raw, subject);
  return built
    ? { web: built, bytes, source: "model" }
    : { web: fallbackWeb(subject), bytes, source: "fallback", note: "the chain came back incomplete" };
}

// ── Structure → a simulatable web ─────────────────────────────────────────

function assemble(raw: RawWeb, subject: string): FoodWeb | null {
  const slug = (v: unknown, fb: string) =>
    clampText(v, 40, fb).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fb;

  const seen = new Set<string>();
  const nodes: Species[] = [];

  for (const sp of raw.species ?? []) {
    const name = clampText(sp.name, 24);
    if (!name) continue;
    const id = slug(sp.id ?? name, `s${nodes.length}`);
    if (seen.has(id)) continue;
    seen.add(id);

    const role: Role =
      sp.role === "producer" ? "producer" : sp.role === "decomposer" ? "decomposer" : "consumer";
    const level = role === "producer" ? 0
      : Math.max(0, Math.min(5, Math.round(Number(sp.level ?? 1)) || 1));

    nodes.push({
      id, name, role, level,
      baseline: ABUNDANCE[String(sp.abundance ?? "").toLowerCase()] ?? Math.max(90 - level * 18, 20),
      growth: GROWTH_BY_LEVEL[Math.min(level, GROWTH_BY_LEVEL.length - 1)],
      alive: true,
      uncountable: sp.uncountable === true,
      x: 50, y: 50,
    });
  }

  if (nodes.length < 4) return null;
  if (!nodes.some((n) => n.role === "producer")) return null;

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Raw links, de-duplicated, self-loops and unknown ids dropped.
  type Link = { from: string; to: string; main: boolean };
  const links: Link[] = [];
  const key = new Set<string>();
  for (const l of raw.links ?? []) {
    const from = slug(l.eaten, "");
    const to = slug(l.eatenBy, "");
    if (!from || !to || from === to) continue;
    if (!byId.has(from) || !byId.has(to)) continue;
    if (byId.get(to)!.role === "producer") continue;   // producers eat nobody
    const k = `${from}->${to}`;
    if (key.has(k)) continue;
    key.add(k);
    links.push({ from, to, main: l.main === true });
  }

  const withFood = (id: string) => links.some((l) => l.to === id);
  for (const n of nodes) {
    if (n.role === "consumer" && !withFood(n.id)) {
      // Attach any plausible food one level down rather than discarding the species.
      const food = nodes.find((o) => o.id !== n.id && o.level < n.level && o.role !== "decomposer");
      if (!food) return null;
      links.push({ from: food.id, to: n.id, main: true });
    }
  }

  ensureDecidable(nodes, links);

  const edges = coefficients(nodes, links);
  layout(nodes);

  const web: FoodWeb = { nodes, edges, subject };
  web.k = computeK(web);
  return web;
}

/**
 * Guarantees at least one predator with two food sources.
 *
 * Without one, `findDecidingAssumption` finds nothing, no two agents can disagree
 * about something a single run settles, and the whole activity collapses into a
 * plain simulation. So if the model did not give us one, we add it.
 */
function ensureDecidable(nodes: Species[], links: { from: string; to: string; main: boolean }[]) {
  const preyCount = (id: string) => links.filter((l) => l.to === id).length;
  if (nodes.some((n) => n.role === "consumer" && preyCount(n.id) >= 2)) return;

  const candidates = nodes
    .filter((n) => n.role === "consumer" && preyCount(n.id) === 1)
    .sort((a, b) => b.level - a.level);

  for (const pred of candidates) {
    const current = links.find((l) => l.to === pred.id)!;
    const alt = nodes.find(
      (o) => o.id !== pred.id && o.id !== current.from &&
             o.role !== "decomposer" && o.level < pred.level,
    );
    if (alt) { links.push({ from: alt.id, to: pred.id, main: false }); return; }
  }
}

/**
 * Turns structure into the numbers the model needs.
 *  - dietShare sums to 1 across each predator's prey ("main" food gets the bigger slice)
 *  - dependency sums to at most 0.7 across each prey's predators, keeping K positive
 */
function coefficients(nodes: Species[], links: { from: string; to: string; main: boolean }[]): Edge[] {
  const edges: Edge[] = links.map((l) => ({ ...l, dietShare: 0, dependency: 0 }));

  for (const pred of nodes) {
    const mine = edges.filter((e) => e.to === pred.id);
    if (!mine.length) continue;
    if (mine.length === 1) { mine[0].dietShare = 1; continue; }

    const mains = mine.filter((e) => (e as Edge & { main?: boolean }).main);
    const main = mains.length === 1 ? mains[0] : mine[0];
    const rest = mine.filter((e) => e !== main);
    main.dietShare = 0.55;
    rest.forEach((e) => { e.dietShare = 0.45 / rest.length; });
  }

  const PREDATION_BUDGET = 0.7;
  for (const prey of nodes) {
    const on = edges.filter((e) => e.from === prey.id);
    if (!on.length) continue;
    const share = PREDATION_BUDGET / on.length;
    on.forEach((e) => { e.dependency = Number(share.toFixed(3)); });
  }

  return edges.map(({ from, to, dietShare, dependency }) => ({ from, to, dietShare, dependency }));
}

/** Trophic level sets the row; species are spread evenly across their row. */
function layout(nodes: Species[]) {
  const levels = [...new Set(nodes.map((n) => n.level))].sort((a, b) => a - b);
  const maxLevel = levels[levels.length - 1] || 1;

  for (const lvl of levels) {
    const row = nodes.filter((n) => n.level === lvl);
    const y = 90 - (lvl / Math.max(maxLevel, 1)) * 80;
    row.forEach((n, i) => {
      n.y = y;
      n.x = row.length === 1 ? 50 : 14 + (i / (row.length - 1)) * 72;
    });
  }
}

/**
 * Used when the model is unavailable or returns something unusable. A real,
 * working web that still mentions what she asked for, so the activity continues.
 */
export function fallbackWeb(subject: string): FoodWeb {
  const nodes: Species[] = [
    { id: "grass", name: "Grass", role: "producer", level: 0, baseline: 100, growth: 0.5, alive: true, uncountable: true, x: 30, y: 90 },
    { id: "insect", name: "Insects", role: "consumer", level: 1, baseline: 70, growth: 0.35, alive: true, uncountable: true, x: 16, y: 63 },
    { id: "mouse", name: "Mice", role: "consumer", level: 1, baseline: 45, growth: 0.26, alive: true, x: 66, y: 63 },
    { id: "frog", name: "Frogs", role: "consumer", level: 2, baseline: 45, growth: 0.24, alive: true, x: 16, y: 36 },
    { id: "snake", name: "Snakes", role: "consumer", level: 3, baseline: 35, growth: 0.2, alive: true, x: 41, y: 20 },
    { id: "owl", name: "Owls", role: "consumer", level: 4, baseline: 20, growth: 0.15, alive: true, x: 70, y: 8 },
    { id: "decomposers", name: "Decomposers", role: "decomposer", level: 0, baseline: 30, growth: 0.3, alive: true, uncountable: true, x: 88, y: 90 },
  ];
  const edges: Edge[] = [
    { from: "grass", to: "insect", dietShare: 1, dependency: 0.35 },
    { from: "grass", to: "mouse", dietShare: 1, dependency: 0.35 },
    { from: "insect", to: "frog", dietShare: 1, dependency: 0.7 },
    { from: "frog", to: "snake", dietShare: 0.55, dependency: 0.7 },
    { from: "mouse", to: "snake", dietShare: 0.45, dependency: 0.4 },
    { from: "snake", to: "owl", dietShare: 0.7, dependency: 0.45 },
    { from: "mouse", to: "owl", dietShare: 0.3, dependency: 0.3 },
  ];
  const web: FoodWeb = { nodes, edges, subject };
  web.k = computeK(web);
  return web;
}
