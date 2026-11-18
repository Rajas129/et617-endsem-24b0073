"use client";

const META = {
  mira:  { who: "Mira",    initials: "M",  role: "your guide" },
  aarav: { who: "Aarav",   initials: "A",  role: "your classmate" },
  sen:   { who: "Dr. Sen", initials: "DS", role: "checks the evidence" },
} as const;

export type AgentId = keyof typeof META;

export default function AgentLine({
  agent, text, nextAction, showRole,
}: {
  agent: AgentId; text: string; nextAction?: string | null; showRole?: boolean;
}) {
  const m = META[agent];
  return (
    <div className={`agent ${agent}`}>
      <div className="av" aria-hidden="true">{m.initials}</div>
      <div className="body">
        <div className="who">
          {m.who}
          {showRole && <span className="faint" style={{ fontWeight: 400 }}> · {m.role}</span>}
        </div>
        <div className="bubble">{text}</div>
        {nextAction && <div className="nextaction">→ {nextAction}</div>}
      </div>
    </div>
  );
}

export function LearnerLine({ text }: { text: string }) {
  return (
    <div className="agent learner">
      <div className="body" style={{ flex: "0 1 auto" }}>
        <div className="bubble">{text}</div>
      </div>
    </div>
  );
}

export function Thinking() {
  return (
    <div className="card" aria-live="polite" aria-busy="true">
      <div className="skeleton" style={{ width: "70%" }} />
      <div className="skeleton" style={{ width: "92%" }} />
      <div className="skeleton" style={{ width: "45%" }} />
      <div className="faint">Mira and Aarav are thinking…</div>
    </div>
  );
}
