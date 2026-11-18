import type { Session, ChatTurn, Intake } from "./types";
import { callJSON, clampText, oneOf } from "./llm";
import { speciesName, CANONICAL_IDS, pluralLower } from "./web";

/**
 * The doubt chat.
 *
 * Kept separate from the council pipeline on purpose. The council is structured —
 * predict, disagree, adjudicate — and a learner who is simply confused should not
 * have to enter that machinery to ask "what does a decomposer even do?".
 *
 * Mira answers here, and she never sees the simulation result, so she cannot spoil
 * an experiment the learner has not run yet. If the question is really a proposal
 * to change the web ("but hawks eat rats too"), it comes back as a proposed edit
 * the learner confirms, so a doubt becomes an experiment rather than a correction.
 */

export type ChatReply = {
  turn: ChatTurn;
  bytes: number;
  source: "model" | "fallback";
  provider?: string;
};

function buildPrompt(session: Session, question: string): string {
  const web = session.web;
  const alive = web.nodes.filter((n) => n.alive).map((n) => n.name).join(", ");
  const arrows = web.edges
    .map((e) => `${speciesName(web, e.from)} is eaten by ${speciesName(web, e.to)}`)
    .join("; ");

  const history = session.chat.slice(-6)
    .map((t) => `${t.who === "learner" ? "Learner" : "Mira"}: ${t.text}`)
    .join("\n");

  return `You are Mira, a warm science guide in a Class 7 food-web app.
Reply with JSON only.

THE WEB RIGHT NOW
Species: ${alive}.
Arrows: ${arrows}.
${web.nodes.filter((n) => !n.alive).length
  ? `Removed by the learner: ${web.nodes.filter((n) => !n.alive).map((n) => n.name).join(", ")}.`
  : ""}

THE LEARNER
She is repeating this topic after failing it once. She is anxious about it and
believes she is bad at science. She will stop if anything feels like a test.
Never score her. Never say she is wrong. Short, simple sentences. Say "we" and "let's".

${history ? `EARLIER IN THIS CHAT\n${history}\n` : ""}
HER QUESTION
"${question}"

RULES
- Answer the question she actually asked, in at most 55 words.
- You have NOT run the simulation and you do not know the result. Never state what
  will happen as a fact. If she is asking what will happen, say what you expect and
  why, from the arrows, and invite her to run it.
- Never give exact population numbers.
- If she is suggesting a change to the web — that an animal eats something it is not
  joined to, or that an arrow is wrong — set proposedEdit so we can try it.
  Valid species ids: ${CANONICAL_IDS.concat(web.nodes.map((n) => n.id)).join(", ")}.

JSON shape:
{"say":"...","proposedEdit":null}
or
{"say":"...","proposedEdit":{"op":"add_edge","from":"rat","to":"hawk"}}`;
}

export async function answerDoubt(session: Session, question: string): Promise<ChatReply> {
  if (!question.trim()) {
    return {
      turn: { who: "mira", text: "Ask me anything you like about the web." },
      bytes: 0, source: "fallback",
    };
  }

  const res = await callJSON<{ say?: string; proposedEdit?: unknown }>(
    "chat", buildPrompt(session, question), 550,
  );
  const { bytes, provider } = res;
  const parsed = res.value;

  if (!parsed?.say) {
    return { turn: { who: "mira", text: offlineAnswer(session, question) }, bytes, source: "fallback", provider };
  }

  return {
    turn: {
      who: "mira",
      text: clampText(parsed.say, 420, "Let's look at the arrows together."),
      proposedEdit: validateEdit(parsed.proposedEdit, session),
    },
    bytes, source: "model", provider,
  };
}

/**
 * Offline answers are built from the web itself, so they are still true and still
 * about her actual question rather than a generic apology.
 */
function offlineAnswer(session: Session, question: string): string {
  const q = question.toLowerCase();
  const web = session.web;

  const named = web.nodes.find((n) => q.includes(n.name.toLowerCase()) || q.includes(n.id));
  if (named) {
    const eats = web.edges.filter((e) => e.to === named.id).map((e) => speciesName(web, e.from));
    const eatenBy = web.edges.filter((e) => e.from === named.id).map((e) => speciesName(web, e.to));
    return [
      `I'm offline just now, but the web still tells us a lot about ${pluralLower(named.name)}.`,
      eats.length ? `They eat ${eats.join(" and ")}.` : `They make their own food.`,
      eatenBy.length ? `They are eaten by ${eatenBy.join(" and ")}.` : `Nothing here eats them.`,
      `Try taking something out and running it — that will answer it properly.`,
    ].join(" ");
  }

  if (q.includes("decompos")) {
    return "I'm offline just now. Decomposers break down everything that dies and put it back into the soil, so the plants can grow again. That's why they sit at the bottom with no single arrow.";
  }
  return "I'm offline just now, so I can't think this through with you properly. The experiments still work though — take a species out and run it, and we can talk about what you see.";
}

function validateEdit(e: unknown, session: Session): Intake["proposedEdit"] {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const ids = new Set(session.web.nodes.map((n) => n.id));
  const from = String(o.from ?? "");
  const to = String(o.to ?? "");
  if (!ids.has(from) || !ids.has(to) || from === to) return null;
  return { op: oneOf(o.op, ["add_edge", "delete_edge"] as const, "add_edge"), from, to };
}
