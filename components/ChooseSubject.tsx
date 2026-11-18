"use client";

import { useState } from "react";

const SUGGESTIONS = ["Snake", "Frog", "Owl", "Shark", "Tiger", "Eagle", "Fish", "Spider"];

/**
 * She names the animal, and the web is built around it. The suggestions exist
 * because a blank box is its own small test for a learner who is braced to get
 * something wrong — but typing anything is allowed.
 */
export default function ChooseSubject({
  onChoose, busy, error,
}: { onChoose: (subject: string) => void; busy: boolean; error: string | null }) {
  const [text, setText] = useState("");

  return (
    <>
      <div className="card">
        <h1>Pick an animal</h1>
        <p className="muted">
          Choose any animal you&apos;re interested in. We&apos;ll build its food web —
          what it eats, and what eats it — and then you can start taking things out of it.
        </p>

        <label htmlFor="subject" style={{ fontWeight: 600, fontSize: "0.92rem" }}>
          Which animal?
        </label>
        <input id="subject" type="text" value={text} placeholder="snake"
               autoCapitalize="none" spellCheck={false}
               onChange={(e) => setText(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) onChoose(text.trim()); }} />

        <p className="faint" style={{ marginTop: 8 }}>Or tap one of these:</p>
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="inline" onClick={() => setText(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>

        {error && <p className="banner offline" style={{ marginTop: 12 }}>{error}</p>}

        <button className="primary" style={{ marginTop: 14 }}
                disabled={busy || !text.trim()} onClick={() => onChoose(text.trim())}>
          {busy ? "Building the web…" : `Build the food web`}
        </button>
      </div>

      {busy && (
        <div className="card" aria-live="polite" aria-busy="true">
          <div className="skeleton" style={{ width: "60%" }} />
          <div className="skeleton" style={{ width: "85%" }} />
          <div className="skeleton" style={{ width: "40%" }} />
          <p className="faint" style={{ marginBottom: 0 }}>
            Working out what it eats and what eats it…
          </p>
        </div>
      )}
    </>
  );
}
