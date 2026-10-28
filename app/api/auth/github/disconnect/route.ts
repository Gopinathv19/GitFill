import { requireUser } from "@/lib/auth/current";
import { clearGitHubToken } from "@/lib/auth/github-token";
import { getDb } from "@/lib/db";
import { handleError, ok } from "@/lib/http";

/** POST /api/auth/github/disconnect — forgets the user's GitHub token. Public repositories keep working through the server token. */
export async function POST() {
  try {
    const user = await requireUser();
    await clearGitHubToken(getDb(), user.id);
    return ok({ disconnected: true });
  } catch (err) {
    return handleError(err);
  }
}
