import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE, readToken } from "@/lib/auth";
import { answerDoubt } from "@/lib/chat";
import type { Session } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const jar = await cookies();
  if (!readToken(jar.get(COOKIE)?.value)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let body: { session?: Session; question?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  if (!body.session?.web?.nodes?.length) {
    return NextResponse.json({ error: "missing session" }, { status: 400 });
  }

  try {
    return NextResponse.json(
      await answerDoubt(body.session, String(body.question ?? "").slice(0, 400)),
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 200 });
  }
}
