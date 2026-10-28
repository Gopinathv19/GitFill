import "dotenv/config";
import { closeDb, getDb } from "@/lib/db";
import { runJob } from "@/lib/jobs/pipeline";
import { claimNextJob, failStaleJobs } from "@/lib/jobs/queue";

/**
 * Background worker: polls Postgres for pending jobs and runs them one at a time.
 * Runs from the same codebase as the web app (`npm run worker`).
 */
const POLL_MS = 2000;
let stopping = false;

async function main() {
  const db = getDb();
  const stale = await failStaleJobs(db);
  if (stale.length) console.log(`[worker] marked ${stale.length} abandoned job(s) as failed`);
  console.log("[worker] ready, polling for jobs");

  while (!stopping) {
    const job = await claimNextJob(db).catch((err) => {
      console.error("[worker] poll failed:", err instanceof Error ? err.message : err);
      return undefined;
    });
    if (!job) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      continue;
    }
    const started = Date.now();
    console.log(`[worker] job ${job.id} (${job.kind}) started`);
    await runJob(db, job);
    console.log(`[worker] job ${job.id} finished in ${Math.round((Date.now() - started) / 1000)}s`);
  }
  await closeDb();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[worker] ${signal} received, finishing current job then exiting`);
    stopping = true;
  });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
