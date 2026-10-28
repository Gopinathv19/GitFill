import "dotenv/config";
import { closeDb, getDb } from "@/lib/db";

/** Applies version-controlled migrations from lib/db/migrations (Postgres or local PGlite). */
async function main() {
  const db = getDb();
  const migrationsFolder = "lib/db/migrations";
  if (process.env.DATABASE_URL?.startsWith("pglite:")) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(db, { migrationsFolder });
  }
  console.log("Migrations applied.");
  await closeDb();
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
