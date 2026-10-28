/**
 * Source connectors turn an external source (a GitHub repo today; uploaded files,
 * drives or other systems later) into a uniform, read-only snapshot the agent can reason over.
 * Generators and the agent depend only on these types, never on a specific connector.
 */

export interface SourceFile {
  path: string;
  /** Why the file was selected, e.g. "manifest", "entrypoint", "docs". */
  category: FileCategory;
  sizeBytes: number;
  content: string;
  lineCount: number;
}

export type FileCategory =
  | "docs"
  | "manifest"
  | "config"
  | "entrypoint"
  | "api"
  | "database"
  | "deployment"
  | "infrastructure"
  | "source"
  | "test";

export interface InventoryEntry {
  path: string;
  sizeBytes: number;
  /** Selected for reading, or the reason it was skipped. */
  selected: boolean;
  skipReason?: string;
}

export interface SourceSnapshot {
  connector: string;
  /** Canonical, human-readable identifier, e.g. "vercel/next.js". */
  displayName: string;
  sourceUrl: string;
  /** Exact immutable version the snapshot was taken at (commit SHA for git sources). */
  version: string;
  branch: string;
  defaultBranch: string;
  description: string | null;
  metadata: Record<string, unknown>;
  files: SourceFile[];
  inventory: InventoryEntry[];
  stats: SnapshotStats;
}

export interface SnapshotStats {
  totalEntries: number;
  selectedFiles: number;
  selectedBytes: number;
  truncatedTree: boolean;
  languages: Record<string, number>;
}
