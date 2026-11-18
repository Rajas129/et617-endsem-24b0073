import type { FoodWeb, SimResult } from "./types";
import { pluralLower, agrees } from "./web";

/**
 * The single claim both Mira and Aarav must address, derived in code so the two
 * predictions are always comparable and the conflict detector has something to
 * compare. Shared by the agent pipeline and the predict screen so the question
 * she is asked and the question they answer can never drift apart.
 */
export type Contested = { id: string; name: string; text: string };

export function contested(web: FoodWeb, sim: SimResult | null): Contested | null {
  if (!sim || !sim.removedId) return null;
  const removed = web.nodes.find((n) => n.id === sim.removedId);
  if (!removed) return null;

  // Preferred: the species whose fate flips on one arrow — that is the decidable one.
  const da = sim.decidingAssumption;
  const pick = da
    ? { id: da.predatorId, name: da.predatorName }
    : sim.outcomes.find((o) => o.id !== sim.removedId && o.direction !== "steady");

  if (!pick) return null;

  return {
    id: pick.id,
    name: pick.name,
    text: `What happens to the ${pluralLower(pick.name)} now that the ${pluralLower(removed.name)} ${agrees(removed.name, removed.uncountable)} gone?`,
  };
}
