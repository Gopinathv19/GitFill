import { authMode, env } from "@/lib/config/env";
import { getSessionUser } from "@/lib/auth/current";
import { getGitHubConnection } from "@/lib/auth/github-token";
import { getDb } from "@/lib/db";
import { fail, handleError, ok } from "@/lib/http";

/** GET /api/auth/me — the signed-in user, sign-in methods, and the state of their GitHub connection. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return fail(401, "unauthorized", "Not signed in.");
    const github = await getGitHubConnection(getDb(), user.id);
    return ok({ user, authMode: authMode(), githubConfigured: Boolean(env().GITHUB_OAUTH_CLIENT_ID), github });
  } catch (err) {
    return handleError(err);
  }
}
