import { readFile } from "node:fs/promises";
import { requireUser } from "@/lib/auth/current";
import { getDb } from "@/lib/db";
import { fail, handleError, isUuid } from "@/lib/http";
import { getStorage } from "@/lib/storage";
import { assertJobAccess } from "@/lib/workspaces/service";

/** A still the video director rendered, relative to the job's work directory. */
const STILL = /^stills\/(v\d{1,4}\/t\d{4}\.\d|thumbnail-v\d{1,4})\.png$/;

/**
 * GET /api/jobs/:id/preview?round=N&slide=K — one page image from a render round of a deck job;
 * GET /api/jobs/:id/preview?still=stills/v3/t0012.5.png — one frame a video job previewed.
 * They let the presentation page show slides and video frames changing while a job works.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid job id.");
    const query = new URL(req.url).searchParams;
    let file: string;
    const still = query.get("still");
    if (still !== null) {
      if (!STILL.test(still)) return fail(400, "invalid_preview", "Invalid still.");
      file = `work/${id}/${still}`;
    } else {
      const round = Number(query.get("round"));
      const slide = Number(query.get("slide"));
      if (!Number.isInteger(round) || round < 0 || round > 10 || !Number.isInteger(slide) || slide < 1 || slide > 99) return fail(400, "invalid_preview", "Invalid round or slide.");
      file = `work/${id}/round-${round}/slide-${String(slide).padStart(2, "0")}.png`;
    }
    await assertJobAccess(getDb(), user.id, id);
    const png = await readFile(getStorage().localPath(file)).catch(() => null);
    if (!png) return fail(404, "not_found", "Preview not rendered yet.");
    // A rendered image never changes once written.
    return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
  } catch (err) {
    return handleError(err);
  }
}
