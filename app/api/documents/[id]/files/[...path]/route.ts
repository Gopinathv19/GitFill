import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid } from "@/lib/http";
import { documentFiles } from "@/lib/readme/files";
import { getStorage } from "@/lib/storage";
import { assertDocumentAccess } from "@/lib/workspaces/service";

/** GET /api/documents/:id/files/docs/readme/banner.svg — a file a README ships with, for the preview. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  try {
    const user = await requireUser();
    const { id, path } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid document id.");
    const { document } = await assertDocumentAccess(getDb(), user.id, id);
    const wanted = path.map(decodeURIComponent).join("/");
    const file = documentFiles(document.metadata).find((f) => f.path === wanted);
    if (!file) return fail(404, "not_found", "No such file for this document.");
    const bytes = await getStorage().get(file.key);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.mime,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        // SVGs are GitFill's own drawings; still, nothing in them may run or load.
        "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
