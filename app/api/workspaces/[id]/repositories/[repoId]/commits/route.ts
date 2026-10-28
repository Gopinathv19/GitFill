import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { publicErrorMessage } from "@/lib/jobs/pipeline";
import { ActionError, listRepositoryCommits } from "@/lib/workspaces/actions";

/** GET /api/workspaces/:id/repositories/:repoId/commits?branch= — recent commits for the comparison picker. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; repoId: string }> }) {
  try {
    const user = await requireUser();
    const { id, repoId } = await params;
    if (!isUuid(id) || !isUuid(repoId)) return fail(400, "invalid_id", "Invalid id.");
    const branch = new URL(req.url).searchParams.get("branch")?.trim() || undefined;
    return ok(await listRepositoryCommits(getDb(), user.id, id, repoId, branch));
  } catch (err) {
    if (err instanceof ActionError) return fail(409, "not_analyzable", err.message);
    if (err instanceof Error && err.name === "GitHubError") return fail(502, "github_error", publicErrorMessage(err));
    return handleError(err);
  }
}
