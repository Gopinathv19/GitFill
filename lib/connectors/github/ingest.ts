import type { RunRecorder } from "@/lib/agent/recorder";
import type { SourceFile, SourceSnapshot } from "../types";
import { GitHubClient } from "./client";
import { DEFAULT_LIMITS, languageStats, selectFiles, type SelectionLimits } from "./filter";
import { canonicalRepoUrl, isValidBranchName, parseGitHubUrl, InvalidRepositoryUrlError } from "./url";

export interface IngestOptions {
  url: string;
  /** Overrides any branch in the URL. Defaults to the repository's default branch. */
  branch?: string;
  limits?: SelectionLimits;
  client?: GitHubClient;
  concurrency?: number;
  /** Receives timed steps for the metadata/tree lookups and the file downloads. */
  recorder?: RunRecorder;
}

/**
 * GitHub connector entry point: resolves the repository to an exact commit, picks the
 * files worth reading within budget, and fetches them. Repository code is never executed.
 */
export async function ingestGitHubRepository(opts: IngestOptions): Promise<SourceSnapshot> {
  const ref = parseGitHubUrl(opts.url);
  const branchOverride = opts.branch?.trim() || undefined;
  if (branchOverride && !isValidBranchName(branchOverride)) {
    throw new InvalidRepositoryUrlError(`Invalid branch "${branchOverride}".`);
  }
  const client = opts.client ?? new GitHubClient();
  const limits = opts.limits ?? DEFAULT_LIMITS;

  const treeStep = await opts.recorder?.start("step", "github_tree", { repo: `${ref.owner}/${ref.repo}` });
  const repo = await client.getRepo(ref.owner, ref.repo);
  const branch = branchOverride ?? ref.branch ?? repo.defaultBranch;
  const commit = await client.getCommit(ref.owner, ref.repo, branch);
  const tree = await client.getTree(ref.owner, ref.repo, commit.sha);
  const { selected, inventory, totalBytes } = selectFiles(tree.entries, limits);
  await treeStep?.succeed({ entries: tree.entries.length, selected: selected.length, requests: 3 });

  const files: SourceFile[] = [];
  const failed = new Map<string, string>();
  const filesStep = await opts.recorder?.start("step", "github_files", { files: selected.length, concurrency: opts.concurrency ?? 8 });
  await mapPool(selected, opts.concurrency ?? 8, async (s) => {
    try {
      const content = await client.getFileText(ref.owner, ref.repo, commit.sha, s.path, limits.maxFileBytes);
      if (content.includes("\u0000")) {
        failed.set(s.path, "binary_content");
        return;
      }
      files.push({ path: s.path, category: s.category, sizeBytes: s.sizeBytes, content, lineCount: content.split("\n").length });
    } catch (err) {
      failed.set(s.path, err instanceof Error ? err.message : "fetch_failed");
    }
  });

  await filesStep?.succeed({ fetched: files.length, failed: failed.size, bytes: totalBytes });

  const order = new Map(selected.map((s, i) => [s.path, i]));
  files.sort((a, b) => order.get(a.path)! - order.get(b.path)!);
  for (const entry of inventory) {
    const reason = failed.get(entry.path);
    if (reason) Object.assign(entry, { selected: false, skipReason: `read_failed: ${reason}` });
  }

  return {
    connector: "github",
    displayName: repo.fullName,
    sourceUrl: canonicalRepoUrl(ref),
    version: commit.sha,
    branch,
    defaultBranch: repo.defaultBranch,
    description: repo.description,
    metadata: {
      owner: ref.owner,
      repo: ref.repo,
      stars: repo.stars,
      primaryLanguage: repo.language,
      topics: repo.topics,
      license: repo.license,
      commitMessage: commit.message,
      commitDate: commit.authoredAt,
    },
    files,
    inventory,
    stats: {
      totalEntries: tree.entries.length,
      selectedFiles: files.length,
      selectedBytes: totalBytes,
      truncatedTree: tree.truncated,
      languages: languageStats(tree.entries),
    },
  };
}

async function mapPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
