import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getGitHubConnection, githubClientFor } from "@/lib/auth/github-token";
import { appClientFor, githubAppConfig } from "@/lib/connectors/github/app";
import { parseGitHubUrl } from "@/lib/connectors/github/url";
import type { Database } from "@/lib/db";
import { documents, type DocumentKind } from "@/lib/db/schema";
import { getRepository } from "@/lib/workspaces/service";
import { brainstormPath, DOCS_DIR, DOCS_INDEX, docPath, GITFILL_README, GITFILL_README_TEXT, readFrontMatter, withFrontMatter } from "./layout";

export class DeliveryError extends Error {
  override name = "DeliveryError";
}

export interface PlannedFile {
  path: string;
  content: string;
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
export function destinationOf(kind: DocumentKind): "readme" | "docs" | "brainstorm" {
  switch (kind) {
    case "readme":
      return "readme";
    case "brainstorm":
    case "implementation_brief":
      return "brainstorm";
    default:
      return "docs";
  }
}

/**
 * The files one document becomes in the repository: README.md itself, a doc under .gitfill/docs with
 * an updated index, or a brainstorm spec under .gitfill/brainstorm. The folder's own README is added
 * the first time. Pure, so it can be checked without GitHub.
 */
export function planFiles(opts: {
  doc: { kind: DocumentKind; title: string; markdown: string; sourceCommit: string };
  now: Date;
  hasGitfillReadme: boolean;
  /** Docs already in .gitfill/docs with their front matter, for the index. */
  existingDocs: Array<{ path: string; title: string | null; sourceCommit: string | null }>;
}): { path: string; files: PlannedFile[] } {
  const { doc, now } = opts;
  const files: PlannedFile[] = [];
  const generated = now.toISOString().slice(0, 10);
  const dest = destinationOf(doc.kind);
  let path: string;
  if (dest === "readme") {
    path = "README.md";
    files.push({ path, content: doc.markdown.trim() + "\n" });
  } else if (dest === "brainstorm") {
    path = brainstormPath(doc.title, now);
    files.push({ path, content: withFrontMatter({ gitfill: "brainstorm", title: doc.title, source_commit: doc.sourceCommit, generated, status: "ready" }, doc.markdown) });
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
  const client = await githubClientFor(db, userId);
  const info = await client.getRepo(ref.owner, ref.repo);
  // The app can write wherever it is installed, so it only acts for people who could push themselves.
  if (info.canPush === false) throw new DeliveryError(`Your GitHub account cannot push to ${info.fullName}, so GitFill will not open a pull request there.`);
  // One open pull request per document: asking again points at it instead of opening a duplicate.
  const earlier = Array.isArray((doc.metadata as Record<string, unknown> | null)?.pullRequests) ? ((doc.metadata as { pullRequests: PullRequestRecord[] }).pullRequests) : [];
  for (const pr of [...earlier].reverse()) {
    if ((await client.pullRequestState(ref.owner, ref.repo, pr.number).catch(() => null)) === "open") return { ...pr, existing: true };
  }
  const app = githubAppConfig();
  const writer = app ? await appClientFor(ref.owner, ref.repo, app) : client;
  const requester = (await getGitHubConnection(db, userId)).login;
  const base = info.defaultBranch;
  const head = await client.getCommit(ref.owner, ref.repo, base);
  const tree = await client.getTree(ref.owner, ref.repo, head.sha);
  const existingDocs = [];
  for (const e of tree.entries.filter((x) => x.type === "blob" && x.path.startsWith(`${DOCS_DIR}/`) && x.path.endsWith(".md") && x.path !== DOCS_INDEX).slice(0, 50)) {
    const text = await client.getFileTextIfExists(ref.owner, ref.repo, head.sha, e.path, 4000);
    const fm = text ? readFrontMatter(text) : {};
    existingDocs.push({ path: e.path, title: fm.title ?? null, sourceCommit: fm.source_commit ?? null });
  }

  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  const sourceCommit = typeof meta.commitSha === "string" ? meta.commitSha : head.sha;
  const plan = planFiles({
    doc: { kind: doc.kind, title: doc.title, markdown: doc.markdown, sourceCommit },
    now: new Date(),
    hasGitfillReadme: tree.entries.some((e) => e.path === GITFILL_README),
    existingDocs,
  });
  const dest = destinationOf(doc.kind);
  const what = dest === "readme" ? "README" : dest === "brainstorm" ? "brainstorm spec" : "doc";
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
      dest === "brainstorm"
        ? "The spec is written for a coding agent: point Claude Code (or another agent) at the file and ask it to implement it. Review the decisions before merging."
        : "Review it like any other change; every statement was checked against the code when it was written.",
    ].join("\n"),
    files: plan.files,
  });

  const record: PullRequestRecord = { number: pr.number, url: pr.url, branch: pr.branch, path: plan.path, openedAt: new Date().toISOString() };
  const previous = Array.isArray(meta.pullRequests) ? (meta.pullRequests as PullRequestRecord[]) : [];
  await db.update(documents).set({ metadata: { ...meta, pullRequests: [...previous, record] } }).where(eq(documents.id, doc.id));
  return record;
}
