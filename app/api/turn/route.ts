import { NextResponse } from "next/server";
import type { Session } from "@/lib/types";
import { runPredictPhase, runAdjudicatePhase } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body =
  | { phase: "predict"; session: Session; utterance: string }
  | { phase: "adjudicate"; session: Session };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (!body?.session?.web?.nodes?.length) {
    return NextResponse.json({ error: "missing session" }, { status: 400 });
  }

  try {
    if (body.phase === "predict") {
      const result = await runPredictPhase(body.session, String(body.utterance ?? "").slice(0, 500));
      return NextResponse.json(result);
    }
    if (body.phase === "adjudicate") {
      const result = await runAdjudicatePhase(body.session);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "unknown phase" }, { status: 400 });
  } catch (err) {
    // Never 500 at the learner: the client falls back to recorded content.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown", source: "error" },
      { status: 200 },
    );
  }
}
