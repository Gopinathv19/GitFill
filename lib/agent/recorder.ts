import type { JobStatus } from "@/lib/db/schema";

export interface EventHandle {
  succeed(outputSummary?: unknown): Promise<void>;
  fail(error: string, outputSummary?: unknown): Promise<void>;
}

/**
 * Audit sink for everything the pipeline actually does. The DB-backed implementation
 * feeds the UI activity feed; tests use the in-memory one.
 */
export interface RunRecorder {
  setStage(status: JobStatus): Promise<void>;
  start(eventType: "tool" | "model" | "step", name: string, inputSummary?: unknown, model?: string): Promise<EventHandle>;
  addUsage(inputTokens: number, outputTokens: number): Promise<void>;
}

export interface MemoryEvent {
  eventType: string;
  name: string;
  status: "started" | "succeeded" | "failed";
  inputSummary?: unknown;
  outputSummary?: unknown;
  error?: string;
  model?: string;
}

export class MemoryRecorder implements RunRecorder {
  readonly stages: JobStatus[] = [];
  readonly events: MemoryEvent[] = [];
  usage = { inputTokens: 0, outputTokens: 0 };

  async setStage(status: JobStatus) {
    this.stages.push(status);
  }

  async start(eventType: "tool" | "model" | "step", name: string, inputSummary?: unknown, model?: string): Promise<EventHandle> {
    const event: MemoryEvent = { eventType, name, status: "started", inputSummary, model };
    this.events.push(event);
    return {
      succeed: async (outputSummary) => {
        Object.assign(event, { status: "succeeded", outputSummary });
      },
      fail: async (error, outputSummary) => {
        Object.assign(event, { status: "failed", error, outputSummary });
      },
    };
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
