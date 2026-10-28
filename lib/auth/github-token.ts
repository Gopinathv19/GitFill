import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { env } from "@/lib/config/env";
import { GitHubClient } from "@/lib/connectors/github/client";
import type { Database } from "@/lib/db";
import { generationJobs, projects, users, workspaces } from "@/lib/db/schema";

/**
 * Per-user GitHub access. Each user's OAuth token is encrypted at rest with AES-256-GCM
 * and only ever decrypted to build a GitHubClient for that user's own requests, so
 * repositories are read with the user's permissions and rate limit, never a shared token.
 */
const ALGO = "aes-256-gcm";
const VERSION = "v1";

function key(): Buffer {
  const e = env();
  const secret = e.TOKEN_ENCRYPTION_KEY ?? e.AUTH_SECRET;
  if (!secret) {
    if (e.NODE_ENV === "production") throw new Error("TOKEN_ENCRYPTION_KEY (or AUTH_SECRET) must be set to store GitHub tokens.");
    return createHash("sha256").update("gitfill-development-only-token-key").digest();
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, data] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !data) throw new Error("Unrecognized encrypted token format.");
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export interface GitHubConnection {
  connected: boolean;
  login: string | null;
  scopes: string[];
  /** True when the granted scopes include private repository access. */
  privateAccess: boolean;
  connectedAt: Date | null;
}

export async function storeGitHubToken(db: Database, userId: string, token: string, scopes: string[], login: string): Promise<void> {
  await db
    .update(users)
    .set({ githubTokenEncrypted: encryptSecret(token), githubTokenScopes: scopes.join(","), githubTokenLogin: login, githubConnectedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function clearGitHubToken(db: Database, userId: string): Promise<void> {
  await db.update(users).set({ githubTokenEncrypted: null, githubTokenScopes: null, githubTokenLogin: null, githubConnectedAt: null }).where(eq(users.id, userId));
}

export async function getGitHubConnection(db: Database, userId: string): Promise<GitHubConnection> {
  const row = (await db.select({ scopes: users.githubTokenScopes, login: users.githubTokenLogin, at: users.githubConnectedAt, has: users.githubTokenEncrypted }).from(users).where(eq(users.id, userId)))[0];
  const scopes = row?.scopes ? row.scopes.split(",").filter(Boolean) : [];
  return { connected: Boolean(row?.has), login: row?.login ?? null, scopes, privateAccess: scopes.includes("repo"), connectedAt: row?.at ?? null };
}

/** The user's own GitHub token, or null when GitHub is not connected (or the ciphertext cannot be read). */
export async function getGitHubToken(db: Database, userId: string): Promise<string | null> {
  const row = (await db.select({ enc: users.githubTokenEncrypted }).from(users).where(eq(users.id, userId)))[0];
  if (!row?.enc) return null;
  try {
    return decryptSecret(row.enc);
  } catch (err) {
    console.error(`[github] could not decrypt token for user ${userId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * GitHub client acting as the user. Falls back to the server's GITHUB_TOKEN (public
 * repositories only) when the user has not connected GitHub.
 */
export async function githubClientFor(db: Database, userId: string): Promise<GitHubClient> {
  const token = await getGitHubToken(db, userId);
  const client = new GitHubClient(token ?? env().GITHUB_TOKEN);
  if (token) {
    // A revoked or expired token is cleared so the UI asks the user to reconnect instead of failing silently.
    client.onUnauthorized = () => clearGitHubToken(db, userId).catch(() => undefined);
  }
  return client;
}

/** Background jobs act as the owner of the workspace the job belongs to. */
export async function githubClientForJob(db: Database, job: Pick<typeof generationJobs.$inferSelect, "projectId">): Promise<GitHubClient> {
  const row = (
    await db
      .select({ ownerId: workspaces.ownerId })
      .from(projects)
      .innerJoin(workspaces, eq(projects.workspaceId, workspaces.id))
      .where(eq(projects.id, job.projectId))
  )[0];
  return row ? githubClientFor(db, row.ownerId) : new GitHubClient(env().GITHUB_TOKEN);
}
