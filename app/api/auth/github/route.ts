import { NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import { getSessionUser, safeNext } from "@/lib/auth/current";
import { randomState, STATE_COOKIE } from "@/lib/auth/session";
import { publicOrigin } from "@/lib/http";

/**
 * GET /api/auth/github?next=&mode=login|connect — starts the GitHub OAuth flow.
 * `login` signs the user in (and stores their token); `connect` attaches a GitHub account
 * to the already signed-in user (e.g. the demo user) without changing who they are.
 */
export async function GET(req: Request) {
  const e = env();
  const url = new URL(req.url);
  if (!e.GITHUB_OAUTH_CLIENT_ID) return NextResponse.redirect(new URL("/login?error=github_not_configured", publicOrigin(req)), 303);
  const mode = url.searchParams.get("mode") === "connect" && (await getSessionUser()) ? "connect" : "login";
  const state = randomState();
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", e.GITHUB_OAUTH_CLIENT_ID);
  // Back to the origin the user is on: APP_BASE_URL in production, the request's own host and port in
  // development, so a dev server on another port never sends GitHub's reply to a different one.
  authorize.searchParams.set("redirect_uri", new URL("/api/auth/github/callback", publicOrigin(req)).toString());
  authorize.searchParams.set("scope", e.GITHUB_OAUTH_SCOPES);
  authorize.searchParams.set("state", state);
  const res = NextResponse.redirect(authorize, 303);
  res.cookies.set(STATE_COOKIE, JSON.stringify({ state, next: safeNext(url.searchParams.get("next")), mode }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
