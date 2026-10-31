import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "@/lib/config/env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

interface Instance {
  db: Database;
  close: () => Promise<void>;
}

// Kept on globalThis so dev hot-reloads and separate route bundles share one pool.
const g = globalThis as unknown as { __gitfillDb?: Instance };

/**
 * Shared database handle. `postgresql://…` (Neon or any Postgres) is the real target.
 * `pglite:<dir>` is an embedded, single-process Postgres for clicking through the UI
 * locally without a server; it can't be shared with the worker process.
 */
export function getDb(): Database {
  if (!g.__gitfillDb) {
    const url = requireEnv("DATABASE_URL");
    if (url.startsWith("pglite:")) {
      g.__gitfillDb = createPglite(url.slice("pglite:".length) || "./storage/pglite");
    } else {
      // Neon's pooled endpoint (PgBouncer, transaction mode) does not support named prepared
      // statements; disabling them also means a running server survives schema changes
      // (no "cached plan" errors after a migration or reset).
      const pooled = /-pooler\./.test(url);
      // Opening a connection (TLS + auth, ~2s to a distant region) costs far more than a query,
      // so idle connections are kept for a few minutes instead of being reopened per request.
      const sql = postgres(url, { max: 5, idle_timeout: 300, connect_timeout: 15, prepare: !pooled });
      g.__gitfillDb = { db: drizzle(sql, { schema }), close: () => sql.end({ timeout: 5 }) };
    }
  }
  return g.__gitfillDb.db;
}

function createPglite(dir: string): Instance {
  // Loaded lazily so production bundles never pull in the WASM build.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle: drizzlePglite } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
  const client = new PGlite(dir);
  // Same query-builder API; only raw execute() results differ (see rowsOf).
  return { db: drizzlePglite(client, { schema }) as unknown as Database, close: () => client.close() };
}

/** Normalizes raw `db.execute` results across drivers (postgres-js returns rows, PGlite returns { rows }). */
export function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

export async function closeDb(): Promise<void> {
  if (g.__gitfillDb) {
    await g.__gitfillDb.close();
    g.__gitfillDb = undefined;
  }
}

export { schema };
