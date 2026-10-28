import "dotenv/config";
import postgres from "postgres";

/**
 * Destructive: drops every table in the public schema of DATABASE_URL and recreates the
 * schema. Run `npm run db:migrate` afterwards. Refuses to run without `--yes`.
 */
async function main() {
  if (!process.argv.includes("--yes")) throw new Error("This deletes all data. Re-run with --yes to confirm.");
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("postgres")) throw new Error("DATABASE_URL must be a Postgres URL (for pglite: delete the storage directory instead).");
  const sql = postgres(url, { max: 1 });
  const before = await sql`select tablename from pg_tables where schemaname = 'public' order by 1`;
  console.log("tables before:", before.map((r) => r.tablename).join(", ") || "(none)");
  // Drizzle records applied migrations in its own "drizzle" schema; drop it too, or the
  // migrator believes everything is already applied and recreates nothing.
  await sql.unsafe("drop schema public cascade; create schema public; drop schema if exists drizzle cascade;");
  const after = await sql`select count(*)::int as n from pg_tables where schemaname = 'public'`;
  console.log("tables after wipe:", after[0]!.n);
  await sql.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
