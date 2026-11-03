import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { listRepositoryBranches } from "@/lib/workspaces/service";

/** GET /api/workspaces/:id/repositories/:repoId/branches — the repository's branches, the current one first. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; repoId: string }> }) {
  try {
    const user = await requireUser();
    const { id, repoId } = await params;
    if (!isUuid(id) || !isUuid(repoId)) return fail(400, "invalid_id", "Invalid id.");
    return ok(await listRepositoryBranches(getDb(), user.id, id, repoId));
  } catch (err) {
    return handleError(err);
  }
}
