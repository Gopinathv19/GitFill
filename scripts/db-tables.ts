import "dotenv/config";
import postgres from "postgres";

/** Lists the tables in DATABASE_URL and how many migrations Drizzle has recorded. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("postgres")) throw new Error("DATABASE_URL must be a Postgres URL.");
  const sql = postgres(url, { max: 1 });
  const tables = await sql`select tablename from pg_tables where schemaname = 'public' order by 1`;
  console.log(`tables (${tables.length}):`, tables.map((r) => r.tablename).join(", ") || "(none)");
  const migrations = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`.catch(() => [{ n: 0 }]);
  console.log("migrations recorded:", migrations[0]!.n);
  await sql.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
