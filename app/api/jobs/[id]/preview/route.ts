import { readFile } from "node:fs/promises";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid } from "@/lib/http";
import { getStorage } from "@/lib/storage";
import { assertJobAccess } from "@/lib/workspaces/service";

/**
 * GET /api/jobs/:id/preview?round=N&slide=K — one page image from a render round of a running (or
 * finished) deck job, so the presentation page can show slides changing while a revision works.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid job id.");
    const query = new URL(req.url).searchParams;
    const round = Number(query.get("round"));
    const slide = Number(query.get("slide"));
    if (!Number.isInteger(round) || round < 0 || round > 10 || !Number.isInteger(slide) || slide < 1 || slide > 99) return fail(400, "invalid_preview", "Invalid round or slide.");
    await assertJobAccess(getDb(), user.id, id);
    const file = getStorage().localPath(`work/${id}/round-${round}/slide-${String(slide).padStart(2, "0")}.png`);
    const png = await readFile(file).catch(() => null);
    if (!png) return fail(404, "not_found", "Preview not rendered yet.");
    // A round's images never change once written.
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
  } catch (err) {
    return handleError(err);
  }
}
