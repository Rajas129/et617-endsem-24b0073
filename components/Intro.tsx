"use client";

/**
 * The definition comes before the activity, because this learner has failed this
 * topic once already: starting her straight into an experiment assumes a footing
 * she may not have. It is deliberately three short ideas, not a lesson.
 */
export default function Intro({ onNext }: { onNext: () => void }) {
  return (
    <>
      <div className="card">
        <h1>What is a food chain?</h1>
        <p>
          Every living thing needs food. A <strong>food chain</strong> shows who eats whom.
        </p>
        <p>We draw it with arrows. The arrow points from the food to whoever eats it.</p>

        <svg viewBox="0 0 100 26" className="websvg" role="img"
             aria-label="Grass is eaten by grasshopper, which is eaten by frog.">
          <defs>
            <marker id="introArw" viewBox="0 0 10 10" refX="9" refY="5"
                    markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--ink-faint)" />
            </marker>
          </defs>
          <line x1="22" y1="13" x2="39" y2="13" stroke="var(--ink-faint)"
                strokeWidth="0.8" markerEnd="url(#introArw)" />
          <line x1="61" y1="13" x2="78" y2="13" stroke="var(--ink-faint)"
                strokeWidth="0.8" markerEnd="url(#introArw)" />
          {[["Grass", 11], ["Grasshopper", 50], ["Frog", 89]].map(([label, x]) => (
            <g key={label as string}>
              <rect x={(x as number) - 10} y="7" width="20" height="12" rx="3"
                    fill="var(--card)" stroke="var(--line)" strokeWidth="0.6" />
              <text x={x as number} y="14.6" textAnchor="middle" fontSize="3.4"
                    fontWeight={600} fill="var(--ink)">{label as string}</text>
            </g>
          ))}
        </svg>

        <p className="faint">
          Read it as: grass is eaten by the grasshopper, and the grasshopper is eaten
          by the frog.
        </p>
      </div>

      <div className="card">
        <h3>Three words we&apos;ll use</h3>
        <p><strong>Producer</strong> — a plant. It makes its own food from sunlight.</p>
        <p><strong>Consumer</strong> — an animal. It has to eat something else.</p>
        <p style={{ marginBottom: 0 }}>
          <strong>Decomposer</strong> — breaks down whatever dies and returns it to the
          soil, so plants can grow again.
        </p>
      </div>

      <div className="card">
        <h3>One more thing, and it&apos;s the important one</h3>
        <p style={{ marginBottom: 0 }}>
          Real life is not a single line. Most animals eat more than one thing, and most
          are eaten by more than one thing. That makes a <strong>web</strong>, not a chain —
          and it is why taking one animal out can change something far away from it.
        </p>
      </div>

      <button className="primary" onClick={onNext}>I&apos;ve got that — what next?</button>
    </>
  );
}
