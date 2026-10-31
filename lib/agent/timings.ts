import { env } from "@/lib/config/env";
import type { MemoryEvent, MemoryRecorder } from "./recorder";

export interface TimingSummary {
  totalMs: number;
  /** Duration of each named step (summed if a step ran more than once). */
  steps: Record<string, number>;
  model: { calls: number; ms: number; inputTokens: number; outputTokens: number; slowestMs: number };
  tools: { calls: number; ms: number; failed: number; byName: Record<string, number> };
}

/** Aggregates a recorder's timed events into per-phase numbers for logs and benchmarks. */
export function summarizeTimings(recorder: MemoryRecorder, totalMs = Date.now() - recorder.createdAt): TimingSummary {
  const steps: Record<string, number> = {};
  const model = { calls: 0, ms: 0, inputTokens: 0, outputTokens: 0, slowestMs: 0 };
  const tools = { calls: 0, ms: 0, failed: 0, byName: {} as Record<string, number> };
  for (const e of recorder.events) {
    const ms = e.durationMs ?? 0;
    if (e.eventType === "step") steps[e.name] = (steps[e.name] ?? 0) + ms;
    else if (e.eventType === "model") {
      const usage = e.outputSummary as { inputTokens?: number; outputTokens?: number } | undefined;
      model.calls++;
      model.ms += ms;
      model.inputTokens += usage?.inputTokens ?? 0;
      model.outputTokens += usage?.outputTokens ?? 0;
      model.slowestMs = Math.max(model.slowestMs, ms);
    } else {
      tools.calls++;
      tools.ms += ms;
      if (e.status === "failed") tools.failed++;
      tools.byName[e.name] = (tools.byName[e.name] ?? 0) + 1;
    }
  }
  return { totalMs, steps, model, tools };
}

/** Human-readable timeline: every event with its start offset and duration, then the totals. */
export function formatTimings(recorder: MemoryRecorder, title: string, totalMs?: number): string {
  const summary = summarizeTimings(recorder, totalMs);
  const lines = [`── timings: ${title} — ${secs(summary.totalMs)} total`];
  for (const e of recorder.events) lines.push(`  +${secs(e.offsetMs).padStart(7)}  ${secs(e.durationMs ?? 0).padStart(7)}  ${e.eventType.padEnd(5)} ${label(e)}`);
  const m = summary.model;
  lines.push(
    `  model: ${m.calls} calls, ${secs(m.ms)} (slowest ${secs(m.slowestMs)}), ${m.inputTokens.toLocaleString("en-US")} in / ${m.outputTokens.toLocaleString("en-US")} out tokens`,
    `  tools: ${summary.tools.calls} calls, ${secs(summary.tools.ms)}, ${summary.tools.failed} failed`,
  );
  return lines.join("\n");
}

/** Prints the timeline to the server log when GITFILL_TIMINGS=true. */
export function logTimings(recorder: MemoryRecorder, title: string): void {
  if (env().GITFILL_TIMINGS === "true") console.info(formatTimings(recorder, title));
}

function label(e: MemoryEvent): string {
  const out = e.outputSummary as Record<string, unknown> | undefined;
  if (e.eventType === "model") return `${e.name} (${out?.inputTokens ?? 0} in / ${out?.outputTokens ?? 0} out)${e.error ? ` FAILED: ${e.error}` : ""}`;
  const detail = e.status === "failed" ? `FAILED: ${e.error}` : out && typeof out === "object" && !Array.isArray(out) ? compact(out) : "";
  return `${e.name}${detail ? ` — ${detail}` : ""}`;
}

function compact(value: Record<string, unknown>): string {
  return Object.entries(value)
    .filter(([k, v]) => k !== "content" && (v === null || ["string", "number", "boolean"].includes(typeof v)))
    .slice(0, 6)
    .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, " ").slice(0, 60)}`)
    .join(" ");
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}
