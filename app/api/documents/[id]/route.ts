import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { getDocumentView } from "@/lib/jobs/queries";
import { assertDocumentAccess } from "@/lib/workspaces/service";

/** GET /api/documents/:id — Markdown, structured spec, snapshots and evidence claims. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid document id.");
    const db = getDb();
    await assertDocumentAccess(db, user.id, id);
    const doc = await getDocumentView(db, id);
    return doc ? ok(doc) : fail(404, "not_found", "Document not found.");
  } catch (err) {
    return handleError(err);
  }
}

/** DELETE /api/documents/:id */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid document id.");
    const db = getDb();
    await assertDocumentAccess(db, user.id, id);
    await db.delete(documents).where(eq(documents.id, id));
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
