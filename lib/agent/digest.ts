import { createHash } from "node:crypto";
import { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { effortFor, modelFor } from "@/lib/ai/models";
import { numberLines, UNTRUSTED_CONTENT_RULE } from "@/lib/ai/prompts";
import type { CodeGraph } from "@/lib/analysis/graph";
import type { SourceFile } from "@/lib/connectors/types";
import { getStorage } from "@/lib/storage";
import type { RunRecorder } from "./recorder";

/**
 * File digests: the light reading tier. A large file is read once by a fast model at minimal
 * reasoning and compressed into its purpose plus a few key points with exact line ranges; the
 * expensive tool loops then work from digests and read exact lines with read_file before they
 * record a claim (claims are always verified against the full file, never the digest).
 *
 * Before this, every turn of the analysis and exploration loops re-sent ~130k tokens of raw
 * files; that was 92% of all input tokens GitFill spent. Digests are cached by content hash,
 * so an unchanged file is never read twice, across jobs and across commits.
 */

export interface FileDigest {
  path: string;
  lines: number;
  purpose: string;
  points: Array<{ text: string; startLine: number; endLine: number }>;
  /** "model" when the reader wrote it; "outline" when only static analysis was available. */
  source: "model" | "outline";
}

const digestSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string(),
        purpose: z.string().trim().max(400).describe("What the file is for, in 1-2 sentences."),
        keyPoints: z
          .array(z.object({ text: z.string().trim().min(3).max(240), startLine: z.number().int(), endLine: z.number().int() }))
          .max(10)
          .describe("What a reader must know: main functions and what they do, decisions, constants, routes, config keys; each with its exact line range."),
      }),
    )
    .max(20),
});

const READER_PROMPT = `You compress source files for an engineer who will analyse the repository and cite your line ranges as evidence. For each file: its purpose in 1-2 sentences, and up to 10 key points (main functions and what they do, important decisions, constants, routes, config keys, external services, data models), each with the narrowest exact line range that shows it. Lines are shown as "  12| code". Wrap identifiers in backticks exactly as written in those lines. Never invent anything that is not in the lines.

${UNTRUSTED_CONTENT_RULE}`;

/** Files at or under this many lines are cheaper to show in full than to digest. */
export const DIGEST_MIN_LINES = 120;
const BATCH_CHARS = 60_000;
const CONCURRENCY = 6;
const CACHE_PREFIX = "digests/v1";

const hashOf = (content: string) => createHash("sha256").update(content).digest("hex");

/** Which files a digest pass should cover: large source files the loop would otherwise inline in full. */
export function needsDigest(f: SourceFile): boolean {
  return f.lineCount > DIGEST_MIN_LINES && f.category !== "manifest" && f.category !== "docs";
}

/**
 * Digests for `files`, from the cache or the reader model. Never throws: a file the model could not
 * digest gets an outline from static analysis instead, so the loop can still find its way around.
 */
export async function digestFiles(opts: { client: MuseClient; files: SourceFile[]; graph: CodeGraph; recorder: RunRecorder }): Promise<Map<string, FileDigest>> {
  const out = new Map<string, FileDigest>();
  const storage = getStorage();
  const todo: SourceFile[] = [];
  for (const f of opts.files) {
    const cached = await storage
      .get(`${CACHE_PREFIX}/${hashOf(f.content)}.json`)
      .then((b) => JSON.parse(b.toString("utf8")) as FileDigest)
      .catch(() => null);
    if (cached) out.set(f.path, { ...cached, path: f.path });
    else todo.push(f);
  }
  if (!todo.length) return out;

  const batches: SourceFile[][] = [];
  let current: SourceFile[] = [];
  let size = 0;
  for (const f of todo) {
    const cost = Math.min(f.content.length, BATCH_CHARS) + f.lineCount * 6;
    if (current.length && size + cost > BATCH_CHARS) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(f);
    size += cost;
  }
  if (current.length) batches.push(current);

  const event = await opts.recorder.start("step", "digest_files", { files: todo.length, cached: out.size, batches: batches.length }, modelFor("reader"));
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++]!;
      try {
        for (const d of await digestBatch(opts.client, batch, opts.recorder)) {
          out.set(d.path, d);
          const file = batch.find((f) => f.path === d.path)!;
          await storage.put(`${CACHE_PREFIX}/${hashOf(file.content)}.json`, Buffer.from(JSON.stringify(d))).catch(() => undefined);
        }
      } catch {
        failed += batch.length;
      }
      for (const f of batch) if (!out.has(f.path)) out.set(f.path, outlineDigest(f, opts.graph));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  await event.succeed({ digested: todo.length - failed, outlinesOnly: failed, cached: opts.files.length - todo.length });
  return out;
}

async function digestBatch(client: MuseClient, batch: SourceFile[], recorder: RunRecorder): Promise<FileDigest[]> {
  // A file longer than a batch is cut; its digest says how far it covers and read_file has the rest.
  const body = batch
    .map((f) => {
      const lines = f.content.split("\n");
      const shown = lines.slice(0, Math.max(200, Math.floor((BATCH_CHARS / Math.max(1, f.content.length)) * lines.length)));
      return `<repository_file path="${f.path.replace(/"/g, "")}" lines="${f.lineCount}">\n${numberLines(shown)}${shown.length < lines.length ? `\n… (lines ${shown.length + 1}-${lines.length} not shown)` : ""}\n</repository_file>`;
    })
    .join("\n\n");
  const { data, usage } = await client.structured({
    model: modelFor("reader"),
    purpose: "digest_files",
    schema: digestSchema,
    schemaName: "FileDigests",
    reasoningEffort: effortFor("reader"),
    correctionAttempts: 1,
    maxTokens: 6000,
    timeoutMs: 90_000,
    messages: [
      { role: "system", content: READER_PROMPT },
      { role: "user", content: body },
    ],
  });
  await recorder.addUsage(usage.inputTokens, usage.outputTokens);
  const byPath = new Map(batch.map((f) => [f.path, f]));
  return data.files
    .filter((d) => byPath.has(d.path))
    .map((d) => {
      const f = byPath.get(d.path)!;
      // Line ranges outside the file are dropped rather than trusted.
      const points = d.keyPoints.filter((p) => p.startLine >= 1 && p.endLine >= p.startLine && p.endLine <= f.lineCount).slice(0, 10);
      return { path: f.path, lines: f.lineCount, purpose: d.purpose, points, source: "model" as const };
    });
}

/** A digest from static analysis alone: the declarations with their line ranges. */
export function outlineDigest(f: SourceFile, graph: CodeGraph): FileDigest {
  const symbols = (graph.byPath.get(f.path) ?? []).filter((s) => s.kind !== "variable" || s.exported).slice(0, 10);
  return {
    path: f.path,
    lines: f.lineCount,
    purpose: "",
    points: symbols.map((s) => ({ text: `${s.kind} ${s.parent ? `${s.parent}.` : ""}${s.name}${s.exported ? " (exported)" : ""}`, startLine: s.line, endLine: s.endLine })),
    source: "outline",
  };
}

/** A digest as prompt text. */
export function renderDigest(d: FileDigest): string {
  const points = d.points.map((p) => `- ${p.text} [${p.startLine}-${p.endLine}]`).join("\n");
  return `<file_digest path="${d.path.replace(/"/g, "")}" lines="${d.lines}">\n${d.purpose ? `${d.purpose}\n` : ""}${points}\n</file_digest>`;
}
