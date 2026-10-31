import { diagramSpecSchema, type DiagramSpec } from "@/lib/analysis/mermaid";
import type { SourceFile } from "@/lib/connectors/types";
import { extractIdentifiers, normalizePath, verifyClaim, type Claim } from "./evidence";

/**
 * Evidence for answers written as plain Markdown. The model cites code inline as
 * `path:start-end`; application code then checks every citation against the real lines,
 * so no separate claim-recording round trip is needed and the answer can be streamed.
 */

/** `path:12` or `path:12-30` in backticks. Path segments allow Next.js-style [id] and (group) folders. */
const citationPattern = () => /`([\w@$.+()[\]-]+(?:\/[\w@$.+()[\]-]+)*):(\d+)(?:-(\d+))?`/g;

export interface ParsedAnswer {
  title: string | null;
  /** The answer without title, diagram and trailing sections; citations still inline. */
  body: string;
  diagram?: DiagramSpec;
  diagramError?: string;
  unverified: string[];
  followUps: string[];
}

const SECTIONS = { unverified: /^not verified/i, followUps: /^(ask next|you could ask next|follow[- ]?ups?)/i } as const;

/** Splits the model's Markdown answer into the parts GitFill renders separately. */
export function parseAnswer(text: string): ParsedAnswer {
  let body = text.trim();
  const wrapped = /^```(?:markdown|md)?\s*\n([\s\S]*)\n```$/.exec(body);
  if (wrapped) body = wrapped[1]!.trim();

  let diagram: DiagramSpec | undefined;
  let diagramError: string | undefined;
  body = body.replace(/^```diagram[^\n]*\n([\s\S]*?)\n```[ \t]*$/m, (_, json: string) => {
    try {
      const parsed = diagramSpecSchema.safeParse(JSON.parse(json));
      if (parsed.success) diagram = parsed.data;
      else diagramError = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch {
      diagramError = "diagram block was not valid JSON";
    }
    return "";
  });

  const out: Omit<ParsedAnswer, "title" | "body" | "diagram" | "diagramError"> = { unverified: [], followUps: [] };
  const kept: string[] = [];
  let section: keyof typeof SECTIONS | null = null;
  for (const line of body.split("\n")) {
    const heading = /^#{1,4}\s+(.+?)\s*$/.exec(line) ?? /^\*\*(.+?):?\*\*\s*$/.exec(line);
    if (heading) {
      const name = (Object.keys(SECTIONS) as Array<keyof typeof SECTIONS>).find((k) => SECTIONS[k].test(heading[1]!));
      section = name ?? null;
      if (name) continue;
    }
    if (!section) {
      kept.push(line);
      continue;
    }
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line)?.[1]?.trim();
    if (item && !/^(none|nothing|n\/a)\.?$/i.test(item)) out[section].push(item);
  }
  body = kept.join("\n").trim();

  let title: string | null = null;
  const h1 = /^#\s+(.+)\n?/.exec(body);
  if (h1) {
    title = h1[1]!.trim();
    body = body.slice(h1[0].length).trim();
  }
  return { title, body: body.replace(/\n{3,}/g, "\n\n"), diagram, diagramError, ...out };
}

export interface CitationCheck {
  claims: Claim[];
  /** One entry per citation match in `body`, in order: its claim ref, or null when it is left as plain text. */
  refs: Array<string | null>;
}

/**
 * Turns each inline citation into a claim (the sentence around it) and verifies it with
 * verifyClaim. Stricter than recorded claims: a sentence that names no code identifiers
 * cannot be checked, so it is reported as inferred rather than verified.
 */
export function verifyCitations(body: string, files: ReadonlyMap<string, SourceFile>, opts: { refPrefix: string; firstIndex: number; max: number }): CitationCheck {
  const claims: Claim[] = [];
  const refs: Array<string | null> = [];
  const seen = new Map<string, string>();
  let previousEnd = 0;
  for (const m of body.matchAll(citationPattern())) {
    const after = previousEnd;
    previousEnd = m.index! + m[0].length;
    const [, rawPath, s, e] = m;
    const path = normalizePath(rawPath!);
    if (!files.has(path) && !looksLikePath(path)) {
      refs.push(null);
      continue;
    }
    const start = Number(s);
    const end = e ? Number(e) : start;
    const statement = statementAround(body, m.index!, m[0].length, after);
    const key = `${path}:${start}-${end}|${statement}`;
    const known = seen.get(key);
    if (known) {
      refs.push(known);
      continue;
    }
    if (claims.length >= opts.max) {
      refs.push(null);
      continue;
    }
    const ref = `${opts.refPrefix}${opts.firstIndex + claims.length}`;
    const checkable = extractIdentifiers(statement).length > 0;
    const claim = verifyClaim(ref, { claim: statement, claim_type: "other", path, start_line: start, end_line: end, basis: checkable ? "observed" : "inferred" }, files);
    if (!checkable && claim.status === "inferred") claim.note = "The cited lines exist, but the sentence names no code identifiers to check against them.";
    claims.push(claim);
    seen.set(key, ref);
    refs.push(ref);
  }
  return { claims, refs };
}

/** Replaces the n-th citation with `render(ref, original)`, or leaves it when its ref is null. */
export function replaceCitations(body: string, refs: Array<string | null>, render: (ref: string, citation: string) => string): string {
  let i = 0;
  return body.replace(citationPattern(), (whole: string) => {
    const ref = refs[i++];
    return ref ? render(ref, whole.slice(1, -1)) : whole;
  });
}

/**
 * The claim text for a citation: the part of its sentence since the previous citation (so two
 * citations in one sentence each get their own clause), or the whole sentence when the citation
 * leads it. Citations and markup are stripped.
 */
function statementAround(body: string, index: number, length: number, previousEnd: number): string {
  const lineStart = body.lastIndexOf("\n", index - 1) + 1;
  const lineEndRaw = body.indexOf("\n", index + length);
  const line = body.slice(lineStart, lineEndRaw === -1 ? body.length : lineEndRaw);
  const at = index - lineStart;
  const boundaries = [...line.matchAll(/[.!?](?=\s+[A-Z`*(\[])/g)].map((b) => b.index! + 1);
  const from = Math.max(0, ...boundaries.filter((b) => b <= at));
  const to = Math.min(line.length, ...boundaries.filter((b) => b > at + length));
  const clause = line.slice(Math.max(from, previousEnd - lineStart), at);
  const sentence = clean(/\w{3,}/.test(clause.replace(citationPattern(), "").replace(/^[\s,;:]*(and|then|which|while|but)?\b/i, "")) ? clause : line.slice(from, to));
  return (sentence || "Cited code.").slice(0, 400);
}

function clean(text: string): string {
  return text
    .replace(citationPattern(), "")
    // A backticked path names the file, not code inside the cited lines.
    .replace(/`([\w@$.+()[\]-]+\/[\w@$.+()[\]/-]+)`/g, "$1")
    .replace(/^\s*(?:[-*+]|\d+[.)]|#+)\s+/, "")
    .replace(/\*\*|__/g, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,;:]\s*/, "")
    .trim();
}

function looksLikePath(path: string): boolean {
  return path.includes("/") || /\.[A-Za-z][\w]{0,7}$/.test(path);
}
