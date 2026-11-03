import { env } from "@/lib/config/env";
import { isValidBranchName } from "./url";

const ALLOWED_HOSTS = new Set(["api.github.com", "raw.githubusercontent.com"]);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const MAX_JSON_BYTES = 30 * 1024 * 1024;

export class GitHubError extends Error {
  override name = "GitHubError";
  constructor(
    message: string,
    readonly status: number,
    readonly code: "not_found" | "rate_limited" | "forbidden" | "unauthorized" | "timeout" | "too_large" | "upstream",
  ) {
    super(message);
  }
}

export interface RepoInfo {
  fullName: string;
  description: string | null;
  defaultBranch: string;
  private: boolean;
  stars: number;
  language: string | null;
  topics: string[];
  license: string | null;
  htmlUrl: string;
  /** Repository size in KB as GitHub reports it. */
  sizeKb: number;
  /** Whether the token's account can push; null when GitHub did not say (e.g. app tokens). */
  canPush: boolean | null;
}

export interface CommitInfo {
  sha: string;
  message: string;
  authoredAt: string | null;
  author?: string | null;
}

export interface CompareFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  patch?: string;
  previousFilename?: string;
}

export interface CompareResult {
  baseSha: string;
  headSha: string;
  status: "ahead" | "behind" | "identical" | "diverged";
  aheadBy: number;
  behindBy: number;
  totalCommits: number;
  commits: CommitInfo[];
  files: CompareFile[];
}

export interface UserRepo {
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  pushedAt: string | null;
  language: string | null;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
}

/**
 * Minimal GitHub REST client acting with one token: the signed-in user's OAuth token
 * (their repositories, their rate limit) or the server's GITHUB_TOKEN for public reads.
 * Every URL is built from validated components and checked against an allow-list,
 * including across redirects (SSRF guard).
 */
export class GitHubClient {
  /** Called once when GitHub rejects the token (401), so callers can drop a revoked token. */
  onUnauthorized?: () => void | Promise<void>;

  constructor(
    private readonly token: string | undefined = env().GITHUB_TOKEN,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get authenticated(): boolean {
    return Boolean(this.token);
  }

  /** The token for a single `git fetch` of a repository this client can read. Never log or store it. */
  gitFetchToken(): string | undefined {
    return this.token;
  }

  async getRepo(owner: string, repo: string): Promise<RepoInfo> {
    const data = await this.json<Record<string, unknown>>(this.api(`/repos/${seg(owner)}/${seg(repo)}`));
    const license = data.license as { spdx_id?: string } | null;
    return {
      fullName: String(data.full_name),
      description: (data.description as string | null) ?? null,
      defaultBranch: String(data.default_branch),
      private: data.private === true,
      stars: Number(data.stargazers_count ?? 0),
      language: (data.language as string | null) ?? null,
      topics: Array.isArray(data.topics) ? data.topics.map(String) : [],
      license: license?.spdx_id ?? null,
      htmlUrl: String(data.html_url),
      sizeKb: Number(data.size ?? 0),
      canPush: typeof (data.permissions as { push?: unknown } | undefined)?.push === "boolean" ? Boolean((data.permissions as { push: boolean }).push) : null,
    };
  }

  /** GitHub App (JWT client): the app's installation on a repository, or null when it is not installed there. */
  async getRepoInstallation(owner: string, repo: string): Promise<{ id: number } | null> {
    try {
      const data = await this.json<{ id: number }>(this.api(`/repos/${seg(owner)}/${seg(repo)}/installation`));
      return { id: data.id };
    } catch (err) {
      if (err instanceof GitHubError && err.code === "not_found") return null;
      throw err;
    }
  }

  /** GitHub App (JWT client): a token for one installation, limited to one repository and the given permissions. */
  async createInstallationToken(installationId: number, repo: string, permissions: Record<string, "read" | "write">): Promise<{ token: string; expiresAt: string }> {
    const data = await this.send<{ token: string; expires_at: string }>("POST", this.api(`/app/installations/${installationId}/access_tokens`), { repositories: [repo], permissions });
    return { token: data.token, expiresAt: data.expires_at };
  }

  async getCommit(owner: string, repo: string, ref: string): Promise<CommitInfo> {
    if (!isValidBranchName(ref)) throw new GitHubError(`Invalid ref "${ref}".`, 400, "upstream");
    const data = await this.json<{ sha: string; commit: { message: string; author?: { date?: string } } }>(
      this.api(`/repos/${seg(owner)}/${seg(repo)}/commits/${encodeURIComponent(ref)}`),
    );
    return { sha: data.sha, message: data.commit.message.split("\n")[0] ?? "", authoredAt: data.commit.author?.date ?? null };
  }

  /** Repositories the token's user can access (owned, collaborator, organization), most recently pushed first. */
  async listUserRepos(opts: { perPage?: number; page?: number } = {}): Promise<UserRepo[]> {
    if (!this.token) throw new GitHubError("Connect your GitHub account to list your repositories.", 401, "unauthorized");
    const query = new URLSearchParams({ affiliation: "owner,collaborator,organization_member", sort: "pushed", per_page: String(Math.min(opts.perPage ?? 100, 100)), page: String(opts.page ?? 1) });
    const data = await this.json<Array<Record<string, unknown>>>(this.api(`/user/repos?${query}`));
    return data.map((r) => ({
      fullName: String(r.full_name),
      owner: String((r.owner as { login?: string } | undefined)?.login ?? String(r.full_name).split("/")[0]),
      name: String(r.name),
      description: (r.description as string | null) ?? null,
      private: r.private === true,
      defaultBranch: String(r.default_branch ?? "main"),
      htmlUrl: String(r.html_url),
      pushedAt: (r.pushed_at as string | null) ?? null,
      language: (r.language as string | null) ?? null,
    }));
  }

  /** The authenticated user's profile and the scopes GitHub granted to the token. */
  async whoami(): Promise<{ id: number; login: string; name: string | null; email: string | null; avatarUrl: string | null; scopes: string[] }> {
    const res = await this.request(this.api("/user"));
    const scopes = (res.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const data = JSON.parse(new TextDecoder().decode(await readCapped(res, MAX_JSON_BYTES))) as { id: number; login: string; name: string | null; email: string | null; avatar_url: string | null };
    return { id: data.id, login: data.login, name: data.name, email: data.email, avatarUrl: data.avatar_url, scopes };
  }

  /** Branch names, up to 100 (GitHub's page size), in GitHub's order. */
  async listBranches(owner: string, repo: string): Promise<string[]> {
    const data = await this.json<Array<{ name: string }>>(this.api(`/repos/${seg(owner)}/${seg(repo)}/branches?per_page=100`));
    return data.map((b) => b.name);
  }

  /** Recent commits on a branch (or from a SHA), newest first. */
  async listCommits(owner: string, repo: string, ref: string | undefined, perPage = 30): Promise<CommitInfo[]> {
    if (ref && !isValidBranchName(ref)) throw new GitHubError(`Invalid ref "${ref}".`, 400, "upstream");
    const query = new URLSearchParams({ per_page: String(Math.min(Math.max(perPage, 1), 100)) });
    if (ref) query.set("sha", ref);
    const data = await this.json<Array<{ sha: string; commit: { message: string; author?: { name?: string; date?: string } } }>>(
      this.api(`/repos/${seg(owner)}/${seg(repo)}/commits?${query}`),
    );
    return data.map((c) => ({ sha: c.sha, message: c.commit.message.split("\n")[0] ?? "", authoredAt: c.commit.author?.date ?? null, author: c.commit.author?.name ?? null }));
  }

  /** Three-dot comparison base...head: commits and changed files with patches (GitHub caps files at 300). */
  async compare(owner: string, repo: string, base: string, head: string): Promise<CompareResult> {
    for (const r of [base, head]) if (!isValidBranchName(r)) throw new GitHubError(`Invalid ref "${r}".`, 400, "upstream");
    const data = await this.json<{
      status: CompareResult["status"];
      ahead_by: number;
      behind_by: number;
      total_commits: number;
      base_commit: { sha: string };
      merge_base_commit: { sha: string };
      commits: Array<{ sha: string; commit: { message: string; author?: { name?: string; date?: string } } }>;
      files?: Array<{ filename: string; status: CompareFile["status"]; additions: number; deletions: number; patch?: string; previous_filename?: string }>;
    }>(this.api(`/repos/${seg(owner)}/${seg(repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`));
    const headSha = data.commits.length ? data.commits[data.commits.length - 1]!.sha : (await this.getCommit(owner, repo, head)).sha;
    return {
      baseSha: data.base_commit.sha,
      headSha,
      status: data.status,
      aheadBy: data.ahead_by,
      behindBy: data.behind_by,
      totalCommits: data.total_commits,
      commits: data.commits.map((c) => ({ sha: c.sha, message: c.commit.message.split("\n")[0] ?? "", authoredAt: c.commit.author?.date ?? null, author: c.commit.author?.name ?? null })),
      files: (data.files ?? []).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        ...(f.patch ? { patch: f.patch.slice(0, 20_000) } : {}),
        ...(f.previous_filename ? { previousFilename: f.previous_filename } : {}),
      })),
    };
  }

  async getTree(owner: string, repo: string, sha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    assertSha(sha);
    const data = await this.json<{ tree: TreeEntry[]; truncated: boolean }>(
      this.api(`/repos/${seg(owner)}/${seg(repo)}/git/trees/${sha}?recursive=1`),
    );
    return { entries: data.tree.map((e) => ({ path: e.path, type: e.type, size: e.size })), truncated: data.truncated };
  }

  /** Reads one file at an exact commit. raw.githubusercontent.com does not consume REST rate limit. */
  async getFileText(owner: string, repo: string, sha: string, path: string, maxBytes: number): Promise<string> {
    assertSha(sha);
    const encodedPath = path.split("/").map(seg).join("/");
    const res = await this.request(`https://raw.githubusercontent.com/${seg(owner)}/${seg(repo)}/${sha}/${encodedPath}`);
    const bytes = await readCapped(res, maxBytes);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  /** Whether a pull request is still open (null when it no longer exists). */
  async pullRequestState(owner: string, repo: string, number: number): Promise<"open" | "closed" | "merged" | null> {
    try {
      const data = await this.json<{ state: string; merged_at: string | null }>(this.api(`/repos/${seg(owner)}/${seg(repo)}/pulls/${number}`));
      return data.merged_at ? "merged" : data.state === "open" ? "open" : "closed";
    } catch (err) {
      if (err instanceof GitHubError && err.code === "not_found") return null;
      throw err;
    }
  }

  /** Reads one file at an exact commit, or null when it does not exist. */
  async getFileTextIfExists(owner: string, repo: string, sha: string, path: string, maxBytes: number): Promise<string | null> {
    try {
      return await this.getFileText(owner, repo, sha, path, maxBytes);
    } catch (err) {
      if (err instanceof GitHubError && err.code === "not_found") return null;
      throw err;
    }
  }

  /**
   * The first `maxBytes` of a file (front matter, headers), or null when it does not exist. Never
   * fails because the file is larger: it stops reading instead.
   */
  async getFileHead(owner: string, repo: string, sha: string, path: string, maxBytes: number): Promise<string | null> {
    assertSha(sha);
    const encodedPath = path.split("/").map(seg).join("/");
    let res: Response;
    try {
      res = await this.request(`https://raw.githubusercontent.com/${seg(owner)}/${seg(repo)}/${sha}/${encodedPath}`);
    } catch (err) {
      if (err instanceof GitHubError && err.code === "not_found") return null;
      throw err;
    }
    if (!res.body) return "";
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    await reader.cancel().catch(() => {});
    const out = new Uint8Array(Math.min(total, maxBytes));
    let offset = 0;
    for (const c of chunks) {
      const part = c.subarray(0, out.length - offset);
      out.set(part, offset);
      offset += part.byteLength;
      if (offset >= out.length) break;
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(out);
  }

  /**
   * Commits text files on top of a branch's head as one new commit on a new branch, then opens a
   * pull request into that branch. Nothing is pushed to the base branch itself.
   */
  async openPullRequest(
    owner: string,
    repo: string,
    opts: { base: string; branch: string; title: string; body: string; message: string; files: Array<{ path: string; content: string; encoding?: "utf-8" | "base64" }> },
  ): Promise<{ number: number; url: string; branch: string; commitSha: string }> {
    if (!isValidBranchName(opts.base) || !isValidBranchName(opts.branch)) throw new GitHubError("Invalid branch name.", 400, "forbidden");
    const r = `/repos/${seg(owner)}/${seg(repo)}`;
    const head = await this.json<{ object: { sha: string } }>(this.api(`${r}/git/ref/heads/${opts.base.split("/").map(seg).join("/")}`));
    const parent = await this.json<{ tree: { sha: string } }>(this.api(`${r}/git/commits/${head.object.sha}`));
    // Text goes inline in the tree; binary files (images) are uploaded as base64 blobs first.
    const entries = await Promise.all(
      opts.files.map(async (f) => {
        if (f.encoding !== "base64") return { path: f.path, mode: "100644", type: "blob", content: f.content };
        const blob = await this.send<{ sha: string }>("POST", this.api(`${r}/git/blobs`), { content: f.content, encoding: "base64" });
        return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
      }),
    );
    const tree = await this.send<{ sha: string }>("POST", this.api(`${r}/git/trees`), { base_tree: parent.tree.sha, tree: entries });
    const commit = await this.send<{ sha: string }>("POST", this.api(`${r}/git/commits`), { message: opts.message, tree: tree.sha, parents: [head.object.sha] });
    await this.send("POST", this.api(`${r}/git/refs`), { ref: `refs/heads/${opts.branch}`, sha: commit.sha });
    const pr = await this.send<{ number: number; html_url: string }>("POST", this.api(`${r}/pulls`), { title: opts.title, head: opts.branch, base: opts.base, body: opts.body });
    return { number: pr.number, url: pr.html_url, branch: opts.branch, commitSha: commit.sha };
  }

  private api(path: string): string {
    return `https://api.github.com${path}`;
  }

  /** A JSON write to the REST API (no redirects are followed for writes). */
  private async send<T = unknown>(method: "POST" | "PATCH", url: string, body: unknown): Promise<T> {
    const res = await this.request(url, { method, body: JSON.stringify(body) });
    const bytes = await readCapped(res, MAX_JSON_BYTES);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }

  private async json<T>(url: string): Promise<T> {
    const res = await this.request(url);
    const bytes = await readCapped(res, MAX_JSON_BYTES);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }

  private async request(initialUrl: string, write?: { method: "POST" | "PATCH"; body: string }): Promise<Response> {
    let url = initialUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
        throw new GitHubError("Blocked request to a non-GitHub host.", 400, "forbidden");
      }
      const headers: Record<string, string> = { "User-Agent": "GitFill", Accept: "application/vnd.github+json" };
      if (write) headers["Content-Type"] = "application/json";
      // Both hosts need the token for private repositories; raw.githubusercontent.com accepts the same bearer token.
      if (this.token) headers.Authorization = `Bearer ${this.token}`;

      let res: Response;
      try {
        res = await this.fetchImpl(url, { method: write?.method ?? "GET", body: write?.body, headers, redirect: "manual", signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
      } catch (err) {
        if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
          throw new GitHubError("GitHub request timed out.", 504, "timeout");
        }
        throw new GitHubError("Could not reach GitHub.", 502, "upstream");
      }

      if (res.status >= 300 && res.status < 400) {
        if (write) throw new GitHubError("GitHub redirected a write request.", 502, "upstream");
        const location = res.headers.get("location");
        if (!location) throw new GitHubError("GitHub redirect without location.", 502, "upstream");
        url = new URL(location, url).toString();
        continue;
      }
      if (res.ok) return res;
      if (res.status === 401 && this.token) await this.onUnauthorized?.();
      throw write ? await toWriteError(res) : toGitHubError(res);
    }
    throw new GitHubError("Too many redirects from GitHub.", 502, "upstream");
  }
}

function toGitHubError(res: Response): GitHubError {
  if (res.status === 401) return new GitHubError("GitHub rejected the access token. Reconnect your GitHub account in Settings.", 401, "unauthorized");
  if (res.status === 404) return new GitHubError("Repository or file not found, or your GitHub account has no access to it.", 404, "not_found");
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0);
    const when = reset ? ` Resets at ${new Date(reset * 1000).toISOString()}.` : "";
    return new GitHubError(`GitHub API rate limit reached. Connect your GitHub account in Settings to use your own limit (or set GITHUB_TOKEN on the server).${when}`, 429, "rate_limited");
  }
  if (res.status === 403) return new GitHubError("GitHub denied access to this repository. If it is private, connect a GitHub account that can read it.", 403, "forbidden");
  return new GitHubError(`GitHub returned HTTP ${res.status}.`, 502, "upstream");
}

/** Write failures say what GitHub objected to (no push access, branch exists, protected branch). */
async function toWriteError(res: Response): Promise<GitHubError> {
  const detail = await res
    .json()
    .then((d: { message?: string; errors?: Array<{ message?: string }> }) => [d.message, ...(d.errors ?? []).map((e) => e.message)].filter(Boolean).join(": "))
    .catch(() => "");
  if (res.status === 401) return toGitHubError(res);
  if (res.status === 403 || res.status === 404) {
    return new GitHubError(`GitHub did not allow GitFill to write to this repository${detail ? ` (${detail})` : ""}. Your GitHub account needs push access, and the repo scope granted in Settings.`, 403, "forbidden");
  }
  return new GitHubError(`GitHub rejected the change (HTTP ${res.status}${detail ? `: ${detail}` : ""}).`, res.status, "upstream");
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new GitHubError("GitHub response exceeds size limit.", 413, "too_large");
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new GitHubError("GitHub response exceeds size limit.", 413, "too_large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

function assertSha(sha: string): void {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new GitHubError("Invalid commit SHA.", 400, "upstream");
}
