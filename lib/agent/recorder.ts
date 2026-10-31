import type { ModelCallObserver } from "@/lib/ai/client";
import type { JobStatus } from "@/lib/db/schema";

export interface EventHandle {
  succeed(outputSummary?: unknown): Promise<void>;
  fail(error: string, outputSummary?: unknown): Promise<void>;
}

/** Live progress for streaming clients: activity as it happens and the answer text as it is written. */
export type LiveEvent =
  | { type: "activity"; id: string; kind: "tool" | "step"; name: string; status: "started" | "succeeded" | "failed"; input?: unknown; output?: unknown; error?: string; durationMs?: number }
  | { type: "text"; delta: string }
  /** Text streamed so far was the model thinking aloud before calling tools, not the answer. */
  | { type: "text_reset" };

/**
 * Audit sink for everything the pipeline actually does. The DB-backed implementation
 * feeds the UI activity feed; tests use the in-memory one.
 */
export interface RunRecorder {
  setStage(status: JobStatus): Promise<void>;
  start(eventType: "tool" | "model" | "step", name: string, inputSummary?: unknown, model?: string): Promise<EventHandle>;
  addUsage(inputTokens: number, outputTokens: number): Promise<void>;
  /** Set when a client is watching live (see LiveEvent). */
  live?: (event: LiveEvent) => void;
}

export interface MemoryEvent {
  eventType: string;
  name: string;
  status: "started" | "succeeded" | "failed";
  inputSummary?: unknown;
  outputSummary?: unknown;
  error?: string;
  model?: string;
  /** Milliseconds since the recorder was created. */
  offsetMs: number;
  durationMs?: number;
}

export class MemoryRecorder implements RunRecorder {
  readonly stages: JobStatus[] = [];
  readonly events: MemoryEvent[] = [];
  usage = { inputTokens: 0, outputTokens: 0 };
  readonly createdAt = Date.now();
  private nextId = 0;

  constructor(readonly live?: (event: LiveEvent) => void) {}

  async setStage(status: JobStatus) {
    this.stages.push(status);
  }

  async start(eventType: "tool" | "model" | "step", name: string, inputSummary?: unknown, model?: string): Promise<EventHandle> {
    const started = Date.now();
    const event: MemoryEvent = { eventType, name, status: "started", inputSummary, model, offsetMs: started - this.createdAt };
    this.events.push(event);
    const id = `a${++this.nextId}`;
    const kind = eventType === "step" ? "step" : "tool";
    this.emit({ type: "activity", id, kind, name, status: "started", input: summarize(inputSummary) });
    return {
      succeed: async (outputSummary) => {
        Object.assign(event, { status: "succeeded", outputSummary, durationMs: Date.now() - started });
        this.emit({ type: "activity", id, kind, name, status: "succeeded", output: summarize(outputSummary), durationMs: event.durationMs });
      },
      fail: async (error, outputSummary) => {
        Object.assign(event, { status: "failed", error, outputSummary, durationMs: Date.now() - started });
        this.emit({ type: "activity", id, kind, name, status: "failed", error, durationMs: event.durationMs });
      },
    };
  }

  /** Records each model request as its own timed event, like DbRecorder.modelObserver. */
  modelObserver(): ModelCallObserver {
    return (e) => {
      this.events.push({
        eventType: "model",
        name: e.purpose,
        model: e.model,
        status: e.error ? "failed" : "succeeded",
        outputSummary: { inputTokens: e.usage.inputTokens, outputTokens: e.usage.outputTokens },
        error: e.error,
        offsetMs: Date.now() - e.durationMs - this.createdAt,
        durationMs: e.durationMs,
      });
    };
  }

  /** A watcher that disconnects or throws never affects the run. */
  private emit(event: LiveEvent) {
    try {
      this.live?.(event);
    } catch {
      // ignore
    }
  }

  async addUsage(inputTokens: number, outputTokens: number) {
    this.usage.inputTokens += inputTokens;
    this.usage.outputTokens += outputTokens;
  }
}

/** Truncates arbitrary values into small JSON-safe summaries for storage and display. */
export function summarize(value: unknown, maxString = 240, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > maxString ? `${value.slice(0, maxString)}…` : value;
  if (typeof value !== "object") return value;
  if (depth > 3) return "[…]";
  if (Array.isArray(value)) {
    const head = value.slice(0, 8).map((v) => summarize(v, maxString, depth + 1));
    return value.length > 8 ? [...head, `…${value.length - 8} more`] : head;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value).slice(0, 20)) out[k] = summarize(v, maxString, depth + 1);
  return out;
}
