import { MuseClient } from "@/lib/ai/client";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { requireRequestUser } from "@/lib/auth/api";
import { getDb } from "@/lib/db";
import { extDriftSchema } from "@/lib/ext/requests";
import { fail, handleError, ok } from "@/lib/http";
import { publicErrorMessage } from "@/lib/jobs/pipeline";
import { detectDocsDrift } from "@/lib/understanding/docs";

export const maxDuration = 300;

/** POST /api/ext/drift — find README statements that a diff makes outdated, with proposed edits. */
export async function POST(req: Request) {
  try {
    const db = getDb();
    await requireRequestUser(db, req);
    const body = extDriftSchema.parse(await req.json());
    const recorder = new MemoryRecorder();
    const result = await detectDocsDrift({ client: new MuseClient(), document: body.document, documentName: body.documentName, changes: body.changes, recorder });
    return ok({ ...result, usage: recorder.usage });
  } catch (err) {
    if (err instanceof Error && ["ModelError", "StructuredOutputError", "ConfigError"].includes(err.name)) return fail(502, "analysis_failed", publicErrorMessage(err));
    return handleError(err);
  }
}
