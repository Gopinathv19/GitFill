import { eq, sql } from "drizzle-orm";
import type { ModelCallObserver } from "@/lib/ai/client";
import type { EventHandle, RunRecorder } from "@/lib/agent/recorder";
import { summarize } from "@/lib/agent/recorder";
import type { Database } from "@/lib/db";
import { agentEvents, agentRuns, generationJobs, type JobStatus } from "@/lib/db/schema";

/** Persists every stage change, tool call and model call so the UI shows only real activity. */
export class DbRecorder implements RunRecorder {
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
    const [row] = await this.db
      .insert(agentEvents)
      .values({ runId: this.runId, eventType, name, status: "started", model, inputSummary: summarize(inputSummary) as object })
      .returning({ id: agentEvents.id });
    const finish = async (status: "succeeded" | "failed", outputSummary?: unknown, error?: string) => {
      await this.db
        .update(agentEvents)
        .set({ status, outputSummary: summarize(outputSummary) as object, errorSummary: error?.slice(0, 500), durationMs: Date.now() - started, completedAt: new Date() })
        .where(eq(agentEvents.id, row!.id));
    };
    return { succeed: (o) => finish("succeeded", o), fail: (e, o) => finish("failed", o, e) };
  }

  async addUsage(inputTokens: number, outputTokens: number) {
    await this.db
      .update(agentRuns)
      .set({ inputTokens: sql`${agentRuns.inputTokens} + ${inputTokens}`, outputTokens: sql`${agentRuns.outputTokens} + ${outputTokens}` })
      .where(eq(agentRuns.id, this.runId));
  }

  /** Records each model request as its own event (purpose, model, tokens, latency). */
  modelObserver(): ModelCallObserver {
    return async (e) => {
      await this.db.insert(agentEvents).values({
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
    await this.db
      .update(agentRuns)
      .set({ status, completedAt: new Date(), errorMessage: errorMessage?.slice(0, 1000) })
      .where(eq(agentRuns.id, this.runId));
  }
}
