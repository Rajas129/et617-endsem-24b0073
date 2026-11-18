import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE, readToken } from "@/lib/auth";
import { generateWeb } from "@/lib/webgen";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const jar = await cookies();
  if (!readToken(jar.get(COOKIE)?.value)) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  let body: { subject?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const subject = String(body.subject ?? "").trim().slice(0, 40);
  if (!subject) return NextResponse.json({ error: "no subject" }, { status: 400 });

  try {
    return NextResponse.json(await generateWeb(subject));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 200 });
  }
}
