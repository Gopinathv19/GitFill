/**
 * Signed session cookies (HMAC-SHA256 via Web Crypto, so the same code verifies
 * sessions in middleware and in route handlers). The cookie carries only identity
 * fields for rendering; authorization always checks the database.
 */

export const SESSION_COOKIE = "gf_session";
export const STATE_COOKIE = "gf_oauth_state";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

interface Payload extends SessionUser {
  exp: number;
}

const DEV_SECRET = "gitfill-development-only-secret-do-not-use-in-prod";

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set (32+ characters) in production.");
  return DEV_SECRET;
}

const enc = new TextEncoder();

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const payload: Payload = { ...user, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (!safeEqual(sig, await hmac(body))) return null;
  try {
    const p = JSON.parse(fromB64url(body)) as Payload;
    if (typeof p.exp !== "number" || p.exp < Date.now() / 1000) return null;
    return { id: p.id, login: p.login, name: p.name, avatarUrl: p.avatarUrl };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};

export function randomState(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
}
