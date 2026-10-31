import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { ModelCallObserver } from "@/lib/ai/client";
import type { EventHandle, RunRecorder } from "@/lib/agent/recorder";
import { summarize } from "@/lib/agent/recorder";
import type { Database } from "@/lib/db";
import { agentEvents, agentRuns, generationJobs, type JobStatus } from "@/lib/db/schema";

type EventRow = typeof agentEvents.$inferInsert & { id: string };

/** How long events wait in memory before being written (the UI activity feed lags by at most this). */
const FLUSH_DELAY_MS = 750;

/**
 * Persists every stage change, tool call and model call so the UI shows only real activity.
 * Events and token usage are buffered and written in batches (one upsert per flush) instead of
 * two awaited round trips per event, which cost ~0.5s per tool call against a remote database.
 */
export class DbRecorder implements RunRecorder {
  private readonly dirty = new Map<string, EventRow>();
  private usage = { input: 0, output: 0 };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Database,
    readonly jobId: string,
    readonly runId: string,
  ) {}

  static async create(db: Database, jobId: string, modelIdentifier: string): Promise<DbRecorder> {
    const [run] = await db.insert(agentRuns).values({ jobId, modelIdentifier }).returning({ id: agentRuns.id });
    return new DbRecorder(db, jobId, run!.id);
  }

  async setStage(status: JobStatus) {
    // Refreshing locked_at doubles as a heartbeat for stale-job detection.
    await this.db.update(generationJobs).set({ status, lockedAt: new Date() }).where(eq(generationJobs.id, this.jobId));
  }

  async start(eventType: "tool" | "model" | "step", name: string, inputSummary?: unknown, model?: string): Promise<EventHandle> {
    const started = Date.now();
    const row: EventRow = { id: randomUUID(), runId: this.runId, eventType, name, status: "started", model, inputSummary: summarize(inputSummary) as object, startedAt: new Date(started) };
    this.mark(row);
    const finish = async (status: "succeeded" | "failed", outputSummary?: unknown, error?: string) => {
      Object.assign(row, { status, outputSummary: summarize(outputSummary) as object, errorSummary: error?.slice(0, 500), durationMs: Date.now() - started, completedAt: new Date() });
      this.mark(row);
    };
    return { succeed: (o) => finish("succeeded", o), fail: (e, o) => finish("failed", o, e) };
  }

  async addUsage(inputTokens: number, outputTokens: number) {
    this.usage.input += inputTokens;
    this.usage.output += outputTokens;
    this.schedule();
  }

  /** Records each model request as its own event (purpose, model, tokens, latency). */
  modelObserver(): ModelCallObserver {
    return (e) => {
      this.mark({
        id: randomUUID(),
        runId: this.runId,
        eventType: "model",
        name: e.purpose,
        model: e.model,
        status: e.error ? "failed" : "succeeded",
        outputSummary: { inputTokens: e.usage.inputTokens, outputTokens: e.usage.outputTokens },
        errorSummary: e.error?.slice(0, 500),
        durationMs: e.durationMs,
        startedAt: new Date(Date.now() - e.durationMs),
        completedAt: new Date(),
      });
    };
  }

  async finish(status: "completed" | "failed", errorMessage?: string) {
    await this.flush();
    await this.db
      .update(agentRuns)
      .set({ status, completedAt: new Date(), errorMessage: errorMessage?.slice(0, 1000) })
      .where(eq(agentRuns.id, this.runId));
  }

  /** Writes everything buffered so far. Flushes run one at a time so rows land in order. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.writes = this.writes.then(() => this.write());
    return this.writes;
  }

  private mark(row: EventRow) {
    this.dirty.set(row.id, row);
    this.schedule();
  }

  private schedule() {
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
  }

  private async write(): Promise<void> {
    const rows = [...this.dirty.values()].map((r) => ({ ...r }));
    this.dirty.clear();
    const usage = this.usage;
    this.usage = { input: 0, output: 0 };
    try {
      await Promise.all([
        rows.length
          ? this.db
              .insert(agentEvents)
              .values(rows)
              .onConflictDoUpdate({
                target: agentEvents.id,
                set: {
                  status: sql`excluded.status`,
                  outputSummary: sql`excluded.output_summary`,
                  errorSummary: sql`excluded.error_summary`,
                  durationMs: sql`excluded.duration_ms`,
                  completedAt: sql`excluded.completed_at`,
                },
              })
          : undefined,
        usage.input || usage.output
          ? this.db
              .update(agentRuns)
              .set({ inputTokens: sql`${agentRuns.inputTokens} + ${usage.input}`, outputTokens: sql`${agentRuns.outputTokens} + ${usage.output}` })
              .where(eq(agentRuns.id, this.runId))
          : undefined,
      ]);
    } catch (err) {
      // The audit trail must never fail the job itself.
      console.error("agent event flush failed:", err instanceof Error ? err.message : err);
    }
  }
}
