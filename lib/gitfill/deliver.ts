import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getGitHubConnection, getGitHubToken, githubClientFor } from "@/lib/auth/github-token";
import { appClientFor, githubAppConfig } from "@/lib/connectors/github/app";
import { parseGitHubUrl } from "@/lib/connectors/github/url";
import type { Database } from "@/lib/db";
import { documents, type DocumentKind } from "@/lib/db/schema";
import { documentFiles } from "@/lib/readme/files";
import { getStorage } from "@/lib/storage";
import { getRepository } from "@/lib/workspaces/service";
import { DOCS_DIR, DOCS_INDEX, docPath, GITFILL_DIR, GITFILL_README, GITFILL_README_TEXT, isKnowledgeSpec, KNOWLEDGE_DIR, KNOWLEDGE_INDEX, knowledgePath, readFrontMatter, withFrontMatter } from "./layout";

export class DeliveryError extends Error {
  override name = "DeliveryError";
}

export interface PlannedFile {
  path: string;
  /** Text, or base64 when `encoding` is "base64" (images). */
  content: string;
  encoding?: "utf-8" | "base64";
}

export interface PullRequestRecord {
  number: number;
  url: string;
  branch: string;
  path: string;
  openedAt: string;
  /** True when this document already had an open pull request, which is returned instead of a new one. */
  existing?: boolean;
}

/** Where each kind of document lives in the repository. */
export function destinationOf(kind: DocumentKind): "readme" | "docs" | "knowledge" {
  switch (kind) {
    case "readme":
      return "readme";
    case "brainstorm":
    case "implementation_brief":
      return "knowledge";
    default:
      return "docs";
  }
}

/**
 * The files one document becomes in the repository: README.md itself, a doc under .gitfill/docs with
 * an updated index, or a spec under .gitfill/knowledge with an updated index for coding agents. The
 * folder's own README is added the first time. Pure, so it can be checked without GitHub.
 */
export function planFiles(opts: {
  doc: { kind: DocumentKind; title: string; markdown: string; sourceCommit: string };
  now: Date;
  hasGitfillReadme: boolean;
  /** Docs already in .gitfill/docs with their front matter, for the index. */
  existingDocs: Array<{ path: string; title: string | null; sourceCommit: string | null }>;
  /** Specs already in .gitfill/knowledge (or the legacy brainstorm/) with their front matter, for its index. */
  existingKnowledge?: Array<{ path: string; title: string | null; sourceCommit: string | null; status: string | null }>;
  /** Files a README ships with (docs/readme/*), committed next to it. */
  assets?: PlannedFile[];
}): { path: string; files: PlannedFile[] } {
  const { doc, now } = opts;
  const files: PlannedFile[] = [];
  const generated = now.toISOString().slice(0, 10);
  const dest = destinationOf(doc.kind);
  let path: string;
  if (dest === "readme") {
    path = "README.md";
    files.push({ path, content: doc.markdown.trim() + "\n" });
    // Only files under docs/readme/ ship this way; a stored path can never reach elsewhere in the tree.
    for (const a of opts.assets ?? []) if (/^docs\/readme\/[\w.-]+$/.test(a.path)) files.push(a);
  } else if (dest === "knowledge") {
    path = knowledgePath(doc.title, now);
    files.push({ path, content: withFrontMatter({ gitfill: "knowledge", title: doc.title, source_commit: doc.sourceCommit, generated, status: "ready" }, doc.markdown) });
    const specs = new Map((opts.existingKnowledge ?? []).filter((d) => isKnowledgeSpec(d.path)).map((d) => [d.path, d]));
    specs.set(path, { path, title: doc.title, sourceCommit: doc.sourceCommit, status: "ready" });
    const rows = [...specs.values()]
      .sort((a, b) => b.path.localeCompare(a.path))
      .map((d) => `| [${(d.title ?? d.path.replace(/^.*\//, "")).replace(/\|/g, "\\|")}](${relativeTo(KNOWLEDGE_DIR, d.path)}) | ${d.status ?? "unknown"} | ${d.sourceCommit ? `\`${d.sourceCommit.slice(0, 7)}\`` : "unknown"} |`);
    files.push({
      path: KNOWLEDGE_INDEX,
      content: `# Knowledge\n\nIdeas worked out in GitFill's chat, written as implementation specs for coding agents. Newest first.\n\n**Coding agents:** pick a spec with status \`ready\`, read all of it, resolve its open questions with the team, follow its tasks in order and check every acceptance criterion. When it is done, set its \`status\` to \`done\` here and in the spec's front matter.\n\n| Spec | Status | Written from |\n|---|---|---|\n${rows.join("\n")}\n`,
    });
  } else {
    path = docPath(doc.title);
    files.push({ path, content: withFrontMatter({ gitfill: "docs", title: doc.title, source_commit: doc.sourceCommit, generated }, doc.markdown) });
    const docs = new Map(opts.existingDocs.filter((d) => d.path !== DOCS_INDEX).map((d) => [d.path, d]));
    docs.set(path, { path, title: doc.title, sourceCommit: doc.sourceCommit });
    const rows = [...docs.values()]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((d) => `| [${(d.title ?? d.path.slice(DOCS_DIR.length + 1)).replace(/\|/g, "\\|")}](${d.path.slice(DOCS_DIR.length + 1)}) | ${d.sourceCommit ? `\`${d.sourceCommit.slice(0, 7)}\`` : "unknown"} |`);
    files.push({
      path: DOCS_INDEX,
      content: `# Docs\n\nEngineering and architecture docs GitFill wrote from the code. Each was written from the commit shown; later changes to the code may have made it stale, so GitFill can refresh it.\n\n| Doc | Written from |\n|---|---|\n${rows.join("\n")}\n`,
    });
  }
  if (!opts.hasGitfillReadme) files.push({ path: GITFILL_README, content: GITFILL_README_TEXT });
  return { path, files };
}

/** A link from the index in `dir` to `path`; legacy brainstorm/ specs are one level up. */
function relativeTo(dir: string, path: string): string {
  return path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : `../${path.slice(GITFILL_DIR.length + 1)}`;
}

/**
 * Opens a pull request that adds a document to its place in the repository, on a new branch from
 * the default branch. With GitFill's GitHub App configured, the commit and pull request are made by
 * the app ("gitfill[bot]"); the user's own token is only used to read and to check that they may push.
 * The pull request is recorded on the document.
 */
export async function openDocumentPullRequest(db: Database, userId: string, row: { document: typeof documents.$inferSelect; workspaceId: string; repositoryId: string | null }): Promise<PullRequestRecord> {
  const doc = row.document;
  if (!row.repositoryId) throw new DeliveryError("This document is not linked to a workspace repository.");
  const repo = await getRepository(db, userId, row.workspaceId, row.repositoryId);
  if (!repo.repositoryUrl) throw new DeliveryError(`"${repo.name}" has no code on GitHub yet.`);
  const ref = parseGitHubUrl(repo.repositoryUrl);
  // Without the user's own token GitHub cannot say whether they may push, and the app (or the server's
  // fallback token) must never write on behalf of someone who could not.
  if (!(await getGitHubToken(db, userId))) throw new DeliveryError("Connect your GitHub account on the Configuration page to open pull requests.");
  const client = await githubClientFor(db, userId);
  const info = await client.getRepo(ref.owner, ref.repo);
  // The app can write wherever it is installed, so it only acts for people who could push themselves.
  if (info.canPush !== true) throw new DeliveryError(`Your GitHub account cannot push to ${info.fullName}, so GitFill will not open a pull request there.`);
  // One open pull request per document: asking again points at it instead of opening a duplicate.
  const earlier = Array.isArray((doc.metadata as Record<string, unknown> | null)?.pullRequests) ? ((doc.metadata as { pullRequests: PullRequestRecord[] }).pullRequests) : [];
  for (const pr of [...earlier].reverse()) {
    if ((await client.pullRequestState(ref.owner, ref.repo, pr.number).catch(() => null)) === "open") return { ...pr, existing: true };
  }
  const app = githubAppConfig();
  const writer = app ? await appClientFor(ref.owner, ref.repo, app) : client;
  const requester = (await getGitHubConnection(db, userId)).login;
  // Into the branch GitFill works on (the one the document was written from); GitHub's default if it was deleted.
  let base = repo.defaultBranch ?? info.defaultBranch;
  let head = await client.getCommit(ref.owner, ref.repo, base).catch(() => null);
  if (!head) {
    base = info.defaultBranch;
    head = await client.getCommit(ref.owner, ref.repo, base);
  }
  const tree = await client.getTree(ref.owner, ref.repo, head.sha);
  const existingDocs = [];
  const docEntries = destinationOf(doc.kind) === "docs" ? tree.entries.filter((x) => x.type === "blob" && x.path.startsWith(`${DOCS_DIR}/`) && x.path.endsWith(".md") && x.path !== DOCS_INDEX) : [];
  for (const e of docEntries.slice(0, 50)) {
    const text = await client.getFileHead(ref.owner, ref.repo, head.sha, e.path, 4000);
    const fm = text ? readFrontMatter(text) : {};
    existingDocs.push({ path: e.path, title: fm.title ?? null, sourceCommit: fm.source_commit ?? null });
  }

  const existingKnowledge = [];
  if (destinationOf(doc.kind) === "knowledge") {
    for (const e of tree.entries.filter((x) => x.type === "blob" && isKnowledgeSpec(x.path)).sort((a, b) => b.path.localeCompare(a.path)).slice(0, 80)) {
      const text = await client.getFileHead(ref.owner, ref.repo, head.sha, e.path, 4000);
      const fm = text ? readFrontMatter(text) : {};
      existingKnowledge.push({ path: e.path, title: fm.title ?? null, sourceCommit: fm.source_commit ?? null, status: fm.status ?? null });
    }
  }

  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  const sourceCommit = typeof meta.commitSha === "string" ? meta.commitSha : head.sha;
  const assets: PlannedFile[] = [];
  for (const f of destinationOf(doc.kind) === "readme" ? documentFiles(doc.metadata) : []) {
    const bytes = await getStorage().get(f.key);
    assets.push(f.mime === "image/svg+xml" ? { path: f.path, content: bytes.toString("utf8") } : { path: f.path, content: bytes.toString("base64"), encoding: "base64" });
  }
  const plan = planFiles({
    doc: { kind: doc.kind, title: doc.title, markdown: doc.markdown, sourceCommit },
    now: new Date(),
    hasGitfillReadme: tree.entries.some((e) => e.path === GITFILL_README),
    existingDocs,
    existingKnowledge,
    assets,
  });
  const dest = destinationOf(doc.kind);
  const what = dest === "readme" ? "README" : dest === "knowledge" ? "knowledge spec" : "doc";
  const branch = `gitfill/${dest}-${plan.path.replace(/^.*\//, "").replace(/\.md$/i, "").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40)}-${randomBytes(3).toString("hex")}`;
  const pr = await writer.openPullRequest(ref.owner, ref.repo, {
    base,
    branch,
    title: `GitFill: ${dest === "readme" ? "update README.md" : `add ${what} "${doc.title}"`}`.slice(0, 120),
    message: `${dest === "readme" ? "Update README.md" : `Add ${what}: ${doc.title}`}\n\nWritten by GitFill from ${ref.owner}/${ref.repo}@${sourceCommit.slice(0, 7)}.`,
    body: [
      `GitFill wrote this ${what} from the code at \`${sourceCommit.slice(0, 7)}\`${app && requester ? `, as requested by @${requester}` : ""}.`,
      "",
      ...plan.files.map((f) => `- \`${f.path}\``),
      "",
      dest === "knowledge"
        ? `The spec is written for a coding agent: point Claude Code (or another agent) at \`${plan.path}\` (listed in \`${KNOWLEDGE_INDEX}\`) and ask it to implement it. Review the decisions and open questions before merging.`
        : "Review it like any other change; every statement was checked against the code when it was written.",
    ].join("\n"),
    files: plan.files,
  });

  const record: PullRequestRecord = { number: pr.number, url: pr.url, branch: pr.branch, path: plan.path, openedAt: new Date().toISOString() };
  const previous = Array.isArray(meta.pullRequests) ? (meta.pullRequests as PullRequestRecord[]) : [];
  await db.update(documents).set({ metadata: { ...meta, pullRequests: [...previous, record] } }).where(eq(documents.id, doc.id));
  return record;
}
