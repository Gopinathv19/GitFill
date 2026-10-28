import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { getDeckView } from "@/lib/jobs/queries";
import { requireUser } from "@/lib/auth/current";
import { assertDeckAccess } from "@/lib/workspaces/service";

/** GET /api/presentations/:id — deck metadata, versions, validation reports, evidence and artifacts. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid presentation id.");
    const user = await requireUser();
    const { workspaceId } = await assertDeckAccess(getDb(), user.id, id);
    const deck = await getDeckView(getDb(), id);
    return deck ? ok({ ...deck, workspaceId }) : fail(404, "not_found", "Presentation not found.");
  } catch (err) {
    return handleError(err);
  }
}
