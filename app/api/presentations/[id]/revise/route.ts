import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { reviseRequestSchema } from "@/lib/validation/request";
import { ActionError, revisePresentation } from "@/lib/workspaces/actions";
import { addMessage, assertDeckAccess } from "@/lib/workspaces/service";

/**
 * POST /api/presentations/:id/revise — queues a natural-language revision as a new version.
 * With `theme` (and optionally `brand`, or null to clear it) the template is switched directly.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid presentation id.");
    const { instruction, theme, brand } = reviseRequestSchema.parse(await req.json());
    const db = getDb();
    const { workspaceId, deck } = await assertDeckAccess(db, user.id, id);
    const { job } = await revisePresentation(db, user.id, id, instruction, { theme, brand });
    await addMessage(db, workspaceId, "user", `Revise "${deck.title}": ${instruction}`);
    await addMessage(db, workspaceId, "assistant", "Revision queued. Unaffected slides are kept as they are.", [job.id]);
    return ok({ jobId: job.id, status: job.status }, 202);
  } catch (err) {
    if (err instanceof ActionError) return fail(409, "revision_in_progress", err.message);
    return handleError(err);
  }
}
