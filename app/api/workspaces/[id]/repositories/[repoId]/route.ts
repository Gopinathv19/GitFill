import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { removeRepository } from "@/lib/workspaces/service";

/** DELETE /api/workspaces/:id/repositories/:repoId — detach a repository (generated decks are kept). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; repoId: string }> }) {
  try {
    const user = await requireUser();
    const { id, repoId } = await params;
    if (!isUuid(id) || !isUuid(repoId)) return fail(400, "invalid_id", "Invalid id.");
    await removeRepository(getDb(), user.id, id, repoId);
    return ok({ removed: true });
  } catch (err) {
    return handleError(err);
  }
}
