import { createHmac, timingSafeEqual } from "crypto";

/**
 * A classroom sign-in, not production authentication.
 *
 * Accounts live in the APP_USERS environment variable and passwords are stored
 * there in plain text. That is acceptable here because the only thing behind the
 * gate is a learner's own practice session, and it is stated plainly in the README
 * rather than dressed up. What it does do properly: the password never reaches the
 * browser, the session cookie is HMAC-signed so it cannot be forged by editing it,
 * and the comparison is timing-safe.
 */

export const COOKIE = "fwc_session";
const MAX_AGE = 60 * 60 * 24 * 30;

type Account = { username: string; password: string };

function accounts(): Account[] {
  // Format: "priya:frogs123,teacher:council99"
  return (process.env.APP_USERS ?? "")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(":");
      return i === -1
        ? { username: pair, password: "" }
        : { username: pair.slice(0, i).trim(), password: pair.slice(i + 1).trim() };
    })
    .filter((a) => a.username && a.password);
}

export function hasAccounts(): boolean {
  return accounts().length > 0;
}

const DEV_SECRET = "et617-dev-secret-change-me";

/**
 * The development fallback below is published in a public repository, so anyone
 * could use it to forge a session cookie. In production we therefore refuse to
 * fall back to it: a missing AUTH_SECRET fails the sign-in with a clear message
 * instead of silently accepting forged sessions.
 */
export function secretMisconfigured(): boolean {
  return process.env.NODE_ENV === "production" && !process.env.AUTH_SECRET;
}

function secret(): string {
  if (secretMisconfigured()) throw new Error("AUTH_SECRET is not set");
  return process.env.AUTH_SECRET || DEV_SECRET;
}

function sign(username: string): string {
  return createHmac("sha256", secret()).update(username).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verifyCredentials(username: string, password: string): boolean {
  const account = accounts().find((a) => a.username === username);
  if (!account) return false;
  return safeEqual(account.password, password);
}

export function makeToken(username: string): string {
  return `${encodeURIComponent(username)}.${sign(username)}`;
}

export function readToken(token: string | undefined): string | null {
  if (!token || secretMisconfigured()) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const username = decodeURIComponent(token.slice(0, dot));
  const mac = token.slice(dot + 1);
  if (!username || !mac) return null;
  return safeEqual(sign(username), mac) ? username : null;
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE,
  secure: process.env.NODE_ENV === "production",
};
