import { z } from "zod";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid, ok } from "@/lib/http";
import { getStorage, safeFilename } from "@/lib/storage";
import { assertUploadAccess, deleteUpload, updateUploadCaption, uploadView } from "@/lib/uploads/service";

/** GET /api/uploads/:id — the file's bytes. Images are shown inline; everything else downloads. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid upload id.");
    const row = await assertUploadAccess(getDb(), user.id, id);
    const data = await getStorage().get(row.storageKey);
    const image = row.mimeType.startsWith("image/");
    const ext = row.filename.includes(".") ? row.filename.split(".").pop()! : "bin";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": row.mimeType,
        "Content-Length": String(data.byteLength),
        "Content-Disposition": `${image ? "inline" : "attachment"}; filename="${safeFilename(row.filename.replace(/\.[^.]+$/, ""), ext)}"`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

/** PATCH /api/uploads/:id — change the caption (`description`) decks and the chat see. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid upload id.");
    const { description } = z.object({ description: z.string().max(600) }).parse(await req.json());
    return ok({ upload: uploadView(await updateUploadCaption(getDb(), user.id, id, description)) });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid upload id.");
    await deleteUpload(getDb(), user.id, id);
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
