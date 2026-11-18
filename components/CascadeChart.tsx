"use client";

import type { SimResult } from "@/lib/types";

const DIR_LABEL: Record<string, string> = {
  crashed: "died out", fell: "fell", steady: "barely moved", rose: "went up", boomed: "boomed",
};

/** Whole numbers only: decimals are noise for a Class 7 reader. */
const n = (v: number) => Math.round(v);

function colourFor(dir: string) {
  if (dir === "rose" || dir === "boomed") return "var(--up)";
  if (dir === "fell" || dir === "crashed") return "var(--down)";
  return "var(--flat)";
}

/**
 * Small multiples. Each species gets its own sparkline with its own direct label
 * and its own start→end numbers, so identity is never carried by colour alone
 * and there is no legend to decode. The outcomes table below is the table view.
 */
export default function CascadeChart({ sim }: { sim: SimResult }) {
  const W = 96, H = 28, PAD = 2;

  return (
    <div className="sparks">
      {sim.outcomes.map((o) => {
        const vals = sim.series.map((s) => s.pops[o.id] ?? 0);
        const gone = o.start === 0 && o.end === 0;
        const top = Math.max(...vals, o.start) * 1.12 || 1;

        const x = (i: number) => PAD + (i / (vals.length - 1)) * (W - PAD * 2);
        const y = (v: number) => H - PAD - (v / top) * (H - PAD * 2);

        const points = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
        const colour = colourFor(o.direction);

        return (
          <div className={`spark-row${gone ? " gone" : ""}`} key={o.id}>
            <div className="label">
              <div className="nm">{o.name}</div>
              <div className="vals">
                {gone ? (
                  "removed by you"
                ) : (
                  <>
                    {n(o.start)} → {n(o.end)}{" "}
                    <span className={`dir ${o.direction}`}>{DIR_LABEL[o.direction]}</span>
                  </>
                )}
              </div>
            </div>

            {gone ? (
              <span aria-hidden="true" />
            ) : (
              <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} role="img"
                   aria-label={`${o.name} over ${sim.steps} generations: ${vals.map((v) => Math.round(v)).join(", ")}`}>
                <title>{o.name}: {vals.map((v) => Math.round(v)).join(" → ")}</title>
                {/* where it started, for reference */}
                <line x1={PAD} y1={y(o.start)} x2={W - PAD} y2={y(o.start)}
                      stroke="var(--line)" strokeWidth={1} strokeDasharray="2 2" />
                <polyline points={points} fill="none" stroke={colour}
                          strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r={2.4}
                        fill={colour} stroke="var(--card)" strokeWidth={1} />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The table view, kept beside the charts so no reading depends on the graphics. */
export function OutcomesTable({ sim }: { sim: SimResult }) {
  return (
    <table className="outcomes">
      <thead>
        <tr>
          <th>Species</th>
          <th className="num">Start</th>
          <th className="num">Lowest</th>
          <th className="num">End</th>
          <th>What happened</th>
        </tr>
      </thead>
      <tbody>
        {sim.outcomes.map((o) => {
          const gone = o.start === 0 && o.end === 0;
          return (
            <tr key={o.id}>
              <td>{o.name}</td>
              <td className="num">{gone ? "—" : n(o.start)}</td>
              <td className="num">{gone ? "—" : n(o.min)}</td>
              <td className="num">{gone ? "—" : n(o.end)}</td>
              <td>
                {gone ? <span className="faint">removed by you</span>
                      : <span className={`dir ${o.direction}`}>{DIR_LABEL[o.direction]}</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
