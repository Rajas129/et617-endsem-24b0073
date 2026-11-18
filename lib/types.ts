// ── Domain: the food web ────────────────────────────────────────────────────
export type Role = "producer" | "consumer" | "decomposer";

export type Species = {
  id: string;
  name: string;
  role: Role;
  baseline: number;      // equilibrium population
  growth: number;        // r — lower trophic levels respond faster
  alive: boolean;        // learner can remove a species
  level: number;         // trophic stage, 0 = producer
  uncountable?: boolean; // "the grass is gone" vs "the frogs are gone"
  x: number;             // layout for the SVG (0..100 viewBox space)
  y: number;
};

export type Edge = {
  from: string;          // prey  (energy source)
  to: string;            // predator (energy sink)
  dietShare: number;     // share of `to`'s diet that `from` provides
  dependency: number;    // how much of `from`'s death rate `to` causes
  learnerAdded?: boolean;
};

export type FoodWeb = {
  nodes: Species[];
  edges: Edge[];
  /** Topic the learner asked for, e.g. "snake". Null for the built-in web. */
  subject?: string | null;
  /**
   * Carrying capacities, derived ONCE when the web is created and then carried
   * with it. They must not be recomputed after a learner edit: if they were,
   * deleting a feeding arrow would silently rebalance the system and cost the
   * predator nothing, which is the entire lesson.
   */
  k?: Record<string, number>;
};

// ── Simulator output (this is the ground truth all AI claims are checked against)
export type SeriesPoint = { step: number; pops: Record<string, number> };

export type SpeciesOutcome = {
  id: string;
  name: string;
  start: number;
  min: number;
  max: number;
  end: number;
  direction: "crashed" | "fell" | "steady" | "rose" | "boomed";
  dippedThenRecovered: boolean;
  hopsFromRemoval: number | null;   // graph distance, ignoring arrow direction
};

export type SimResult = {
  removedId: string | null;
  steps: number;
  series: SeriesPoint[];
  outcomes: SpeciesOutcome[];
  /** Species >= 2 hops from the removal that still moved more than 15% — the cascade. */
  indirectEffects: string[];
  cascade: string[];                 // plain-language step list, generated in code
  decidingAssumption: DecidingAssumption | null;
};

/** An edge whose deletion flips a prediction. This is what makes a disagreement decidable. */
export type DecidingAssumption = {
  predatorId: string;
  predatorName: string;
  altPreyId: string;
  altPreyName: string;
  edgeLabel: string;                 // "snake → rat"
  withAlt: { end: number; direction: SpeciesOutcome["direction"] };
  withoutAlt: { end: number; direction: SpeciesOutcome["direction"] };
  flips: boolean;
};

// ── Learner model ──────────────────────────────────────────────────────────
export type MisconceptionId = "linear-chain" | "predator-removal-is-good";

export type Misconception = {
  id: MisconceptionId;
  label: string;
  confidence: number;    // 0..1 — how strongly we believe the learner holds it
};

export type OpenThread = {
  id: string;
  doubt: string;
  raisedAtTurn: number;
  addressed: boolean;
};

export type Prediction = {
  proposition: string;
  learnerGuess: string;
  outcome: string | null;
};

export type LearnerModel = {
  name: string;
  turn: number;
  scaffoldLevel: 1 | 2 | 3;          // 3 = most support
  misconceptions: Misconception[];
  openThreads: OpenThread[];
  predictions: Prediction[];
  freeTextSubmissions: number;
  helpRequests: number;
  selfInitiatedEdits: number;
  turnsSinceDisagreement: number;
};

export type Settled = { question: string; answer: string; howWeKnow: string };

// ── Agent records written to the blackboard ────────────────────────────────
export type Intake = {
  kind: "answer_attempt" | "doubt" | "web_edit_request" | "help_request" | "other";
  claims: string[];
  proposedEdit: { op: "add_edge" | "delete_edge"; from: string; to: string } | null;
  misconceptionSignals: MisconceptionId[];
};

export type GuideRecord = {
  agent: "mira";
  say: string;
  prediction: string | null;         // blind to the simulator
  targetProposition: string | null;
  nextAction: string;                // ONLY Mira may set this
  scaffoldLevel: 1 | 2 | 3;
};

export type CoLearnerRecord = {
  agent: "aarav";
  say: string;
  prediction: string | null;         // blind to the simulator
  stance: "agree" | "disagree" | "probe";
  targetProposition: string | null;
};

export type ClaimVerdict = {
  claim: string;
  status: "supported" | "contradicted" | "depends_on_assumption";
  speciesRef: string | null;
  direction: "up" | "down" | "flat" | null;
  evidence: string;
};

export type CheckerRecord = {
  agent: "sen";
  say: string;
  perClaim: ClaimVerdict[];
  keyAssumption: string | null;
  whoWasRight: "mira" | "aarav" | "both_partly" | "neither" | "not_applicable";
  settled: Settled | null;
  verified: boolean;                 // false => we fell back to a templated summary
};

export type Disagreement = {
  proposition: string;
  miraClaim: string;
  aaravClaim: string;
  decidable: boolean;
  learnerChoice: "mira" | "aarav" | "both_wrong" | "unsure" | null;
  resolved: boolean;
};

// ── The blackboard ─────────────────────────────────────────────────────────
export type Session = {
  id: string;
  web: FoodWeb;
  removedId: string | null;
  sim: SimResult | null;
  learner: LearnerModel;
  settled: Settled[];
  transcript: TranscriptItem[];
  openDisagreement: Disagreement | null;
  bytesUsed: number;
  offline: boolean;
  screen: Screen;
  ui: UiState;
  /** Who is signed in. Progress is stored per user. */
  username: string | null;
  /** The free-form doubt chat, kept separate from the council transcript. */
  chat: ChatTurn[];
};

export type ChatTurn = {
  who: "learner" | "mira";
  text: string;
  proposedEdit?: { op: "add_edge" | "delete_edge"; from: string; to: string } | null;
};

/** Everything the screens need, kept inside the session so a resume is exact (C1). */
export type UiState = {
  selectedId: string | null;
  guide: GuideRecord | null;
  colearner: CoLearnerRecord | null;
  checker: CheckerRecord | null;
  whoChanges: string[] | null;        // task 1: multi-select
  whoChangesScored: boolean;
  predictionChoice: string | null;    // task 2: committed prediction
  explanation: string | null;         // task 3: free-text
  pendingEdit: { op: "add_edge" | "delete_edge"; from: string; to: string } | null;
  resolutionRun: boolean;             // task 4: did she run the deciding experiment?
  /** The first run's figure for the contested species, kept so the second run can
      be compared against it. Without this the punchline has nothing to point at. */
  resolutionBaseline: { predatorName: string; edgeLabel: string; withArrowEnd: number } | null;
  lastSource: "model" | "fallback" | null;
  provider: string | null;
  /** Error surfaced while the AI was building the chain, if any. */
  buildError: string | null;
  /** Why we last fell back: the helpers being down and the helpers getting
      muddled are different things and the learner is told different things. */
  failure: "unreachable" | "unparseable" | "busy" | null;
};

export type Screen =
  | "login" | "home" | "intro" | "choose" | "building"
  | "explorer" | "predict" | "council" | "simulation" | "settled" | "chat" | "about";

export type TranscriptItem =
  | { kind: "learner"; text: string; turn: number }
  | { kind: "agent"; agent: "mira" | "aarav" | "sen"; text: string; turn: number }
  | { kind: "system"; text: string; turn: number };
