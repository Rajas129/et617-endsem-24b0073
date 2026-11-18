import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE, verifyCredentials, makeToken, readToken, cookieOptions, hasAccounts } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const jar = await cookies();
  const username = readToken(jar.get(COOKIE)?.value);
  return NextResponse.json({ username, configured: hasAccounts() });
}

export async function POST(req: Request) {
  let body: { action?: string; username?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const jar = await cookies();

  if (body.action === "logout") {
    jar.set(COOKIE, "", { ...cookieOptions, maxAge: 0 });
    return NextResponse.json({ ok: true, username: null });
  }

  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  if (!hasAccounts()) {
    return NextResponse.json(
      { error: "No accounts are set up yet. Add APP_USERS to .env.local." },
      { status: 503 },
    );
  }
  if (!username || !password) {
    return NextResponse.json({ error: "Type a username and a password." }, { status: 400 });
  }
  if (!verifyCredentials(username, password)) {
    // Deliberately does not say which of the two was wrong.
    return NextResponse.json({ error: "That username and password don't match." }, { status: 401 });
  }

  jar.set(COOKIE, makeToken(username), cookieOptions);
  return NextResponse.json({ ok: true, username });
}
