import { MuseClient } from "@/lib/ai/client";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { requireRequestUser } from "@/lib/auth/api";
import { snapshotFromFiles } from "@/lib/connectors/local";
import { getDb } from "@/lib/db";
import { extExplainSchema } from "@/lib/ext/requests";
import { fail, handleError, ok } from "@/lib/http";
import { publicErrorMessage } from "@/lib/jobs/pipeline";
import { explainCode } from "@/lib/understanding/explain";

export const maxDuration = 300;

/** POST /api/ext/explain — explain selected code, a file, or answer a question over local files. */
export async function POST(req: Request) {
  try {
    const db = getDb();
    await requireRequestUser(db, req);
    const body = extExplainSchema.parse(await req.json());
    const snapshot = snapshotFromFiles({ name: body.workspace.name, files: body.workspace.files, allPaths: body.workspace.allPaths, branch: body.workspace.branch, version: body.workspace.head });
    const focus = body.focus ? `${body.focus.path}${body.focus.startLine ? `:${body.focus.startLine}${body.focus.endLine && body.focus.endLine !== body.focus.startLine ? `-${body.focus.endLine}` : ""}` : ""}` : undefined;
    const question = body.focus?.selection ? `${body.question}\n\nSelected code (${focus}):\n\`\`\`\n${body.focus.selection.slice(0, 12_000)}\n\`\`\`` : body.question;
    const recorder = new MemoryRecorder();
    const result = await explainCode({ client: new MuseClient(), snapshot, request: { question, diagram: body.diagram, focus }, recorder });
    return ok({
      title: result.spec.title,
      markdown: result.markdown,
      answer: result.spec.answer,
      mermaid: result.mermaid,
      references: result.spec.references,
      unverified: result.spec.unverified,
      followUps: result.spec.followUps,
      claims: result.claims.map((c) => ({ ref: c.ref, claim: c.claim, status: c.status, filePath: c.filePath, startLine: c.startLine, endLine: c.endLine })),
      filesAnalyzed: snapshot.stats.selectedFiles,
      agent: result.agent,
      usage: recorder.usage,
    });
  } catch (err) {
    if (err instanceof Error && ["ModelError", "ToolLoopError", "StructuredOutputError", "ConfigError"].includes(err.name)) return fail(502, "analysis_failed", publicErrorMessage(err));
    return handleError(err);
  }
}
