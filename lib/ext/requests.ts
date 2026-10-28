import { z } from "zod";
import { askRequestSchema } from "@/lib/understanding/schemas";

/**
 * Request bodies of the extension API (/api/ext/*). The extension sends only the files
 * relevant to the request; the server applies the same secret and binary filters as the
 * GitHub connector and never stores workspace content.
 */
export const fileSchema = z.object({ path: z.string().min(1).max(400), content: z.string().max(400_000) });

export const workspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  files: z.array(fileSchema).max(400),
  allPaths: z.array(z.string().max(400)).max(20_000).optional(),
  branch: z.string().max(200).optional(),
  head: z.string().max(64).optional(),
});

export const extExplainSchema = askRequestSchema.pick({ question: true, diagram: true }).extend({
  workspace: workspaceSchema,
  /** The active file and selection, when the question is about selected code. */
  focus: z.object({ path: z.string().max(400), startLine: z.number().int().min(1).optional(), endLine: z.number().int().min(1).optional(), selection: z.string().max(40_000).optional() }).optional(),
});

export const extDocumentSchema = z.object({
  path: z.string().min(1).max(400),
  content: z.string().max(400_000),
  selection: z.object({ startLine: z.number().int().min(1), endLine: z.number().int().min(1) }).optional(),
});

export const extChangesSchema = z.object({
  workspace: workspaceSchema,
  /** Unified diff produced by git (working tree, staged, or commit range). */
  diff: z.string().min(1).max(400_000),
  /** What the diff covers, e.g. "working tree vs HEAD" or "abc123..def456". */
  scope: z.string().max(200),
  question: z.string().max(2000).optional(),
});

export const extDriftSchema = z.object({
  documentName: z.string().max(200),
  document: z.string().min(1).max(200_000),
  changes: z.string().min(1).max(400_000),
});
