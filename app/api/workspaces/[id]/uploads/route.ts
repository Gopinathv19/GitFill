import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { createUpload, listUploads, uploadPurpose, uploadView, UploadError } from "@/lib/uploads/service";

export const maxDuration = 60;

/** GET /api/workspaces/:id/uploads — images, documents and templates added to the workspace. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const rows = await listUploads(getDb(), user.id, id);
    return ok({ uploads: rows.map(uploadView) });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/workspaces/:id/uploads — multipart form with `file`, optional `purpose`
 * (material | template | logo) and `caption`. Images are described by the vision model,
 * documents have their text extracted, a .pptx template has its theme read into a brand.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid workspace id.");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) return fail(400, "invalid_request", "Send the file as multipart form data in the `file` field.");
    const purpose = uploadPurpose.parse(form.get("purpose") || undefined);
    const caption = typeof form.get("caption") === "string" ? String(form.get("caption")) : undefined;
    const row = await createUpload(getDb(), user.id, id, { filename: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, { purpose, caption });
    return ok({ upload: uploadView(row) }, 201);
  } catch (err) {
    if (err instanceof UploadError) return fail(400, "invalid_upload", err.message);
    return handleError(err);
  }
}
