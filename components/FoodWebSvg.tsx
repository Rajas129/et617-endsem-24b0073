"use client";

import type { FoodWeb } from "@/lib/types";

/**
 * Inline SVG, roughly 4 KB on the wire and no image request at all (C1).
 * Nodes are real tap targets so the learner can inspect or remove a species.
 */
export default function FoodWebSvg({
  web, pops, selectedId, onSelect, highlightEdge,
}: {
  web: FoodWeb;
  pops?: Record<string, number>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  highlightEdge?: { from: string; to: string } | null;
}) {
  const pos = (id: string) => {
    const n = web.nodes.find((x) => x.id === id)!;
    return { x: n.x, y: n.y };
  };

  const NODE_W = 25;
  const NODE_H = 11;

  // Pull the line back to the edge of each box so arrowheads stay visible.
  const trim = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const pad = 7.2;
    return { x1: ax + ux * pad, y1: ay + uy * pad, x2: bx - ux * pad, y2: by - uy * pad };
  };

  return (
    <svg
      className="websvg"
      viewBox="0 0 100 100"
      role="img"
      aria-label="Food web. Arrows point from what is eaten towards what eats it."
    >
      <defs>
        <marker id="arw" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--ink-faint)" />
        </marker>
        <marker id="arw-hi" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--spark)" />
        </marker>
      </defs>

      {web.edges.map((e) => {
        const a = pos(e.from), b = pos(e.to);
        const { x1, y1, x2, y2 } = trim(a.x, a.y, b.x, b.y);
        const dead =
          !web.nodes.find((n) => n.id === e.from)?.alive ||
          !web.nodes.find((n) => n.id === e.to)?.alive;
        const hi = highlightEdge && highlightEdge.from === e.from && highlightEdge.to === e.to;
        return (
          <line
            key={`${e.from}-${e.to}`}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={hi ? "var(--spark)" : "var(--ink-faint)"}
            strokeWidth={hi ? 1.5 : 0.7}
            strokeDasharray={dead ? "2 2" : e.learnerAdded ? "3 1.5" : undefined}
            opacity={dead ? 0.3 : 1}
            markerEnd={hi ? "url(#arw-hi)" : "url(#arw)"}
          />
        );
      })}

      {web.nodes.map((n) => {
        const selected = selectedId === n.id;
        const value = pops ? Math.round(pops[n.id] ?? 0) : null;
        return (
          <g
            key={n.id}
            className="node-hit"
            onClick={() => onSelect?.(n.id)}
            role={onSelect ? "button" : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={`${n.name}${n.alive ? "" : ", removed"}${value !== null ? `, population ${value}` : ""}`}
            onKeyDown={(ev) => {
              if (onSelect && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); onSelect(n.id); }
            }}
          >
            <rect
              x={n.x - NODE_W / 2} y={n.y - NODE_H / 2}
              width={NODE_W} height={NODE_H} rx={3}
              fill={n.alive ? "var(--card)" : "var(--paper)"}
              stroke={selected ? "var(--leaf)" : n.alive ? "var(--line)" : "var(--ink-faint)"}
              strokeWidth={selected ? 1.4 : 0.7}
              strokeDasharray={n.alive ? undefined : "2 1.5"}
              opacity={n.alive ? 1 : 0.55}
            />
            <text
              x={n.x} y={value !== null ? n.y - 0.6 : n.y + 1.3}
              textAnchor="middle"
              fontSize={3.5} fontWeight={600}
              fill={n.alive ? "var(--ink)" : "var(--ink-faint)"}
              textDecoration={n.alive ? undefined : "line-through"}
            >
              {n.name}
            </text>
            {value !== null && (
              <text x={n.x} y={n.y + 3.6} textAnchor="middle" fontSize={3}
                    fill="var(--ink-soft)">
                {n.alive ? value : "gone"}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
