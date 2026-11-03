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
      // Prepared statements: without them every query with parameters costs two round trips
      // (the driver first asks Postgres for the parameter types), measured 458 ms vs 229 ms to
      // Neon. Neon's pooler supports them. After a migration, restart the server so cached plans
      // are rebuilt (the deploy restarts web and worker after `migrate` anyway).
      // DATABASE_PREPARE=false turns them off for a pooler that cannot handle them.
      const prepare = process.env.DATABASE_PREPARE !== "false";
      // Opening a connection (TLS + auth, ~2s to a distant region) costs far more than a query,
      // so idle connections are kept for a few minutes instead of being reopened per request.
      const sql = postgres(url, { max: 10, idle_timeout: 300, connect_timeout: 15, prepare });
      g.__gitfillDb = { db: drizzle(prepare ? preparedByDefault(sql) : sql, { schema }), close: () => sql.end({ timeout: 5 }) };
    }
  }
  return g.__gitfillDb.db;
}

/**
 * Drizzle calls `unsafe(query, params, { prepare: false })` for every ordinary query, which
 * overrides the client's `prepare` setting, so postgres.js describes each parameterised query in an
 * extra round trip. This client prepares them instead: one round trip once a statement is cached
 * on a connection. Only the top-level client is wrapped; transactions keep Drizzle's behaviour.
 */
function preparedByDefault(sql: postgres.Sql): postgres.Sql {
  const unsafe = sql.unsafe.bind(sql);
  return new Proxy(sql, {
    get(target, prop, receiver) {
      if (prop === "unsafe") return (query: string, params?: unknown[], options?: { prepare?: boolean }) => unsafe(query, params as never, { ...options, prepare: true });
      return Reflect.get(target, prop, receiver);
    },
  });
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
