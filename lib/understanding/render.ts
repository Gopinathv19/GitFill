import { checkMermaidSyntax, mermaidFence, normalizeDiagram, renderMermaid, type DiagramSpec } from "@/lib/analysis/mermaid";
import type { SourceSnapshot } from "@/lib/connectors/types";
import { formatCitation, type Claim } from "@/lib/evidence/evidence";

/**
 * Markdown rendering shared by every document. Claims become GFM footnotes that point at
 * the exact lines (linked to GitHub at the analyzed commit when the source is GitHub), so
 * every statement in a document can be checked against the code it came from.
 */
export interface RenderContext {
  claims: Map<string, Claim>;
  used: Set<string>;
  linkFor(path: string, start?: number | null, end?: number | null): string | null;
  diagramIssues: string[];
}

export function makeRenderContext(sources: Array<{ snapshot: Pick<SourceSnapshot, "connector" | "sourceUrl" | "version">; claims: Claim[] }>): RenderContext {
  const claims = new Map<string, Claim>();
  for (const s of sources) for (const c of s.claims) claims.set(c.ref, c);
  const linkers = sources.map((s) => githubLinker(s.snapshot));
  return {
    claims,
    used: new Set(),
    diagramIssues: [],
    linkFor(path, start, end) {
      for (const l of linkers) {
        const url = l?.(path, start, end);
        if (url) return url;
      }
      return null;
    },
  };
}

function githubLinker(snapshot: Pick<SourceSnapshot, "connector" | "sourceUrl" | "version">) {
  if (snapshot.connector !== "github" || !/^[0-9a-f]{40}$/.test(snapshot.version)) return null;
  return (path: string, start?: number | null, end?: number | null) => {
    const anchor = start ? `#L${start}${end && end !== start ? `-L${end}` : ""}` : "";
    return `${snapshot.sourceUrl}/blob/${snapshot.version}/${path.split("/").map(encodeURIComponent).join("/")}${anchor}`;
  };
}

/** Inline footnote markers for the refs that exist, e.g. "[^C3][^C7]". */
export function cite(refs: string[] | undefined, ctx: RenderContext): string {
  if (!refs?.length) return "";
  const known = refs.filter((r) => ctx.claims.has(r));
  for (const r of known) ctx.used.add(r);
  return known.map((r) => `[^${r}]`).join("");
}

/** Footnote definitions for every ref cited so far. */
export function footnotes(ctx: RenderContext): string {
  const refs = [...ctx.used].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!refs.length) return "";
  return refs
    .map((r) => {
      const c = ctx.claims.get(r)!;
      const where = formatCitation(c);
      const link = c.filePath ? ctx.linkFor(c.filePath, c.startLine, c.endLine) : null;
      const loc = where ? (link ? `[${where}](${link})` : `\`${where}\``) : "no file";
      return `[^${r}]: ${statusWord(c.status)} · ${loc} — ${c.claim.replace(/\n/g, " ")}`;
    })
    .join("\n");
}

function statusWord(status: Claim["status"]): string {
  return status === "verified" ? "**Verified**" : status === "inferred" ? "*Inferred*" : "Unverified";
}

export function location(loc: string | undefined | null, ctx: RenderContext): string {
  if (!loc) return "";
  const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(loc.trim());
  const path = m ? m[1]! : loc.trim();
  const start = m ? Number(m[2]) : undefined;
  const end = m?.[3] ? Number(m[3]) : start;
  const link = ctx.linkFor(path, start, end);
  return link ? `[\`${loc}\`](${link})` : `\`${loc}\``;
}

export function bulletList(items: Array<{ text: string; claimRefs?: string[]; inferred?: boolean }>, ctx: RenderContext): string {
  return items.map((i) => `- ${i.inferred ? "*(inferred)* " : ""}${i.text}${cite(i.claimRefs, ctx)}`).join("\n");
}

export function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return "";
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [`| ${headers.map(cell).join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

/** Validates, renders and fences a diagram, followed by the files its nodes represent. */
export function diagramBlock(spec: DiagramSpec | undefined, ctx: RenderContext, opts: { heading?: string } = {}): string {
  if (!spec) return "";
  const { spec: clean, issues } = normalizeDiagram(spec);
  for (const i of issues) ctx.diagramIssues.push(`${spec.title}: ${i.message}`);
  if (!clean.nodes.length) return "";
  const text = renderMermaid(clean);
  const syntax = checkMermaidSyntax(text);
  if (syntax.length) {
    ctx.diagramIssues.push(`${spec.title}: ${syntax.join(" ")}`);
    return "";
  }
  const sources = clean.nodes
    .filter((n) => n.path)
    .slice(0, 16)
    .map((n) => `${n.label}: ${location(n.line ? `${n.path}:${n.line}` : n.path!, ctx)}${n.inferred ? " *(inferred)*" : ""}`);
  const inferredEdges = clean.edges.filter((e) => e.inferred).length;
  return [
    opts.heading ? `#### ${opts.heading}` : `#### ${clean.title}`,
    "",
    mermaidFence(text),
    "",
    clean.caption ? `*${clean.caption}*` : "",
    inferredEdges ? `*Dashed edges (${inferredEdges}) are inferred, not directly observed in code.*` : "",
    sources.length ? `<details><summary>Diagram sources</summary>\n\n${sources.map((s) => `- ${s}`).join("\n")}\n\n</details>` : "",
  ]
    .filter((s) => s !== "")
    .join("\n");
}

/** The Mermaid text alone, for clients that render it themselves. */
export function diagramMermaid(spec: DiagramSpec | undefined): string | null {
  if (!spec) return null;
  const { spec: clean } = normalizeDiagram(spec);
  if (!clean.nodes.length) return null;
  const text = renderMermaid(clean);
  return checkMermaidSyntax(text).length ? null : text;
}

export function evidenceSummary(claims: Claim[]): string {
  const n = (s: Claim["status"]) => claims.filter((c) => c.status === s).length;
  return `${claims.length} claims recorded: ${n("verified")} verified, ${n("inferred")} inferred, ${n("unverified")} unverified.`;
}

export function footer(label: string, snapshots: Array<Pick<SourceSnapshot, "displayName" | "version" | "branch">>, claims: Claim[]): string {
  const sources = snapshots.map((s) => `\`${s.displayName}\` @ \`${s.version.slice(0, 7)}\` (${s.branch})`).join(" and ");
  // Plain Markdown (no HTML): renderers never execute raw HTML from documents.
  return `\n\n---\n\n*${label} generated by GitFill from ${sources}. ${evidenceSummary(claims)} Footnotes link each statement to the lines that support it.*\n`;
}
