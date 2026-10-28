import { MuseClient } from "@/lib/ai/client";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { requireRequestUser } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import { extDocumentSchema } from "@/lib/ext/requests";
import { fail, handleError, ok } from "@/lib/http";
import { publicErrorMessage } from "@/lib/jobs/pipeline";
import { applyDocComments, generateDocComments } from "@/lib/understanding/docs";

export const maxDuration = 300;

/** POST /api/ext/document — propose documentation comments for a file or selection (preview, then apply client-side). */
export async function POST(req: Request) {
  try {
    const db = getDb();
    await requireRequestUser(db, req);
    const body = extDocumentSchema.parse(await req.json());
    const recorder = new MemoryRecorder();
    const result = await generateDocComments({ client: new MuseClient(), path: body.path, content: body.content, selection: body.selection, recorder });
    return ok({ ...result, preview: applyDocComments(body.content, result.comments), usage: recorder.usage });
  } catch (err) {
    if (err instanceof Error && ["ModelError", "StructuredOutputError", "ConfigError"].includes(err.name)) return fail(502, "analysis_failed", publicErrorMessage(err));
    return handleError(err);
  }
}
