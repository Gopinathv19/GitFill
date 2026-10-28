import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { apiTokens, users } from "@/lib/db/schema";
import type { SessionUser } from "./session";

/**
 * Personal API tokens for the VS Code extension. The token is shown once; only its
 * SHA-256 hash is stored, and lookups are by hash.
 */
const PREFIX = "gf_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createApiToken(db: Database, userId: string, name: string) {
  const token = `${PREFIX}${randomBytes(24).toString("hex")}`;
  const [row] = await db.insert(apiTokens).values({ userId, name: name.slice(0, 80), tokenHash: hashToken(token), prefix: token.slice(0, 10) }).returning();
  return { token, id: row!.id, name: row!.name, prefix: row!.prefix, createdAt: row!.createdAt };
}

export async function listApiTokens(db: Database, userId: string) {
  const rows = await db.select().from(apiTokens).where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt))).orderBy(desc(apiTokens.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt }));
}

export async function revokeApiToken(db: Database, userId: string, id: string): Promise<boolean> {
  const rows = await db.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt))).returning({ id: apiTokens.id });
  return rows.length > 0;
}

/** Resolves "Authorization: Bearer gf_…" to a user, or null. */
export async function authenticateApiToken(db: Database, authorization: string | null): Promise<SessionUser | null> {
  const m = /^Bearer\s+(gf_[0-9a-f]{48})$/i.exec(authorization ?? "");
  if (!m) return null;
  const hash = hashToken(m[1]!);
  const row = (
    await db
      .select({ tokenId: apiTokens.id, user: users })
      .from(apiTokens)
      .innerJoin(users, eq(apiTokens.userId, users.id))
      .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)))
  )[0];
  if (!row) return null;
  void db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.tokenId)).catch(() => undefined);
  return { id: row.user.id, login: row.user.login, name: row.user.name, avatarUrl: row.user.avatarUrl };
}
