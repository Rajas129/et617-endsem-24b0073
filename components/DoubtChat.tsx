"use client";

import { useState } from "react";
import type { ChatTurn } from "@/lib/types";
import AgentLine, { LearnerLine } from "./AgentLine";

/**
 * A plain place to be confused.
 *
 * Separate from the council on purpose: a learner who just wants to ask what a
 * decomposer is should not have to commit a prediction and watch two agents argue
 * to get an answer.
 */
export default function DoubtChat({
  chat, busy, onAsk, onApplyEdit, editLabel,
}: {
  chat: ChatTurn[];
  busy: boolean;
  onAsk: (q: string) => void;
  onApplyEdit: (e: NonNullable<ChatTurn["proposedEdit"]>) => void;
  editLabel: (e: NonNullable<ChatTurn["proposedEdit"]>) => string;
}) {
  const [text, setText] = useState("");
  const last = chat[chat.length - 1];
  const pending = last?.who === "mira" ? last.proposedEdit : null;

  function send() {
    const q = text.trim();
    if (!q) return;
    setText("");
    onAsk(q);
  }

  return (
    <>
      <div className="card">
        <h2>Ask Mira</h2>
        <p className="faint" style={{ marginBottom: 0 }}>
          Anything at all about the web. Nothing here is marked, and no question is
          too small.
        </p>
      </div>

      {chat.length === 0 && (
        <div className="card">
          <p className="muted" style={{ marginBottom: 0 }}>
            Things people ask: <em>what does a decomposer do?</em> ·{" "}
            <em>why is the arrow that way round?</em> · <em>what if it rains less?</em>
          </p>
        </div>
      )}

      {chat.map((t, i) =>
        t.who === "learner"
          ? <LearnerLine key={i} text={t.text} />
          : <AgentLine key={i} agent="mira" text={t.text} />,
      )}

      {busy && (
        <div className="card" aria-live="polite" aria-busy="true">
          <div className="skeleton" style={{ width: "72%" }} />
          <div className="skeleton" style={{ width: "48%" }} />
        </div>
      )}

      {pending && (
        <div className="card">
          <h3>Shall we try that?</h3>
          <p>
            You&apos;re describing a change to the web: <strong>{editLabel(pending)}</strong>.
            We can make it and run the experiment again.
          </p>
          <button className="primary" onClick={() => onApplyEdit(pending)} disabled={busy}>
            Change the web and run it
          </button>
        </div>
      )}

      <div className="card">
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="What I don't get is…" />
        <p className="notmarked">Not marked.</p>
        <button className="primary" disabled={!text.trim() || busy} onClick={send}>
          {busy ? "…" : "Ask"}
        </button>
      </div>
    </>
  );
}
