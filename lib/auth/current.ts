import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions, verifySessionToken, type SessionUser } from "./session";

export class UnauthorizedError extends Error {
  override name = "UnauthorizedError";
}

export async function getSessionUser(): Promise<SessionUser | null> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError("Sign in required.");
  return user;
}

/** Creates or refreshes the user row and returns a response carrying the session cookie. */
export async function signIn(db: Database, profile: { githubId: string; login: string; name: string | null; email: string | null; avatarUrl: string | null }, redirectTo: string) {
  const [row] = await db
    .insert(users)
    .values(profile)
    .onConflictDoUpdate({ target: users.githubId, set: { login: profile.login, name: profile.name, email: profile.email, avatarUrl: profile.avatarUrl, lastLoginAt: new Date() } })
    .returning();
  const token = await createSessionToken({ id: row!.id, login: row!.login, name: row!.name, avatarUrl: row!.avatarUrl });
  const res = NextResponse.redirect(redirectTo, 303);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}

export async function findUser(db: Database, id: string) {
  return (await db.select().from(users).where(eq(users.id, id)))[0];
}

/** Only same-site paths, so a crafted ?next= cannot redirect off-site. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/workspaces";
}
