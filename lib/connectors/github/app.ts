import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { env } from "@/lib/config/env";
import { GitHubClient } from "./client";

/**
 * GitFill's GitHub App. Pull requests opened with an installation token are authored by the app
 * ("<slug>[bot]"), not by the person who asked for them. Tokens are minted per repository with only
 * the permissions a pull request needs, and cached until shortly before they expire.
 */

export interface GitHubAppConfig {
  id: string;
  privateKey: string;
  slug: string | null;
}

export class AppNotInstalledError extends Error {
  override name = "AppNotInstalledError";
  constructor(
    readonly repository: string,
    readonly installUrl: string | null,
  ) {
    super(`The GitFill GitHub App is not installed on ${repository}.${installUrl ? ` Install it on that repository: ${installUrl}` : " Ask the GitFill operator for the app's install link."}`);
  }
}

export function githubAppConfig(): GitHubAppConfig | null {
  const e = env();
  const key = e.GITHUB_APP_PRIVATE_KEY ?? readKeyFile(e.GITHUB_APP_PRIVATE_KEY_PATH);
  if (!e.GITHUB_APP_ID || !key) return null;
  return { id: e.GITHUB_APP_ID, privateKey: key.replace(/\\n/g, "\n"), slug: e.GITHUB_APP_SLUG ?? null };
}

function readKeyFile(path: string | undefined): string | null {
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.error(`GITHUB_APP_PRIVATE_KEY_PATH: cannot read ${path}`);
    return null;
  }
}

export type GitHubAppStatus =
  | { state: "not_configured" }
  | { state: "invalid_key"; detail: string }
  | { state: "configured"; slug: string | null; botName: string | null; installUrl: string | null };

/**
 * Whether pull requests will be opened by the app, checked locally (the key must sign a JWT).
 * Without the app, they are opened with the signed-in user's own token and show as that user.
 */
export function githubAppStatus(): GitHubAppStatus {
  const cfg = githubAppConfig();
  if (!cfg) return { state: "not_configured" };
  try {
    appJwt(cfg);
  } catch (err) {
    return { state: "invalid_key", detail: err instanceof Error ? err.message.slice(0, 160) : "the private key could not sign" };
  }
  return { state: "configured", slug: cfg.slug, botName: cfg.slug ? `${cfg.slug}[bot]` : null, installUrl: installUrl(cfg) };
}

export function installUrl(cfg: Pick<GitHubAppConfig, "slug">): string | null {
  return cfg.slug ? `https://github.com/apps/${cfg.slug}/installations/new` : null;
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** A 9-minute RS256 JWT that authenticates as the app itself (GitHub allows at most 10). */
export function appJwt(cfg: Pick<GitHubAppConfig, "id" | "privateKey">, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  // Issued a minute in the past to tolerate clock drift between this server and GitHub.
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: cfg.id }));
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(cfg.privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

const cache = new Map<string, { token: string; expiresAt: number }>();

/** A client that acts as the app on one repository, with contents and pull-request write access only. */
export async function appClientFor(owner: string, repo: string, cfg: GitHubAppConfig, fetchImpl: typeof fetch = fetch): Promise<GitHubClient> {
  const key = `${owner}/${repo}`.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAt - Date.now() > 5 * 60_000) return new GitHubClient(hit.token, fetchImpl);
  const asApp = new GitHubClient(appJwt(cfg), fetchImpl);
  const installation = await asApp.getRepoInstallation(owner, repo);
  if (!installation) throw new AppNotInstalledError(`${owner}/${repo}`, installUrl(cfg));
  const { token, expiresAt } = await asApp.createInstallationToken(installation.id, repo, { contents: "write", pull_requests: "write", metadata: "read" });
  cache.set(key, { token, expiresAt: new Date(expiresAt).getTime() });
  return new GitHubClient(token, fetchImpl);
}
