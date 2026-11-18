"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type {
  Session, Disagreement, GuideRecord, CoLearnerRecord, CheckerRecord, Screen,
} from "@/lib/types";
import {
  newSession, loadSession, saveSession, clearSession, applyIntake, addSettled,
  markMisconceptionResolved, addressThreads, freshUi, addChat,
} from "@/lib/session";
import type { ChatTurn, FoodWeb } from "@/lib/types";
import Login from "@/components/Login";
import Intro from "@/components/Intro";
import ChooseSubject from "@/components/ChooseSubject";
import DoubtChat from "@/components/DoubtChat";
import {
  withSpeciesRemoved, withEdgeDeleted, withEdgeAdded, speciesName, preyOf, predatorsOf,
  pluralLower, agrees,
} from "@/lib/web";
import { contested } from "@/lib/proposition";
import { simulate } from "@/lib/simulate";
import { whoChangesFeedback, overshootNote, indirectNote } from "@/lib/feedback";
import FoodWebSvg from "@/components/FoodWebSvg";
import CascadeChart, { OutcomesTable } from "@/components/CascadeChart";
import AgentLine, { LearnerLine, Thinking } from "@/components/AgentLine";
import TwoViews from "@/components/TwoViews";
import Footer from "@/components/Footer";

const STEP_LABEL: Record<Screen, string> = {
  login: "", home: "", intro: "First, the idea", choose: "Pick an animal",
  building: "Building your web", explorer: "Step 1 of 5", predict: "Step 2 of 5",
  council: "Step 3 of 5", simulation: "Step 4 of 5", settled: "Step 5 of 5",
  chat: "Ask Mira", about: "",
};

/** Screens where the learner has a web and the tab bar is useful. */
const WORKING: Screen[] = ["explorer", "predict", "council", "simulation", "settled", "chat"];

export default function Page() {
  const [s, setS] = useState<Session | null>(null);
  const [resumeTo, setResumeTo] = useState<Screen | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  // Always-current session for the async phase calls. Reading `s` inside them
  // captures the value from the render that created them, which is stale by the
  // time a state update + follow-up request have run.
  const sRef = useRef<Session | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let username: string | null = null;
      try {
        const res = await fetch("/api/auth");
        username = ((await res.json()) as { username: string | null }).username;
      } catch { /* offline: treat as signed out */ }
      if (cancelled) return;
      boot(username);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function boot(username: string | null) {
    if (!username) {
      const fresh = { ...newSession(), screen: "login" as Screen };
      sRef.current = fresh;
      setS(fresh);
      return;
    }
    const saved = loadSession(username);
    // Always land on home so "Continue" is a choice, but remember the exact
    // screen she stopped on — resuming somewhere else loses her place (C1).
    const resumable = saved && WORKING.includes(saved.screen);
    const initial: Session = resumable
      ? { ...saved!, username, screen: "home" }
      : { ...newSession(), username, screen: "intro" };
    if (resumable) setResumeTo(saved!.screen);
    sRef.current = initial;
    setS(initial);
  }

  const update = useCallback((fn: (prev: Session) => Session) => {
    setS((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      sRef.current = next;
      saveSession(next);
      return next;
    });
  }, []);

  if (!s) return <main className="shell"><div className="skeleton" style={{ marginTop: 40 }} /></main>;

  const go = (screen: Screen) => update((p) => ({ ...p, screen }));

  // ── Phase 1: Mira + Aarav predict, blind to the simulator ────────────────
  async function runPredict(utterance: string) {
    setBusy(true);
    const current = sRef.current!;
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "predict", session: current, utterance }),
      });
      const data = await res.json() as {
        intake?: Parameters<typeof applyIntake>[1];
        guide?: GuideRecord; colearner?: CoLearnerRecord;
        disagreement?: Disagreement | null;
        bytes?: number; source?: "model" | "fallback"; provider?: string;
      };

      update((p) => {
        let next = data.intake ? applyIntake(p, data.intake, utterance) : { ...p, learner: { ...p.learner, turn: p.learner.turn + 1 } };
        next = {
          ...next,
          transcript: [...next.transcript, { kind: "learner", text: utterance, turn: next.learner.turn }],
          openDisagreement: data.disagreement ?? next.openDisagreement,
          bytesUsed: next.bytesUsed + (data.bytes ?? 0),
          offline: data.source === "fallback",
          learner: {
            ...next.learner,
            turnsSinceDisagreement: data.disagreement ? 0 : next.learner.turnsSinceDisagreement + 1,
          },
          ui: {
            ...next.ui,
            guide: data.guide ?? null,
            colearner: data.colearner ?? null,
            checker: null,
            pendingEdit: data.intake?.proposedEdit ?? null,
            lastSource: data.source ?? "fallback",
            provider: data.provider ?? null,
          },
          screen: "council" as Screen,
        };
        return next;
      });
    } finally { setBusy(false); }
  }

  // ── Phase 2: Dr. Sen adjudicates against the simulator ───────────────────
  async function runAdjudicate() {
    setBusy(true);
    const current = sRef.current!;
    try {
      const res = await fetch("/api/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "adjudicate", session: current }),
      });
      const data = await res.json() as {
        checker?: CheckerRecord; bytes?: number; source?: "model" | "fallback"; provider?: string;
      };

      update((p) => {
        let next: Session = {
          ...p,
          bytesUsed: p.bytesUsed + (data.bytes ?? 0),
          offline: data.source === "fallback",
          openDisagreement: p.openDisagreement
            ? { ...p.openDisagreement, resolved: true } : null,
          ui: { ...p.ui, checker: data.checker ?? null, provider: data.provider ?? p.ui.provider },
        };
        next = addressThreads(next);
        if (data.checker?.settled) next = addSettled(next, data.checker.settled);
        return next;
      });
    } finally { setBusy(false); }
  }

  async function signOut() {
    try { await fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    }); } catch { /* ignore */ }
    const fresh = { ...newSession(), screen: "login" as Screen };
    sRef.current = fresh; setResumeTo(null); setS(fresh);
  }

  /** Ask the model to build a web around whatever animal she named. */
  async function buildWeb(subject: string) {
    update((p) => ({ ...p, screen: "building", ui: { ...p.ui, buildError: null } }));
    try {
      const res = await fetch("/api/web", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject }),
      });
      const data = await res.json() as {
        web?: FoodWeb; bytes?: number; source?: "model" | "fallback"; note?: string; error?: string;
      };

      if (!data.web) {
        update((p) => ({
          ...p, screen: "choose",
          ui: { ...p.ui, buildError: "That didn't work. Try another animal, or the same one again." },
        }));
        return;
      }

      update((p) => ({
        ...p,
        web: data.web!,
        removedId: null,
        sim: null,
        openDisagreement: null,
        settled: [],
        transcript: [],
        learner: { ...p.learner, turnsSinceDisagreement: 99 },
        bytesUsed: p.bytesUsed + (data.bytes ?? 0),
        offline: data.source === "fallback",
        ui: { ...freshUi(), buildError: null },
        screen: "explorer",
      }));
    } catch {
      update((p) => ({
        ...p, screen: "choose",
        ui: { ...p.ui, buildError: "Couldn't reach the server. Check your connection." },
      }));
    }
  }

  async function askMira(question: string) {
    setBusy(true);
    update((p) => addChat(p, { who: "learner", text: question }));
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "chat", session: sRef.current, question }),
      });
      const data = await res.json() as {
        turn?: ChatTurn; bytes?: number; source?: "model" | "fallback"; provider?: string;
      };
      update((p) => ({
        ...addChat(p, data.turn ?? { who: "mira", text: "I couldn't answer that one. Try asking it another way?" }),
        bytesUsed: p.bytesUsed + (data.bytes ?? 0),
        offline: data.source === "fallback",
      }));
    } finally { setBusy(false); }
  }

  function removeSpecies(id: string) {
    update((p) => {
      const web = withSpeciesRemoved(p.web, id);
      // The simulator runs NOW, before any agent speaks — but nothing is shown
      // until the learner has committed a prediction.
      return {
        ...p, web, removedId: id, sim: simulate(web, id),
        openDisagreement: null,
        ui: { ...freshUi(), selectedId: null },
        screen: "predict",
      };
    });
  }

  /** The resolution experiment: delete the deciding arrow and run it again. */
  function runResolutionExperiment() {
    update((p) => {
      const da = p.sim!.decidingAssumption!;
      const web = withEdgeDeleted(p.web, da.altPreyId, da.predatorId);
      return {
        ...p, web, sim: simulate(web, p.removedId),
        learner: { ...p.learner, selfInitiatedEdits: p.learner.selfInitiatedEdits + 1 },
        ui: {
          ...p.ui, checker: null, resolutionRun: true,
          resolutionBaseline: {
            predatorName: da.predatorName,
            edgeLabel: da.edgeLabel,
            withArrowEnd: da.withAlt.end,
          },
        },
        screen: "simulation",
      };
    });
    setTimeout(() => void runAdjudicate(), 30);
  }

  function applyPendingEdit() {
    update((p) => {
      const e = p.ui.pendingEdit!;
      const web = e.op === "add_edge"
        ? withEdgeAdded(p.web, e.from, e.to)
        : withEdgeDeleted(p.web, e.from, e.to);
      return {
        ...p, web, sim: simulate(web, p.removedId),
        learner: { ...p.learner, selfInitiatedEdits: p.learner.selfInitiatedEdits + 1 },
        ui: { ...p.ui, pendingEdit: null, checker: null },
        screen: "simulation",
      };
    });
    setTimeout(() => void runAdjudicate(), 30);
  }

  const sim = s.sim;
  const da = sim?.decidingAssumption ?? null;
  const selected = s.ui.selectedId ? s.web.nodes.find((n) => n.id === s.ui.selectedId) : null;

  if (s.screen === "login") {
    return (
      <>
        <main className="shell">
          <header className="topbar">
            <span className="title">Food Web Council</span>
          </header>
          <Login onSignedIn={(username) => boot(username)} />
        </main>
        <Footer bytes={0} offline={false} />
      </>
    );
  }

  const onWorkingScreen = WORKING.includes(s.screen);

  return (
    <>
      <main className={`shell${onWorkingScreen ? " has-tabbar" : ""}`}>
        <header className="topbar">
          <span className="title">
            {s.web.subject ? `${s.web.subject} food web` : "Food Web Council"}
          </span>
          <span className="step">{STEP_LABEL[s.screen]}</span>
        </header>

        {s.offline && (
          <div className="banner offline">
            Mira, Aarav and Dr. Sen are offline right now. You are seeing a{" "}
            <strong>saved example conversation</strong>. Everything else still works —
            you can keep removing species and running experiments.
          </div>
        )}

        {/* ── HOME ───────────────────────────────────────────────────────── */}
        {s.screen === "home" && (
          <>
            <div className="card">
              <h1>Welcome back{s.username ? `, ${s.username}` : ""}</h1>
              <p className="muted">
                Take one animal out of a food web and find out what happens to everybody else.
                Three helpers will argue about it. You decide who is right.
              </p>
              <p className="faint">
                Nothing here is marked. There is no score, and you can take as long as you like.
              </p>
            </div>

            <div className="btn-stack">
              {resumeTo && (
                <button className="primary" onClick={() => go(resumeTo)}>
                  Continue where you left off
                </button>
              )}
              <button className={resumeTo ? "" : "primary"} onClick={() => {
                const username = s.username;
                clearSession(username);
                const fresh: Session = { ...newSession(), username, screen: "intro" };
                setResumeTo(null); sRef.current = fresh; setS(fresh); saveSession(fresh);
              }}>
                Start a new food web
              </button>
              <button className="ghost" onClick={signOut}>Sign out</button>
            </div>
          </>
        )}

        {/* ── INTRO ──────────────────────────────────────────────────────── */}
        {s.screen === "intro" && <Intro onNext={() => go("choose")} />}

        {/* ── CHOOSE + BUILD ─────────────────────────────────────────────── */}
        {(s.screen === "choose" || s.screen === "building") && (
          <ChooseSubject busy={s.screen === "building"} error={s.ui.buildError}
                         onChoose={buildWeb} />
        )}

        {/* ── CHAT ───────────────────────────────────────────────────────── */}
        {s.screen === "chat" && (
          <DoubtChat
            chat={s.chat} busy={busy} onAsk={askMira}
            editLabel={(e) => `${speciesName(s.web, e.from)} → ${speciesName(s.web, e.to)}`}
            onApplyEdit={(e) => {
              update((p) => ({ ...p, ui: { ...p.ui, pendingEdit: e } }));
              applyPendingEdit();
            }}
          />
        )}

        {/* ── EXPLORER ───────────────────────────────────────────────────── */}
        {s.screen === "explorer" && (
          <>
            <div className="card">
              <h2>This is our food web</h2>
              <p className="faint" style={{ marginBottom: 10 }}>
                An arrow points from the food to whoever eats it. Tap any animal.
              </p>
              <FoodWebSvg
                web={s.web}
                selectedId={s.ui.selectedId}
                onSelect={(id) => update((p) => ({ ...p, ui: { ...p.ui, selectedId: id } }))}
              />
              {s.web.nodes.some((n) => n.role === "decomposer") && (
                <p className="faint">
                  Decomposers get dead matter from everyone, so they have no single arrow.
                </p>
              )}
            </div>

            {selected ? (
              <div className="card">
                <h3>{selected.name}</h3>
                <p style={{ marginBottom: 6 }}>
                  <strong>Eats:</strong>{" "}
                  {preyOf(s.web, selected.id).map((e) => speciesName(s.web, e.from)).join(", ")
                    || (selected.role === "producer" ? "makes its own food from sunlight"
                        : "dead matter from everyone")}
                </p>
                <p style={{ marginBottom: 12 }}>
                  <strong>Eaten by:</strong>{" "}
                  {predatorsOf(s.web, selected.id).map((e) => speciesName(s.web, e.to)).join(", ") || "nothing here"}
                </p>
                {selected.alive ? (
                  <button className="primary" onClick={() => removeSpecies(selected.id)}>
                    Take all the {pluralLower(selected.name)} out
                  </button>
                ) : <span className="chip removed">already removed</span>}
              </div>
            ) : (
              <div className="card"><p className="muted" style={{ margin: 0 }}>Tap an animal to see what it eats.</p></div>
            )}
          </>
        )}

        {/* ── PREDICT ────────────────────────────────────────────────────── */}
        {s.screen === "predict" && sim && (
          <PredictScreen
            session={s} onBack={() => go("explorer")}
            onWhoChanges={(ids) => update((p) => ({ ...p, ui: { ...p.ui, whoChanges: ids } }))}
            onCommit={(choice, why) => {
              update((p) => ({
                ...p,
                learner: {
                  ...p.learner,
                  predictions: [...p.learner.predictions,
                    { proposition: contested(p.web, p.sim)?.text ?? "What happens next",
                      learnerGuess: choice, outcome: null }],
                },
                ui: { ...p.ui, predictionChoice: choice },
              }));
              void runPredict(why?.trim() ? `${choice}. ${why.trim()}` : choice);
            }}
            busy={busy}
          />
        )}

        {/* ── COUNCIL ────────────────────────────────────────────────────── */}
        {s.screen === "council" && (
          <>
            {s.ui.predictionChoice && <LearnerLine text={s.ui.predictionChoice} />}
            {busy && !s.ui.guide ? <Thinking /> : (
              <>
                {s.ui.guide && (
                  <AgentLine agent="mira" text={s.ui.guide.say}
                             nextAction={s.openDisagreement ? null : s.ui.guide.nextAction} showRole />
                )}
                {s.ui.colearner && <AgentLine agent="aarav" text={s.ui.colearner.say} showRole />}
              </>
            )}

            <details className="card webpeek">
              <summary>Look at the food web again</summary>
              <FoodWebSvg web={s.web} />
            </details>

            {s.openDisagreement && !s.openDisagreement.resolved && (
              <TwoViews
                d={s.openDisagreement}
                disabled={busy}
                onChoose={(c) => update((p) => ({
                  ...p, openDisagreement: { ...p.openDisagreement!, learnerChoice: c },
                }))}
                onRun={() => go("simulation")}
              />
            )}

            {s.ui.pendingEdit && (
              <div className="card">
                <h3>Change the web?</h3>
                <p>
                  You said something about <strong>
                    {speciesName(s.web, s.ui.pendingEdit.from)} → {speciesName(s.web, s.ui.pendingEdit.to)}
                  </strong>. Shall we {s.ui.pendingEdit.op === "add_edge" ? "add" : "delete"} that arrow and see what changes?
                </p>
                <div className="btn-pair">
                  <button className="primary" onClick={applyPendingEdit}>Yes, change it</button>
                  <button onClick={() => update((p) => ({ ...p, ui: { ...p.ui, pendingEdit: null } }))}>
                    Not now
                  </button>
                </div>
              </div>
            )}

            {!s.openDisagreement && !s.ui.pendingEdit && (
              <button className="primary" onClick={() => go("simulation")} disabled={busy}>
                Run 12 generations
              </button>
            )}

            <AskBox draft={draft} setDraft={setDraft} busy={busy}
                    onAsk={() => { const t = draft; setDraft(""); void runPredict(t); }} />
          </>
        )}

        {/* ── SIMULATION ─────────────────────────────────────────────────── */}
        {s.screen === "simulation" && sim && (
          <SimulationScreen
            session={s} busy={busy}
            onAdjudicate={runAdjudicate}
            onResolution={runResolutionExperiment}
            onExplain={(text) => {
              update((p) => ({ ...p, ui: { ...p.ui, explanation: text } }));
              void runPredict(text);
            }}
            onSettled={() => go("settled")}
            onResolveMisconception={() => update((p) => markMisconceptionResolved(p, "linear-chain"))}
          />
        )}

        {/* ── SETTLED ────────────────────────────────────────────────────── */}
        {s.screen === "settled" && (
          <>
            <div className="card">
              <h2>What we settled</h2>
              {s.settled.length === 0 ? (
                <p className="muted">Nothing yet. Run an experiment and we&apos;ll write down what we find.</p>
              ) : (
                <div className="settled">
                  {s.settled.map((item, i) => (
                    <div className="item" key={i}>
                      <div className="q">{item.question}</div>
                      <div className="a">{item.answer}</div>
                      <div className="how">How we know: {item.howWeKnow}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card">
              <p className="faint" style={{ margin: 0 }}>
                You found {s.settled.length} {s.settled.length === 1 ? "thing" : "things"} by running
                experiments yourself, and you changed the web {s.learner.selfInitiatedEdits}{" "}
                {s.learner.selfInitiatedEdits === 1 ? "time" : "times"}.
              </p>
            </div>
            <div className="btn-stack">
              <button className="primary" onClick={() => go("explorer")}>Try another species</button>
              <button className="ghost" onClick={() => go("home")}>Stop for now (your place is saved)</button>
            </div>
          </>
        )}
      </main>

      {onWorkingScreen && (
        <nav className="tabbar" aria-label="Sections">
          <div className="inner">
            <button aria-current={s.screen === "explorer"} onClick={() => go("explorer")}>
              The web
            </button>
            <button aria-current={s.screen === "simulation"}
                    disabled={!s.sim}
                    onClick={() => go(s.sim ? "simulation" : "explorer")}>
              Results
            </button>
            <button aria-current={s.screen === "chat"} onClick={() => go("chat")}>
              Ask Mira
            </button>
            <button aria-current={s.screen === "settled"} onClick={() => go("settled")}>
              Settled{s.settled.length ? ` (${s.settled.length})` : ""}
            </button>
          </div>
        </nav>
      )}

      <Footer bytes={s.bytesUsed} offline={s.offline} />
    </>
  );
}

// ── Predict screen: task 1 (multi-select) then task 2 (commitment) ─────────

function PredictScreen({
  session, onWhoChanges, onCommit, onBack, busy,
}: {
  session: Session;
  onWhoChanges: (ids: string[]) => void;
  onCommit: (choice: string, why: string) => void;
  onBack: () => void;
  busy: boolean;
}) {
  const [picked, setPicked] = useState<string[]>(session.ui.whoChanges ?? []);
  const [choice, setChoice] = useState<string | null>(null);
  const [why, setWhy] = useState("");

  const sim = session.sim!;
  const removedNode = session.web.nodes.find((n) => n.id === sim.removedId);
  const removedName = removedNode?.name ?? speciesName(session.web, sim.removedId!);
  const removed = pluralLower(removedName);
  const removedVerb = agrees(removedName, removedNode?.uncountable);
  const candidates = session.web.nodes.filter((n) => n.id !== sim.removedId);
  const committed = session.ui.whoChanges !== null;

  // Derived from the same helper the agents use, so she is never asked about one
  // species while Mira and Aarav argue about another. Removing an apex predator
  // leaves nothing contested, and task 2 is simply skipped rather than asking
  // about "the others".
  const c = contested(session.web, sim);
  const target = c ? pluralLower(c.name) : null;

  const options = target ? [
    `The ${target} will die out completely.`,
    `The ${target} will drop but survive.`,
    `The ${target} won't change much.`,
    `The ${target} will go up.`,
  ] : [];

  return (
    <>
      <div className="card">
        <h2>All the {removed} {removedVerb} gone</h2>
        <p className="muted">
          Before we run anything, make two guesses. Guessing first is what scientists do.
        </p>
        {/* She is being asked to follow the arrows, so the arrows stay in front of
            her the whole time. Making her remember the web is a memory test, and a
            memory test is exactly what this learner shuts down in front of. */}
        <FoodWebSvg web={session.web} />
        <p className="faint" style={{ marginBottom: 0 }}>
          The {removed} {removedVerb} crossed out. Follow the arrows from there.
        </p>
      </div>

      <div className="card">
        <h3>1. Tick everyone who changes</h3>
        <p className="faint">Tick as many as you like. Not marked.</p>
        <div className="btn-stack" style={{ marginBottom: 10 }}>
          {candidates.map((n) => {
            const on = picked.includes(n.id);
            return (
              <button key={n.id} className="row" aria-pressed={on}
                      disabled={committed}
                      onClick={() => setPicked((p) => on ? p.filter((x) => x !== n.id) : [...p, n.id])}>
                <span>{n.name}</span>
                <span className="chip">{on ? "✓ changes" : "no change"}</span>
              </button>
            );
          })}
        </div>
        {!committed && (
          <button className="primary" onClick={() => onWhoChanges(picked)}>
            Lock in my ticks
          </button>
        )}
        {committed && <span className="chip">locked in — we&apos;ll check it after the run</span>}
      </div>

      {committed && target && (
        <div className="card">
          <h3>2. What happens to the {target}?</h3>
          <div className="btn-stack" style={{ marginBottom: 10 }}>
            {options.map((o) => (
              <button key={o} aria-pressed={choice === o}
                      style={choice === o ? { borderColor: "var(--leaf)", borderWidth: 2 } : undefined}
                      onClick={() => setChoice(o)}>
                {o}
              </button>
            ))}
          </div>
          <label htmlFor="why" style={{ fontWeight: 600, fontSize: "0.92rem" }}>
            Why do you think so?
          </label>
          <textarea id="why" rows={3} value={why} onChange={(e) => setWhy(e.target.value)}
                    placeholder="Thinking out loud is fine…" />
          <p className="notmarked">This box is thinking out loud. It is not marked.</p>
          <button className="primary" disabled={!choice || busy}
                  onClick={() => onCommit(choice!, why)}>
            {busy ? "…" : "Commit my guess"}
          </button>
        </div>
      )}

      {committed && !target && (
        <div className="card">
          <p>Nothing else in this web depends on them. Let&apos;s run it and see.</p>
          <button className="primary" disabled={busy}
                  onClick={() => onCommit("Let's just run it and see.", "")}>
            {busy ? "…" : "Run it"}
          </button>
        </div>
      )}

      <button className="ghost" onClick={onBack}>← Back to the web</button>
    </>
  );
}

// ── Simulation screen ─────────────────────────────────────────────────────

function SimulationScreen({
  session, busy, onAdjudicate, onResolution, onExplain, onSettled, onResolveMisconception,
}: {
  session: Session; busy: boolean;
  onAdjudicate: () => void; onResolution: () => void;
  onExplain: (text: string) => void; onSettled: () => void;
  onResolveMisconception: () => void;
}) {
  const [explain, setExplain] = useState("");
  const sim = session.sim!;
  const da = sim.decidingAssumption;
  // Her ticks were locked against the ORIGINAL web. Once she edits an arrow the
  // correct set changes, so re-grading them would mark her against a different question.
  const fb = session.ui.whoChanges && !session.ui.resolutionRun
    ? whoChangesFeedback(sim, session.web, session.ui.whoChanges) : null;
  const overshoot = overshootNote(sim, session.web);
  const indirect = indirectNote(sim, session.web);
  const checker = session.ui.checker;

  useEffect(() => {
    if (!checker && !busy) onAdjudicate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (fb && fb.fired === null) onResolveMisconception(); }, [fb, onResolveMisconception]);

  return (
    <>
      <div className="card">
        <h2>What happened</h2>
        <p className="faint" style={{ marginBottom: 10 }}>
          {sim.steps} generations after the {pluralLower(speciesName(session.web, sim.removedId!))} were removed.
        </p>
        <FoodWebSvg
          web={session.web}
          pops={sim.series[sim.series.length - 1].pops}
          highlightEdge={da ? { from: da.altPreyId, to: da.predatorId } : null}
        />
      </div>

      <div className="card">
        <h3>Every species, generation by generation</h3>
        <CascadeChart sim={sim} />
      </div>

      {fb && (
        <div className="card">
          <h3>Your ticks</h3>
          <p style={{ marginBottom: 0 }}>{fb.text}</p>
        </div>
      )}

      {(indirect || overshoot) && (
        <div className="card">
          {indirect && <p><strong>{indirect}</strong></p>}
          {overshoot && <p style={{ marginBottom: 0 }}>{overshoot}</p>}
        </div>
      )}

      {busy && !checker ? <Thinking /> : checker && (
        <>
          <AgentLine agent="sen" text={checker.say} showRole />
          {/* Two different reasons produce a templated Dr. Sen, and conflating them
              would tell the learner something untrue about what just happened. */}
          {!checker.verified && session.ui.lastSource === "model" && (
            <p className="faint">
              Dr. Sen is reading straight from the numbers here, because his first
              reply did not match the result and was thrown away.
            </p>
          )}
          {!checker.verified && session.ui.lastSource !== "model" && (
            <p className="faint">
              Dr. Sen is reading straight from the simulation, because the helpers
              are offline. These numbers are still real.
            </p>
          )}
        </>
      )}

      {da && !session.ui.resolutionRun && checker && (
        <div className="card">
          <h3>Settle it properly</h3>
          <p>
            The whole argument rests on one arrow: <strong>{da.edgeLabel}</strong>.
            Delete it and run the same experiment again.
          </p>
          <button className="primary" onClick={onResolution} disabled={busy}>
            Delete {da.edgeLabel} and run again
          </button>
        </div>
      )}

      {checker && (
        <div className="card">
          <h3>Why did that happen?</h3>
          <textarea rows={3} value={explain} onChange={(e) => setExplain(e.target.value)}
                    placeholder="Say it in your own words…" />
          <p className="notmarked">Not marked. Mira will read it and talk it through.</p>
          <button disabled={!explain.trim() || busy} onClick={() => onExplain(explain)}>
            Tell Mira
          </button>
        </div>
      )}

      <div className="card">
        <h3>The numbers</h3>
        <OutcomesTable sim={sim} />
      </div>

      <div className="nav">
        <button className="inline" onClick={onSettled}>What we settled →</button>
      </div>
    </>
  );
}

function AskBox({
  draft, setDraft, busy, onAsk,
}: { draft: string; setDraft: (v: string) => void; busy: boolean; onAsk: () => void }) {
  return (
    <div className="card">
      <h3>Ask something</h3>
      <p className="faint">
        Anything you&apos;re wondering. If you say something like &ldquo;but hawks eat rats
        too&rdquo;, we can change the web and run it again.
      </p>
      <textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder="But what if…" />
      <p className="notmarked">Not marked.</p>
      <button disabled={!draft.trim() || busy} onClick={onAsk}>
        {busy ? "…" : "Ask"}
      </button>
    </div>
  );
}
