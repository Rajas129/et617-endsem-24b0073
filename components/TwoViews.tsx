"use client";

import type { Disagreement } from "@/lib/types";

/**
 * The answer to the P3 design challenge, in one component.
 *
 * Two agents disagreeing is rendered as a single decision the learner makes,
 * never as two competing walls of chat. "Both are wrong" and "Not sure yet" are
 * first-class options so siding with an adult is not the only way forward, and
 * nothing resolves until the learner has committed.
 */
export default function TwoViews({
  d, onChoose, onRun, disabled,
}: {
  d: Disagreement;
  onChoose: (c: NonNullable<Disagreement["learnerChoice"]>) => void;
  onRun: () => void;
  disabled?: boolean;
}) {
  const choices = [
    { id: "aarav" as const, label: "Aarav is right" },
    { id: "mira" as const, label: "Mira is right" },
    { id: "both_wrong" as const, label: "They're both wrong" },
    { id: "unsure" as const, label: "I'm not sure yet" },
  ];

  return (
    <section className="twoviews" aria-labelledby="dis-head">
      <div className="head" id="dis-head">⚡ Mira and Aarav disagree</div>
      <div className="q">{d.proposition}</div>

      <div className="views">
        <div className="view aarav">
          <div className="name">AARAV SAYS</div>
          <div className="claim">{d.aaravClaim}</div>
        </div>
        <div className="view mira">
          <div className="name">MIRA SAYS</div>
          <div className="claim">{d.miraClaim}</div>
        </div>
      </div>

      {!d.learnerChoice ? (
        <>
          <p style={{ fontWeight: 650, marginBottom: 8 }}>
            They can&apos;t both be right. What do you think?
          </p>
          <div className="btn-stack">
            {choices.map((c) => (
              <button key={c.id} onClick={() => onChoose(c.id)} disabled={disabled}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="notmarked">Nothing here is marked. A guess is how we start.</p>
        </>
      ) : (
        <>
          <p style={{ marginBottom: 10 }}>
            You said: <strong>{choices.find((c) => c.id === d.learnerChoice)?.label}</strong>.
            {" "}Now let&apos;s find out.
          </p>
          <button className="primary" onClick={onRun} disabled={disabled}>
            Run 12 generations
          </button>
        </>
      )}
    </section>
  );
}
