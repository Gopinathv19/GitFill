import JSZip from "jszip";
import { documentFiles } from "@/lib/readme/files";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid } from "@/lib/http";
import { getStorage, safeFilename } from "@/lib/storage";
import { assertDocumentAccess } from "@/lib/workspaces/service";

/** GET /api/documents/:id/download?format=md|json|zip — the Markdown, the structured spec for tooling, or a zip with the files a README ships with. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid document id.");
    const format = new URL(req.url).searchParams.get("format") ?? "md";
    if (format !== "md" && format !== "json" && format !== "zip") return fail(400, "invalid_format", "format must be md, json or zip.");
    const { document } = await assertDocumentAccess(getDb(), user.id, id);
    const base = `${document.kind}-${document.title}`;
    if (format === "zip") {
      // README.md with the images it ships with, laid out as they go into the repository.
      const zip = new JSZip();
      zip.file(document.kind === "readme" ? "README.md" : `${safeFilename(base, "md")}`, document.markdown);
      for (const f of documentFiles(document.metadata)) zip.file(f.path, await getStorage().get(f.key));
      const bytes = await zip.generateAsync({ type: "nodebuffer" });
      return new Response(new Uint8Array(bytes), {
        headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${safeFilename(base, "zip")}"`, "Cache-Control": "private, no-store" },
      });
    }
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
