/**
 * Repository storage: code at an exact commit, searchable on demand. Agents and answer code talk
 * only to CodeSource, so the store behind it can be in-process (LocalGitStore), a separate repo
 * service (RemoteRepoStore → scripts/repo-service.ts), or an in-memory snapshot (SnapshotSource).
 * Nothing here ever executes repository code: git only reads objects from a bare repository.
 */

export interface GrepHit {
  path: string;
  line: number;
  text: string;
}

export interface ListOptions {
  /** Directory prefix, e.g. "lib/agent". */
  dir?: string;
  /** Glob over the full path, e.g. "**\/*.ts". */
  glob?: string;
  limit?: number;
}

export interface GrepOptions {
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  /** Literal search instead of a regular expression. */
  fixed?: boolean;
  maxResults?: number;
}

export interface FileRead {
  path: string;
  /** Lines start..end (1-based, inclusive) of the file. */
  lines: string[];
  start: number;
  total: number;
}

export interface CodeSource {
  /** e.g. "owner/repo @ abc1234". */
  readonly label: string;
  /** Exact commit SHA (or snapshot version). */
  readonly version: string;
  listFiles(opts?: ListOptions): Promise<{ paths: string[]; total: number }>;
  grep(pattern: string, opts?: GrepOptions): Promise<{ hits: GrepHit[]; truncated: boolean }>;
  /** null when the file does not exist, is hidden (secrets, lockfiles, generated) or is binary. */
  read(path: string, range?: { start?: number; end?: number }): Promise<FileRead | null>;
}

export interface OpenRequest {
  owner: string;
  repo: string;
  sha: string;
  /** The caller's GitHub token, used only for this fetch and never stored. */
  token?: string;
  /** Repository size from the GitHub API, checked against the size limit before fetching. */
  sizeKb?: number;
}

export interface OpenResult {
  source: CodeSource;
  /** Where the commit came from: already on disk, restored from the archive cache, or fetched from GitHub. */
  origin: "disk" | "archive" | "github";
  ms: number;
}

export interface RepoStore {
  readonly kind: "local" | "remote";
  open(req: OpenRequest): Promise<OpenResult>;
}

/** Problems with the store itself; callers fall back to the snapshot path. */
export class RepoStoreError extends Error {
  override name = "RepoStoreError";
  constructor(
    message: string,
    readonly code: "too_large" | "fetch_failed" | "invalid_request" | "unavailable" | "timeout",
  ) {
    super(message);
  }
}

/** The model's search pattern is not a valid regular expression. */
export class InvalidPatternError extends Error {
  override name = "InvalidPatternError";
}

export const SHA_RE = /^[0-9a-f]{40}$/;
export const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function validateOpen(req: OpenRequest): void {
  if (!NAME_RE.test(req.owner) || !NAME_RE.test(req.repo) || req.repo.endsWith(".git")) throw new RepoStoreError("Invalid repository name.", "invalid_request");
  if (!SHA_RE.test(req.sha)) throw new RepoStoreError("Invalid commit SHA.", "invalid_request");
}
