import type {
  Session, LearnerModel, Intake, MisconceptionId, Settled, TranscriptItem,
} from "./types";
import { freshWeb } from "./web";

export const LEARNER_NAME = "Priya";

export function newLearner(): LearnerModel {
  return {
    name: LEARNER_NAME,
    turn: 0,
    scaffoldLevel: 3,
    misconceptions: [
      { id: "linear-chain", label: "thinks only the next animal up the chain is affected", confidence: 0.5 },
      { id: "predator-removal-is-good", label: "thinks removing a predator simply helps its prey", confidence: 0.5 },
    ],
    openThreads: [],
    predictions: [],
    freeTextSubmissions: 0,
    helpRequests: 0,
    selfInitiatedEdits: 0,
    turnsSinceDisagreement: 99,   // so the very first removal produces a disagreement
  };
}

export function freshUi() {
  return {
    selectedId: null,
    guide: null,
    colearner: null,
    checker: null,
    whoChanges: null,
    whoChangesScored: false,
    predictionChoice: null,
    explanation: null,
    pendingEdit: null,
    resolutionRun: false,
    resolutionBaseline: null,
    lastSource: null,
    provider: null,
    buildError: null,
  };
}

export function newSession(): Session {
  return {
    id: `s_${Date.now().toString(36)}`,
    web: freshWeb(),
    removedId: null,
    sim: null,
    learner: newLearner(),
    settled: [],
    transcript: [],
    openDisagreement: null,
    bytesUsed: 0,
    offline: false,
    screen: "login",
    ui: freshUi(),
    username: null,
    chat: [],
  };
}

/**
 * Adaptivity source 1 + 2 + 3: the learner model moves on what she answers,
 * what she asks for help with, and how she interacts (self-initiated edits).
 */
export function applyIntake(session: Session, intake: Intake, utterance: string): Session {
  const learner = { ...session.learner };
  learner.turn += 1;

  if (intake.kind === "answer_attempt") learner.freeTextSubmissions += 1;
  if (intake.kind === "help_request") learner.helpRequests += 1;
  if (intake.kind === "web_edit_request") learner.selfInitiatedEdits += 1;

  learner.misconceptions = learner.misconceptions.map((m) => {
    if (intake.misconceptionSignals.includes(m.id)) {
      return { ...m, confidence: Math.min(1, m.confidence + 0.25) };
    }
    if (intake.kind === "answer_attempt") {
      return { ...m, confidence: Math.max(0, m.confidence - 0.07) };
    }
    return m;
  });

  if (intake.kind === "doubt") {
    learner.openThreads = [
      ...learner.openThreads,
      { id: `t${learner.turn}`, doubt: utterance.slice(0, 200), raisedAtTurn: learner.turn, addressed: false },
    ];
  }

  learner.scaffoldLevel = computeScaffold(learner);
  return { ...session, learner };
}

function computeScaffold(l: LearnerModel): 1 | 2 | 3 {
  const avg = l.misconceptions.reduce((s, m) => s + m.confidence, 0) / l.misconceptions.length;
  const needy = avg + Math.min(l.helpRequests, 4) * 0.05 - Math.min(l.selfInitiatedEdits, 4) * 0.08;
  if (needy >= 0.6) return 3;
  if (needy >= 0.3) return 2;
  return 1;
}

export function markMisconceptionResolved(session: Session, id: MisconceptionId): Session {
  return {
    ...session,
    learner: {
      ...session.learner,
      misconceptions: session.learner.misconceptions.map((m) =>
        m.id === id ? { ...m, confidence: Math.max(0, m.confidence - 0.4) } : m),
    },
  };
}

export function addSettled(session: Session, s: Settled): Session {
  if (session.settled.some((x) => x.question === s.question)) return session;
  return { ...session, settled: [...session.settled, s] };
}

export function say(session: Session, item: Omit<TranscriptItem, "turn">): Session {
  return {
    ...session,
    transcript: [...session.transcript, { ...item, turn: session.learner.turn } as TranscriptItem],
  };
}

export function addressThreads(session: Session): Session {
  return {
    ...session,
    learner: {
      ...session.learner,
      openThreads: session.learner.openThreads.map((t) => ({ ...t, addressed: true })),
    },
  };
}

// ── Persistence (C1: a dropped connection must never lose the session) ─────

const KEY_PREFIX = "et617-foodweb-council-v2";

const keyFor = (username: string | null) => `${KEY_PREFIX}:${username ?? "guest"}`;

export function saveSession(s: Session) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(keyFor(s.username), JSON.stringify(s)); } catch { /* private mode */ }
}

export function loadSession(username: string | null): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(username));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.web?.nodes?.length) return null;
    // Older saved sessions predate these fields.
    if (!parsed.ui) parsed.ui = freshUi();
    if (parsed.ui.buildError === undefined) parsed.ui.buildError = null;
    if (!parsed.chat) parsed.chat = [];
    if (!parsed.web.k) parsed.web.k = undefined;
    return parsed;
  } catch { return null; }
}

export function clearSession(username: string | null) {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(keyFor(username)); } catch { /* ignore */ }
}

export function addChat(session: Session, turn: Session["chat"][number]): Session {
  return { ...session, chat: [...session.chat, turn] };
}
