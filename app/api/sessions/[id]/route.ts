import { z } from "zod";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { assertSession, deleteSession, listMessages, renameSession } from "@/lib/workspaces/service";

/** GET /api/sessions/:id — the session and its messages. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid session id.");
    const db = getDb();
    const session = await assertSession(db, user.id, id);
    return ok({ session, messages: await listMessages(db, id) });
  } catch (err) {
    return handleError(err);
  }
}

/** PATCH /api/sessions/:id — rename. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid session id.");
    const { title } = z.object({ title: z.string().trim().min(1).max(200) }).parse(await req.json());
    return ok(await renameSession(getDb(), user.id, id, title));
  } catch (err) {
    return handleError(err);
  }
}

/** DELETE /api/sessions/:id — delete the session and its messages (jobs and documents are kept). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid session id.");
    await deleteSession(getDb(), user.id, id);
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
