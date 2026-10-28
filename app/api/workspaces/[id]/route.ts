import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { getWorkspace } from "@/lib/workspaces/service";

/** GET /api/workspaces/:id — repositories, presentations and recent jobs. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    return ok(await getWorkspace(getDb(), user.id, id));
  } catch (err) {
    return handleError(err);
  }
}
