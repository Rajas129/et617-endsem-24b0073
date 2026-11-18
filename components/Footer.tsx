"use client";

import Link from "next/link";

export const ROLL_NO = process.env.NEXT_PUBLIC_ROLL_NO ?? "24B0073";

/**
 * The identity token sits here, so it appears on every screen (D4).
 * The live byte counter next to it is how the C1 constraint is made visible:
 * every model round-trip ticks it, and the learner can watch it stay small.
 */
export default function Footer({ bytes, offline }: { bytes: number; offline: boolean }) {
  const kb = (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0);
  return (
    <footer className="footer">
      <div className="inner">
        <span>
          ET 617 · <strong>{ROLL_NO}</strong> · <Link href="/about">About</Link>
        </span>
        <span className="data">
          {offline ? "offline mode · " : ""}
          {kb} KB used
        </span>
      </div>
    </footer>
  );
}
