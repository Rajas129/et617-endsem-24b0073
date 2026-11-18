import { freshWeb, withSpeciesRemoved, withEdgeDeleted } from "../lib/web";
import { simulate } from "../lib/simulate";

function show(label: string, web: ReturnType<typeof freshWeb>, removed: string | null) {
  const sim = simulate(removed ? withSpeciesRemoved(web, removed) : web, removed);
  console.log("\n=== " + label + " ===");
  for (const o of sim.outcomes) {
    console.log(
      `  ${o.name.padEnd(13)} start ${String(o.start).padStart(6)}  min ${String(o.min).padStart(6)}` +
      `  end ${String(o.end).padStart(6)}  ${o.direction.padEnd(8)}` +
      `${o.dippedThenRecovered ? " dip+recover" : ""}  hops=${o.hopsFromRemoval}`,
    );
  }
  console.log("  indirect:", sim.indirectEffects.join(", ") || "(none)");
  console.log("  cascade:");
  for (const c of sim.cascade) console.log("    - " + c);
  if (sim.decidingAssumption) {
    const d = sim.decidingAssumption;
    console.log(`  DECIDING ASSUMPTION: "${d.edgeLabel}"`);
    console.log(`    with arrow:    ${d.predatorName} ends ${d.withAlt.end} (${d.withAlt.direction})`);
    console.log(`    without arrow: ${d.predatorName} ends ${d.withoutAlt.end} (${d.withoutAlt.direction})`);
  } else {
    console.log("  DECIDING ASSUMPTION: none");
  }
  return sim;
}

// 1. Control: untouched web must not drift.
show("CONTROL (nothing removed)", freshWeb(), null);

// 2. The headline scenario.
show("REMOVE FROG", freshWeb(), "frog");

// 3. The resolution experiment: same removal, snake->rat arrow deleted.
const noAlt = withEdgeDeleted(freshWeb(), "rat", "snake");
show("REMOVE FROG + delete snake's rat arrow", noAlt, "frog");

// 4. Misconception 2: removing a predator is "good" for prey.
show("REMOVE SNAKE (predator removal)", freshWeb(), "snake");

// Snake trajectory detail for the Two Views narrative.
const s = simulate(withSpeciesRemoved(freshWeb(), "frog"), "frog");
console.log("\nSnake trajectory:", s.series.map((p) => p.pops.snake).join(" → "));
console.log("Grass trajectory:", s.series.map((p) => p.pops.grass).join(" → "));
console.log("Ghop  trajectory:", s.series.map((p) => p.pops.grasshopper).join(" → "));
console.log("Rat   trajectory:", s.series.map((p) => p.pops.rat).join(" → "));
