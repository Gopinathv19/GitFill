import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { DOCSTRING_PROMPT, DOCS_DRIFT_PROMPT, numberLines } from "@/lib/ai/prompts";
import { extractSymbols, languageOf } from "@/lib/analysis/symbols";
import type { RunRecorder } from "@/lib/agent/recorder";
import { docCommentsSchema, docsDriftSchema, type DocComments, type DocsDrift } from "./schemas";

/**
 * Documentation assistance for a single file (the extension's "Generate docs" action) and
 * for keeping documents in step with code changes. Both produce structured proposals the
 * client previews and applies; nothing is written without the user seeing it.
 */
export async function generateDocComments(opts: {
  client: MuseClient;
  path: string;
  content: string;
  /** Limit to declarations overlapping these lines (the editor selection). */
  selection?: { startLine: number; endLine: number };
  recorder: RunRecorder;
}): Promise<DocComments & { language: string }> {
  const language = languageOf(opts.path);
  const lines = opts.content.split("\n");
  const symbols = extractSymbols(opts.path, opts.content).filter((s) => !opts.selection || (s.line <= opts.selection.endLine && s.endLine >= opts.selection.startLine));
  const targets = symbols.slice(0, 30);
  const event = await opts.recorder.start("step", "generate_doc_comments", { path: opts.path, declarations: targets.length }, modelFor("writer"));
  try {
    const { data, usage } = await opts.client.structured({
      model: modelFor("writer"),
      purpose: "generate_doc_comments",
      schema: docCommentsSchema,
      schemaName: "DocComments",
      maxTokens: 8_000,
      messages: [
        { role: "system", content: DOCSTRING_PROMPT },
        {
          role: "user",
          content: [
            `File: ${opts.path} (language: ${language}, ${lines.length} lines)`,
            targets.length ? `Declarations to document (name, kind, lines):\n${targets.map((s) => `- ${s.kind} ${s.parent ? `${s.parent}.` : ""}${s.name} [${s.line}-${s.endLine}]`).join("\n")}` : "No declarations were detected; document the selected logic with inline comments where it is non-obvious.",
            opts.selection ? `Selection: lines ${opts.selection.startLine}-${opts.selection.endLine}. Only document declarations in or overlapping the selection.` : "",
            `\n<repository_file path="${opts.path}">\n${numberLines(lines)}\n</repository_file>`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    const comments = data.comments
      .filter((c) => c.insertBeforeLine >= 1 && c.insertBeforeLine <= lines.length + 1)
      .filter((c) => !opts.selection || (c.insertBeforeLine >= opts.selection.startLine && c.insertBeforeLine <= opts.selection.endLine + 1))
      .map((c) => ({ ...c, text: reindent(c.text, lines[c.insertBeforeLine - 1] ?? "") }));
    await event.succeed({ comments: comments.length, skipped: data.skipped.length });
    return { comments, skipped: data.skipped, language };
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "doc comment generation failed");
    throw err;
  }
}

/** Matches the comment's indentation to the declaration it precedes. */
function reindent(text: string, declarationLine: string): string {
  const indent = declarationLine.match(/^\s*/)?.[0] ?? "";
  const lines = text.replace(/\s+$/, "").split("\n");
  const common = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length));
  return lines.map((l) => (l.trim() ? indent + l.slice(Number.isFinite(common) ? common : 0) : l)).join("\n");
}

/** Applies proposed comments to file content (used by tests and by clients that want the full text). */
export function applyDocComments(content: string, comments: DocComments["comments"]): string {
  const lines = content.split("\n");
  const sorted = [...comments].sort((a, b) => b.insertBeforeLine - a.insertBeforeLine);
  for (const c of sorted) lines.splice(c.insertBeforeLine - 1, 0, ...c.text.split("\n"));
  return lines.join("\n");
}

export async function detectDocsDrift(opts: { client: MuseClient; document: string; documentName: string; changes: string; recorder: RunRecorder }): Promise<DocsDrift> {
  const event = await opts.recorder.start("step", "detect_docs_drift", { document: opts.documentName }, modelFor("writer"));
  try {
    const { data, usage } = await opts.client.structured({
      model: modelFor("writer"),
      purpose: "detect_docs_drift",
      schema: docsDriftSchema,
      schemaName: "DocsDrift",
      maxTokens: 6_000,
      messages: [
        { role: "system", content: DOCS_DRIFT_PROMPT },
        { role: "user", content: `Document (${opts.documentName}):\n<document>\n${opts.document.slice(0, 60_000)}\n</document>\n\nCode changes:\n<changes>\n${opts.changes.slice(0, 80_000)}\n</changes>` },
      ],
    });
    await opts.recorder.addUsage(usage.inputTokens, usage.outputTokens);
    // Only keep findings whose quoted text really exists in the document.
    const findings = data.findings.filter((f) => opts.document.includes(f.original));
    await event.succeed({ findings: findings.length, dropped: data.findings.length - findings.length, missing: data.missing.length });
    return { findings, missing: data.missing };
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "docs drift detection failed");
    throw err;
  }
}
