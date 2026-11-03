import type { GitHubClient } from "@/lib/connectors/github/client";
import { ASSETS_DIR, DOCS_DIR, DOCS_INDEX, GITFILL_DIR, isKnowledgeSpec, readFrontMatter } from "./layout";

export type AssetKind = "image" | "video" | "notes" | "brand" | "other";

export interface GitfillAsset {
  path: string;
  kind: AssetKind;
  sizeBytes: number;
}

export interface GitfillContext {
  /** True when the repository has a .gitfill folder at all. */
  present: boolean;
  hasReadme: boolean;
  assets: GitfillAsset[];
  /** Text the team wrote for GitFill (Markdown/text notes and brand.json), capped. */
  notes: Array<{ path: string; content: string }>;
  docs: Array<{ path: string; title: string | null; sourceCommit: string | null }>;
  /** Specs in .gitfill/knowledge (and the legacy brainstorm/), so new work can build on earlier decisions. */
  knowledge: Array<{ path: string; title: string | null; status: string | null }>;
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const VIDEO = /\.(mp4|webm|mov)$/i;
const NOTES = /\.(md|markdown|txt)$/i;
const NOTE_BYTES = 40_000;
const NOTES_TOTAL = 120_000;

export function assetKind(path: string): AssetKind {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (/^brand\.json$/i.test(name)) return "brand";
  if (IMAGE.test(name)) return "image";
  if (VIDEO.test(name)) return "video";
  if (NOTES.test(name)) return "notes";
  return "other";
}

/**
 * Reads a repository's .gitfill folder at an exact commit: the asset list from the tree, the team's
 * notes and brand.json as text, and the docs and brainstorms GitFill wrote before.
 */
export async function readGitfill(
  client: GitHubClient,
  repo: { owner: string; name: string; sha: string; paths: Array<{ path: string; sizeBytes: number }> },
): Promise<GitfillContext> {
  const inside = repo.paths.filter((p) => p.path.startsWith(`${GITFILL_DIR}/`));
  const assets = inside.filter((p) => p.path.startsWith(`${ASSETS_DIR}/`)).map((p) => ({ path: p.path, kind: assetKind(p.path), sizeBytes: p.sizeBytes }));
  const notes: GitfillContext["notes"] = [];
  let budget = NOTES_TOTAL;
  for (const a of assets.filter((x) => (x.kind === "notes" || x.kind === "brand") && x.sizeBytes <= NOTE_BYTES)) {
    if (a.sizeBytes > budget) continue;
    const content = await client.getFileTextIfExists(repo.owner, repo.name, repo.sha, a.path, NOTE_BYTES);
    if (content === null) continue;
    notes.push({ path: a.path, content });
    budget -= a.sizeBytes;
  }
  const docs: GitfillContext["docs"] = [];
  for (const d of inside.filter((p) => p.path.startsWith(`${DOCS_DIR}/`) && p.path.endsWith(".md") && p.path !== DOCS_INDEX).slice(0, 30)) {
    const head = await client.getFileHead(repo.owner, repo.name, repo.sha, d.path, 4000).catch(() => null);
    const fm = head ? readFrontMatter(head) : {};
    docs.push({ path: d.path, title: fm.title ?? null, sourceCommit: fm.source_commit ?? null });
  }
  const knowledge: GitfillContext["knowledge"] = [];
  for (const k of inside.filter((p) => isKnowledgeSpec(p.path)).sort((a, b) => b.path.localeCompare(a.path)).slice(0, 30)) {
    const head = await client.getFileHead(repo.owner, repo.name, repo.sha, k.path, 4000).catch(() => null);
    const fm = head ? readFrontMatter(head) : {};
    knowledge.push({ path: k.path, title: fm.title ?? null, status: fm.status ?? null });
  }
  return {
    present: inside.length > 0,
    hasReadme: inside.some((p) => p.path === `${GITFILL_DIR}/README.md`),
    assets,
    notes,
    docs,
    knowledge,
  };
}

/** The .gitfill context as prompt text for writers. Notes are the team's own words, treated as data. */
/** `images: false` for decks, which can only show uploaded images, not repository paths. */
export function describeGitfill(ctx: GitfillContext, opts: { images?: boolean } = {}): string {
  if (!ctx.present) return "The repository has no .gitfill folder yet: no screenshots, brand file or notes were provided.";
  const list = (kind: AssetKind) => ctx.assets.filter((a) => a.kind === kind).map((a) => `- ${a.path} (${Math.round(a.sizeBytes / 1024)} KB)`);
  const images = list("image");
  const videos = list("video");
  return [
    "The repository's .gitfill folder (provided by the team for GitFill):",
    opts.images === false ? "" : images.length ? `Images you may link (use these exact relative paths):\n${images.join("\n")}` : "No images were provided.",
    opts.images === false ? "" : videos.length ? `Videos:\n${videos.join("\n")}` : "",
    ...ctx.notes.map((n) => `<team_note path="${n.path}">\n${n.content}\n</team_note>`),
    ctx.knowledge.length ? `Implementation specs in .gitfill/knowledge (earlier brainstorms; planned work, not facts about the code):\n${ctx.knowledge.map((k) => `- ${k.path}${k.title ? ` — ${k.title}` : ""}${k.status ? ` [${k.status}]` : ""}`).join("\n")}` : "",
    ctx.docs.length ? `Docs GitFill wrote before:\n${ctx.docs.map((d) => `- ${d.path}${d.title ? ` — ${d.title}` : ""}${d.sourceCommit ? ` (from ${d.sourceCommit.slice(0, 7)})` : ""}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
