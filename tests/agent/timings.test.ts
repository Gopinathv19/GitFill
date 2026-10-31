import { describe, expect, it } from "vitest";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { formatTimings, summarizeTimings } from "@/lib/agent/timings";

describe("timings", () => {
  it("aggregates steps, model calls and tool calls", async () => {
    const recorder = new MemoryRecorder();
    const step = await recorder.start("step", "snapshot");
    await step.succeed({ cache: "hit" });
    const tool = await recorder.start("tool", "read_file", { path: "a.ts" });
    await tool.fail("No such file");
    const observe = recorder.modelObserver();
    await observe({ purpose: "explain_code:turn1", model: "m", usage: { inputTokens: 40_000, outputTokens: 500 }, durationMs: 1200 });
    await observe({ purpose: "explain_code:turn2", model: "m", usage: { inputTokens: 42_000, outputTokens: 900 }, durationMs: 3000 });

    const s = summarizeTimings(recorder, 5000);
    expect(s.totalMs).toBe(5000);
    expect(s.steps).toHaveProperty("snapshot");
    expect(s.model).toMatchObject({ calls: 2, ms: 4200, inputTokens: 82_000, outputTokens: 1400, slowestMs: 3000 });
    expect(s.tools).toMatchObject({ calls: 1, failed: 1, byName: { read_file: 1 } });

    const text = formatTimings(recorder, "Q1", 5000);
    expect(text).toContain("5.00s total");
    expect(text).toContain("snapshot — cache=hit");
    expect(text).toContain("explain_code:turn2 (42000 in / 900 out)");
    expect(text).toContain("FAILED: No such file");
  });
});
