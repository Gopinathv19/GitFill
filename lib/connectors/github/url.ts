export interface GitHubRepoRef {
  owner: string;
  repo: string;
  /** Branch from a /tree/<branch> URL, if present. */
  branch?: string;
}

export class InvalidRepositoryUrlError extends Error {
  override name = "InvalidRepositoryUrlError";
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,200}$/;

/**
 * Parses a public GitHub repository URL. Only https://github.com URLs (or "owner/repo"
 * shorthand) are accepted, so the result can never point the server at another host.
 */
export function parseGitHubUrl(input: string): GitHubRepoRef {
  const raw = input.trim();
  if (!raw) throw new InvalidRepositoryUrlError("Repository URL is required.");
  if (raw.length > 500) throw new InvalidRepositoryUrlError("Repository URL is too long.");
  // Reject dot-segments before URL parsing normalizes them into a different path.
  if (/(^|\/|%2f)\.{1,2}(\/|%2f|$)/i.test(raw.replace(/^https?:\/\//, ""))) {
    throw new InvalidRepositoryUrlError("Repository URL must not contain '.' or '..' path segments.");
  }

  let segments: string[];
  if (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(raw)) {
    segments = raw.split("/");
  } else {
    let url: URL;
    try {
      url = new URL(raw.startsWith("github.com/") ? `https://${raw}` : raw);
    } catch {
      throw new InvalidRepositoryUrlError("Enter a URL like https://github.com/owner/repo.");
    }
    if (url.protocol !== "https:") throw new InvalidRepositoryUrlError("Only https:// GitHub URLs are supported.");
    if (url.username || url.password) throw new InvalidRepositoryUrlError("URLs containing credentials are not allowed.");
    if (url.port) throw new InvalidRepositoryUrlError("URLs with a custom port are not supported.");
    const host = url.hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") {
      throw new InvalidRepositoryUrlError("Only github.com repositories are supported.");
    }
    segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  }

  if (segments.length < 2) throw new InvalidRepositoryUrlError("URL must include both owner and repository name.");
  const owner = segments[0]!;
  const repo = segments[1]!.replace(/\.git$/, "");

  if (!OWNER_RE.test(owner)) throw new InvalidRepositoryUrlError(`Invalid GitHub owner "${owner}".`);
  if (!REPO_RE.test(repo) || repo === "." || repo === "..") {
    throw new InvalidRepositoryUrlError(`Invalid repository name "${repo}".`);
  }

  let branch: string | undefined;
  if (segments.length > 2) {
    if (segments[2] !== "tree" || segments.length < 4) {
      throw new InvalidRepositoryUrlError("Use the repository root URL or a /tree/<branch> URL.");
    }
    branch = segments.slice(3).join("/");
    if (!isValidBranchName(branch)) throw new InvalidRepositoryUrlError(`Invalid branch "${branch}".`);
  }

  return { owner, repo, ...(branch ? { branch } : {}) };
}

export function isValidBranchName(branch: string): boolean {
  return BRANCH_RE.test(branch) && !branch.includes("..") && !branch.startsWith("/") && !branch.endsWith("/");
}

export function canonicalRepoUrl(ref: Pick<GitHubRepoRef, "owner" | "repo">): string {
  return `https://github.com/${ref.owner}/${ref.repo}`;
}
