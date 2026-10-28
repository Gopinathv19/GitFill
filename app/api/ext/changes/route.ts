import { MuseClient } from "@/lib/ai/client";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { requireRequestUser } from "@/lib/auth/api";
import { snapshotFromFiles } from "@/lib/connectors/local";
import { getDb } from "@/lib/db";
import { extChangesSchema } from "@/lib/ext/requests";
import { fail, handleError, ok } from "@/lib/http";
import { publicErrorMessage } from "@/lib/jobs/pipeline";
import { explainCode } from "@/lib/understanding/explain";

export const maxDuration = 300;

const MAX_DIFF_CHARS = 120_000;

/**
 * POST /api/ext/changes — explain local changes (working tree, staged, or a commit range)
 * using the diff plus the current contents of the touched files.
 */
export async function POST(req: Request) {
  try {
    const db = getDb();
    await requireRequestUser(db, req);
    const body = extChangesSchema.parse(await req.json());
    const snapshot = snapshotFromFiles({ name: body.workspace.name, files: body.workspace.files, allPaths: body.workspace.allPaths, branch: body.workspace.branch, version: body.workspace.head });
    const diff = body.diff.length > MAX_DIFF_CHARS ? `${body.diff.slice(0, MAX_DIFF_CHARS)}\n…[diff truncated]` : body.diff;
    const question = [
      body.question?.trim() || "Explain these changes: what changed, why it matters structurally, what could break, and which tests are affected. Separate what the diff shows from what you infer.",
      `Scope of the diff: ${body.scope}.`,
      "The files below are the CURRENT (after) versions. Lines prefixed with - in the diff no longer exist.",
      `\n<diff scope="${body.scope.replace(/"/g, "")}">\n${diff}\n</diff>`,
    ].join("\n");
    const recorder = new MemoryRecorder();
    const result = await explainCode({ client: new MuseClient(), snapshot, request: { question, diagram: "auto" }, recorder });
    return ok({ title: result.spec.title, markdown: result.markdown, mermaid: result.mermaid, references: result.spec.references, unverified: result.spec.unverified, filesAnalyzed: snapshot.stats.selectedFiles, agent: result.agent, usage: recorder.usage });
  } catch (err) {
    if (err instanceof Error && ["ModelError", "ToolLoopError", "StructuredOutputError", "ConfigError"].includes(err.name)) return fail(502, "analysis_failed", publicErrorMessage(err));
    return handleError(err);
  }
}
