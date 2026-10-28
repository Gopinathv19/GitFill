import { inlineWorkerEnabled } from "@/lib/config/env";
import type { Database } from "@/lib/db";
import { runJob } from "./pipeline";
import { claimNextJob } from "./queue";

const g = globalThis as unknown as { __gitfillInlineWorker?: { running: boolean } };
const state = (g.__gitfillInlineWorker ??= { running: false });

/**
 * Runs pending jobs inside the web process when there is no separate worker (PGlite, or
 * INLINE_WORKER=true). Called after every enqueue; a single drain loop runs at a time.
 */
export function kickInlineWorker(db: Database): boolean {
  if (!inlineWorkerEnabled()) return false;
  if (state.running) return true;
  state.running = true;
  void (async () => {
    try {
      for (;;) {
        const job = await claimNextJob(db);
        if (!job) break;
        console.log(`[inline-worker] job ${job.id} (${job.kind}) started`);
        await runJob(db, job);
        console.log(`[inline-worker] job ${job.id} finished`);
      }
    } catch (err) {
      console.error("[inline-worker] stopped:", err instanceof Error ? err.message : err);
    } finally {
      state.running = false;
    }
  })();
  return true;
}
