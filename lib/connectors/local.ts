import type { SourceFile, SourceSnapshot } from "./types";
import { DEFAULT_LIMITS, languageStats, selectFiles, type SelectionLimits } from "./github/filter";
import type { TreeEntry } from "./github/client";

/**
 * Local connector: builds a snapshot from files a client already has (the VS Code
 * extension sends the relevant part of its workspace). The same filters as the GitHub
 * connector apply, so secrets, lockfiles and binaries are never analyzed.
 */
export interface LocalFileInput {
  path: string;
  content: string;
}

export interface LocalSnapshotInput {
  name: string;
  files: LocalFileInput[];
  /** Every path in the workspace, when the client knows more than it sent (for import resolution). */
  allPaths?: string[];
  branch?: string;
  /** HEAD commit or a client-side label for the working tree. */
  version?: string;
  description?: string | null;
  limits?: SelectionLimits;
}

const MAX_INPUT_FILES = 400;

export function snapshotFromFiles(input: LocalSnapshotInput): SourceSnapshot {
  const seen = new Set<string>();
  const provided = input.files
    .map((f) => ({ ...f, path: normalize(f.path) }))
    .filter((f) => {
      if (!f.path || seen.has(f.path) || f.path.includes("..")) return false;
      seen.add(f.path);
      return true;
    })
    .slice(0, MAX_INPUT_FILES);
  const byPath = new Map(provided.map((f) => [f.path, f.content]));

  const treePaths = new Set<string>([...byPath.keys(), ...(input.allPaths ?? []).map(normalize).filter((p) => p && !p.includes(".."))]);
  const tree: TreeEntry[] = [...treePaths].map((path) => ({ path, type: "blob", size: byPath.get(path)?.length ?? 0 }));
  // Files the client did not send cannot be selected; they stay in the inventory as structure.
  const limits = input.limits ?? DEFAULT_LIMITS;
  const { selected, inventory, totalBytes } = selectFiles(tree, { ...limits, maxFiles: Math.max(limits.maxFiles, provided.length) });

  // Paths the client only listed (not sent) carry no content: say so instead of "empty".
  for (const entry of inventory) {
    if (!byPath.has(entry.path) && !entry.selected && entry.skipReason === "empty") entry.skipReason = "not_sent_by_client";
  }

  const files: SourceFile[] = [];
  for (const s of selected) {
    const content = byPath.get(s.path);
    if (content === undefined) {
      const entry = inventory.find((i) => i.path === s.path);
      if (entry) Object.assign(entry, { selected: false, skipReason: "not_sent_by_client" });
      continue;
    }
    if (content.includes("\u0000")) continue;
    files.push({ path: s.path, category: s.category, sizeBytes: content.length, content, lineCount: content.split("\n").length });
  }

  return {
    connector: "local",
    displayName: input.name,
    sourceUrl: `local://${input.name}`,
    version: input.version ?? "working-tree",
    branch: input.branch ?? "working-tree",
    defaultBranch: input.branch ?? "working-tree",
    description: input.description ?? null,
    metadata: { owner: "local", repo: input.name },
    files,
    inventory,
    stats: { totalEntries: tree.length, selectedFiles: files.length, selectedBytes: totalBytes, truncatedTree: false, languages: languageStats(tree) },
  };
}

function normalize(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
}
