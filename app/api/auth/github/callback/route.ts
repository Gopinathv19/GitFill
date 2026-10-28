import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import { getDb } from "@/lib/db";
import { getSessionUser, safeNext, signIn } from "@/lib/auth/current";
import { storeGitHubToken } from "@/lib/auth/github-token";
import { STATE_COOKIE } from "@/lib/auth/session";
import { GitHubClient } from "@/lib/connectors/github/client";

/**
 * GET /api/auth/github/callback — verifies state, exchanges the code for the user's token,
 * reads the profile and granted scopes, then either signs in or connects the account.
 * The token is stored encrypted and used only for that user's own GitHub requests.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  let saved: { state?: string; next?: string; mode?: string } = {};
  try {
    saved = JSON.parse(jar.get(STATE_COOKIE)?.value ?? "{}") as typeof saved;
  } catch {
    saved = {};
  }
  jar.delete(STATE_COOKIE);
  const mode = saved.mode === "connect" ? "connect" : "login";
  const next = safeNext(saved.next);
  const back = (error: string) => NextResponse.redirect(new URL(mode === "connect" ? `${next}${next.includes("?") ? "&" : "?"}github=${error}` : `/login?error=${error}`, url), 303);

  const code = url.searchParams.get("code");
  if (!code || !saved.state || url.searchParams.get("state") !== saved.state) return back("invalid_state");

  const { GITHUB_OAUTH_CLIENT_ID: clientId, GITHUB_OAUTH_CLIENT_SECRET: clientSecret } = env();
  if (!clientId || !clientSecret) return back("github_not_configured");
  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      signal: AbortSignal.timeout(15_000),
    });
    const { access_token: token, scope } = (await tokenRes.json()) as { access_token?: string; scope?: string };
    if (!token) return back("github_denied");
    const profile = await new GitHubClient(token).whoami();
    if (!profile.id) return back("github_profile_failed");
    const scopes = profile.scopes.length ? profile.scopes : (scope ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const db = getDb();

    if (mode === "connect") {
      const current = await getSessionUser();
      if (!current) return back("not_signed_in");
      await storeGitHubToken(db, current.id, token, scopes, profile.login);
      return NextResponse.redirect(new URL(`${next}${next.includes("?") ? "&" : "?"}github=connected`, url), 303);
    }

    const res = await signIn(db, { githubId: String(profile.id), login: profile.login, name: profile.name, email: profile.email, avatarUrl: profile.avatarUrl }, new URL(next, url).toString());
    const userId = await signedInUserId(res);
    if (userId) await storeGitHubToken(db, userId, token, scopes, profile.login);
    return res;
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? ` (cause: ${err.cause.message})` : "";
    console.error("GitHub sign-in failed:", err instanceof Error ? err.message.split("\nparams:")[0] + cause : err);
    return back("github_failed");
  }
}

/** Reads the user id back from the session cookie the sign-in response just set. */
async function signedInUserId(res: NextResponse): Promise<string | null> {
  const { SESSION_COOKIE, verifySessionToken } = await import("@/lib/auth/session");
  const token = res.cookies.get(SESSION_COOKIE)?.value;
  return (await verifySessionToken(token))?.id ?? null;
}
