import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { artifacts, deckVersions } from "@/lib/db/schema";
import { fail, handleError, isUuid } from "@/lib/http";
import { artifactResponse } from "@/lib/artifact-response";
import { requireUser } from "@/lib/auth/current";
import { assertDeckAccess } from "@/lib/workspaces/service";

const FORMATS = { pptx: "pptx", pdf: "pdf", readme: "readme", evidence: "evidence_report" } as const;

/** GET /api/presentations/:id/download?format=pptx|pdf|readme|evidence&version=N */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail(400, "invalid_id", "Invalid presentation id.");
    const url = new URL(req.url);
    const format = (url.searchParams.get("format") ?? "pptx") as keyof typeof FORMATS;
    if (!(format in FORMATS)) return fail(400, "invalid_format", "format must be pptx, pdf, readme or evidence.");
    const versionParam = url.searchParams.get("version");
    const db = getDb();
    await assertDeckAccess(db, (await requireUser()).id, id);
    const versions = await db.select().from(deckVersions).where(eq(deckVersions.deckId, id)).orderBy(desc(deckVersions.version));
    const version = versionParam ? versions.find((v) => v.version === Number(versionParam)) : versions[0];
    if (!version) return fail(404, "not_found", "Presentation version not found.");
    const artifact = (await db.select().from(artifacts).where(and(eq(artifacts.deckVersionId, version.id), eq(artifacts.artifactType, FORMATS[format]))))[0];
    if (!artifact) return fail(404, "not_found", `No ${format} file for this version.`);
    return artifactResponse(artifact, true);
  } catch (err) {
    return handleError(err);
  }
}
