import { z } from "zod";
import type { SourceFile } from "@/lib/connectors/types";
import type { ClaimStatus } from "@/lib/db/schema";

export const CLAIM_TYPES = [
  "purpose",
  "architecture",
  "component",
  "api",
  "data_model",
  "data_flow",
  "technology",
  "deployment",
  "security",
  "testing",
  "other",
] as const;

export const claimInputSchema = z.object({
  claim: z.string().min(8).max(400).describe("One precise technical statement about the repository."),
  claim_type: z.enum(CLAIM_TYPES),
  path: z.string().max(400).describe("Repository-relative path of the supporting file."),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
  basis: z.enum(["observed", "inferred"]).describe("observed = the lines state it directly; inferred = a conclusion drawn from them."),
});

export type ClaimInput = z.infer<typeof claimInputSchema>;

export interface Claim {
  ref: string;
  claim: string;
  claimType: (typeof CLAIM_TYPES)[number];
  filePath: string | null;
  startLine: number | null;
  endLine: number | null;
  excerpt: string | null;
  status: ClaimStatus;
  /** Why the status was assigned, shown in the evidence report. */
  note: string;
}

const MAX_SPAN_LINES = 80;
const MAX_EXCERPT_CHARS = 700;

/**
 * Checks a model-proposed claim against the actual file contents at the snapshot commit.
 * The model never decides a claim's status: application code does, from real lines.
 */
export function verifyClaim(ref: string, input: ClaimInput, files: ReadonlyMap<string, SourceFile>): Claim {
  const base = { ref, claim: input.claim.trim(), claimType: input.claim_type };
  const file = files.get(normalizePath(input.path));
  if (!file) {
    return { ...base, filePath: null, startLine: null, endLine: null, excerpt: null, status: "unverified", note: `File "${input.path}" is not in the analyzed snapshot.` };
  }
  const lines = file.content.split("\n");
  if (input.start_line > lines.length || input.end_line < input.start_line) {
    return { ...base, filePath: file.path, startLine: null, endLine: null, excerpt: null, status: "unverified", note: `Line range ${input.start_line}-${input.end_line} is invalid for a ${lines.length}-line file.` };
  }
  const end = Math.min(input.end_line, lines.length, input.start_line + MAX_SPAN_LINES - 1);
  const excerptLines = lines.slice(input.start_line - 1, end);
  const excerpt = clip(excerptLines.join("\n"));

  const identifiers = extractIdentifiers(input.claim);
  const haystack = excerptLines.join("\n").toLowerCase();
  const missing = identifiers.filter((id) => !haystack.includes(id.toLowerCase()));
  const location = { filePath: file.path, startLine: input.start_line, endLine: end, excerpt };

  if (identifiers.length > 0 && missing.length === identifiers.length) {
    return { ...base, ...location, status: "unverified", note: `None of the named identifiers (${missing.join(", ")}) appear in the cited lines.` };
  }
  if (input.basis === "inferred") {
    return { ...base, ...location, status: "inferred", note: "Conclusion drawn from the cited lines." };
  }
  const note = missing.length > 0 ? `Cited lines support the claim; not found in range: ${missing.join(", ")}.` : "Cited lines directly support the claim.";
  return { ...base, ...location, status: "verified", note };
}

/** Code-like tokens in backticks are checked against the cited lines. */
export function extractIdentifiers(claim: string): string[] {
  const ids = new Set<string>();
  for (const m of claim.matchAll(/`([^`]{2,80})`/g)) ids.add(m[1]!.trim());
  return [...ids];
}

export function normalizePath(path: string): string {
  return path.trim().replace(/^\.?\//, "").replace(/\\/g, "/");
}

function clip(text: string): string {
  return text.length > MAX_EXCERPT_CHARS ? `${text.slice(0, MAX_EXCERPT_CHARS)}…` : text;
}

export function formatCitation(claim: Pick<Claim, "filePath" | "startLine" | "endLine">): string | null {
  if (!claim.filePath) return null;
  if (claim.startLine === null) return claim.filePath;
  return claim.startLine === claim.endLine ? `${claim.filePath}:${claim.startLine}` : `${claim.filePath}:${claim.startLine}-${claim.endLine}`;
}
