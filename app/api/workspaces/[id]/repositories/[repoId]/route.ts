import { z } from "zod";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { removeRepository, setRepositoryBranch } from "@/lib/workspaces/service";

const patchSchema = z.object({ branch: z.string().trim().min(1).max(200) });

/** PATCH /api/workspaces/:id/repositories/:repoId — `{ branch }`: switch the branch GitFill works on. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; repoId: string }> }) {
  try {
    const user = await requireUser();
    const { id, repoId } = await params;
    if (!isUuid(id) || !isUuid(repoId)) return fail(400, "invalid_id", "Invalid id.");
    const body = patchSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) return fail(400, "invalid_request", "Send { branch } with a branch name.");
    return ok(await setRepositoryBranch(getDb(), user.id, id, repoId, body.data.branch));
  } catch (err) {
    return handleError(err);
  }
}

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
