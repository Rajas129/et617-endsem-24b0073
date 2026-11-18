import type { FoodWeb, Species, Edge } from "./types";
import { computeK } from "./simulate";

/**
 * Seven species — enough for real indirect effects, few enough that the diagram
 * stays readable and the payload stays small (C1).
 *
 * Layout is on a 0..100 x 0..100 grid; trophic level maps to y.
 */
const NODES: Species[] = [
  { id: "grass",       name: "Grass",        role: "producer",   baseline: 100, growth: 0.50, alive: true, level: 0, uncountable: true, x: 30, y: 88 },
  { id: "grasshopper", name: "Grasshopper",  role: "consumer",   baseline: 60,  growth: 0.35, alive: true, level: 1, x: 16, y: 64 },
  { id: "rat",         name: "Rat",          role: "consumer",   baseline: 40,  growth: 0.25, alive: true, level: 1, x: 66, y: 64 },
  { id: "frog",        name: "Frog",         role: "consumer",   baseline: 50,  growth: 0.22, alive: true, level: 2, x: 16, y: 40 },
  { id: "snake",       name: "Snake",        role: "consumer",   baseline: 40,  growth: 0.20, alive: true, level: 3, x: 41, y: 24 },
  { id: "hawk",        name: "Hawk",         role: "consumer",   baseline: 20,  growth: 0.15, alive: true, level: 4, x: 66, y: 8  },
  { id: "decomposers", name: "Decomposers",  role: "decomposer", baseline: 30,  growth: 0.30, alive: true, level: 0, uncountable: true, x: 88, y: 88 },
];

/**
 * dietShare — share of the PREDATOR's diet this prey provides. Sums to 1 per predator.
 * dependency — share of the PREY's death rate this predator causes. Sums to < 1 per prey.
 *
 * The snake's 0.55 frog / 0.45 rat split is the pedagogical centre of the whole app:
 * it is the reason two agents can honestly disagree about what happens to snakes.
 */
const EDGES: Edge[] = [
  { from: "grass",       to: "grasshopper", dietShare: 1.00, dependency: 0.15 },
  { from: "grass",       to: "rat",         dietShare: 1.00, dependency: 0.15 },
  { from: "grasshopper", to: "frog",        dietShare: 1.00, dependency: 0.80 },
  { from: "frog",        to: "snake",       dietShare: 0.55, dependency: 0.70 },
  { from: "rat",         to: "snake",       dietShare: 0.45, dependency: 0.45 },
  { from: "snake",       to: "hawk",        dietShare: 0.70, dependency: 0.40 },
  { from: "rat",         to: "hawk",        dietShare: 0.30, dependency: 0.25 },
];

export function freshWeb(): FoodWeb {
  const web: FoodWeb = {
    nodes: NODES.map((n) => ({ ...n })),
    edges: EDGES.map((e) => ({ ...e })),
    subject: null,
  };
  web.k = computeK(web);
  return web;
}

export const edgeKey = (from: string, to: string) => `${from}->${to}`;

export function speciesName(web: FoodWeb, id: string): string {
  return web.nodes.find((n) => n.id === id)?.name ?? id;
}

export function edgeLabel(web: FoodWeb, from: string, to: string): string {
  return `${speciesName(web, from)} → ${speciesName(web, to)}`;
}

export function preyOf(web: FoodWeb, predatorId: string): Edge[] {
  return web.edges.filter((e) => e.to === predatorId);
}

export function predatorsOf(web: FoodWeb, preyId: string): Edge[] {
  return web.edges.filter((e) => e.from === preyId);
}

// ── Learner edit operations ────────────────────────────────────────────────
// These mutate the ground truth, which is what keeps the topic un-hardcoded:
// deleting one arrow can make a previously wrong agent claim correct.

export function withSpeciesRemoved(web: FoodWeb, id: string): FoodWeb {
  return { nodes: web.nodes.map((n) => (n.id === id ? { ...n, alive: false } : n)), edges: web.edges };
}

export function withSpeciesRestored(web: FoodWeb, id: string): FoodWeb {
  return { nodes: web.nodes.map((n) => (n.id === id ? { ...n, alive: true } : n)), edges: web.edges };
}

export function withEdgeDeleted(web: FoodWeb, from: string, to: string): FoodWeb {
  return { nodes: web.nodes, edges: web.edges.filter((e) => !(e.from === from && e.to === to)) };
}

/**
 * Adding a feeding link the learner proposes ("hawks eat rats too!").
 * We deliberately DO NOT renormalise the predator's diet shares: if we did,
 * losing a food source would become harmless and the entire lesson would
 * evaporate. An extra link is extra food; a deleted link is lost food.
 */
export function withEdgeAdded(web: FoodWeb, from: string, to: string): FoodWeb {
  if (web.edges.some((e) => e.from === from && e.to === to)) return web;
  return {
    nodes: web.nodes,
    edges: [...web.edges, { from, to, dietShare: 0.3, dependency: 0.25, learnerAdded: true }],
  };
}

export const CANONICAL_IDS = NODES.map((n) => n.id);

/** Loose matching so the learner can type "snakes", "the frog", "Grass". */
export function resolveSpecies(text: string): string | null {
  const t = text.toLowerCase().trim();
  for (const n of NODES) {
    const base = n.id.toLowerCase();
    if (t === base || t === base + "s" || t.includes(base)) return n.id;
  }
  if (t.includes("decompos") || t.includes("fungi") || t.includes("bacteria")) return "decomposers";
  if (t.includes("plant")) return "grass";
  if (t.includes("eagle") || t.includes("bird")) return "hawk";
  return null;
}

/**
 * "the snakes", "the grass", "the decomposers".
 *
 * Naive name + "s" produces "grasss" and "decomposerss". Anything already ending
 * in s is either uncountable (Grass) or already plural (Decomposers), and in both
 * cases it is left alone.
 */
export function pluralLower(name: string): string {
  const n = name.toLowerCase();
  return n.endsWith("s") ? n : `${n}s`;
}

/**
 * Uncountable names take a singular verb: "the grass IS gone", not "are gone".
 * Generated webs carry this per species; the fallback list covers the built-in web
 * and anything the generator forgets to flag.
 */
const UNCOUNTABLE = new Set(["grass", "algae", "plankton", "phytoplankton", "seaweed", "moss", "bacteria"]);

export function isUncountable(name: string, flag?: boolean): boolean {
  return flag ?? UNCOUNTABLE.has(name.toLowerCase());
}

export function agrees(name: string, flag?: boolean): "is" | "are" {
  return isUncountable(name, flag) ? "is" : "are";
}
