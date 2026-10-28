import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid } from "@/lib/http";
import { safeFilename } from "@/lib/storage";
import { assertDocumentAccess } from "@/lib/workspaces/service";

/** GET /api/documents/:id/download?format=md|json — the Markdown, or the structured spec for tooling. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid document id.");
    const format = new URL(req.url).searchParams.get("format") ?? "md";
    if (format !== "md" && format !== "json") return fail(400, "invalid_format", "format must be md or json.");
    const { document } = await assertDocumentAccess(getDb(), user.id, id);
    const base = `${document.kind}-${document.title}`;
    const body = format === "md" ? document.markdown : JSON.stringify({ kind: document.kind, title: document.title, metadata: document.metadata, spec: document.spec }, null, 2);
    return new Response(body, {
      headers: {
        "Content-Type": format === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFilename(base, format)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
