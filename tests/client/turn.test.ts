import { describe, expect, it } from "vitest";
import type { Activity } from "@/lib/client/activity";
import { finishTurn, newTurn, reduceTurn, stepCount, type Turn, type TurnEvent } from "@/lib/client/turn";

const act = (id: string, name: string, status: Activity["status"], extra: Partial<Activity> = {}): TurnEvent => ({ event: "activity", data: { id, kind: name === "thinking" ? "step" : "tool", name, status, ...extra } });

function run(events: TurnEvent[]): Turn {
  return events.reduce((t, e, i) => reduceTurn(t, e, 1000 * (i + 1)), newTurn(0));
}

describe("turn timeline", () => {
  it("reads Thought → narration → Worked → answer, as the server streams it", () => {
    const t = run([
      act("t1", "thinking", "started"),
      { event: "text", delta: "Checking the auth " },
      { event: "text", delta: "code first." },
      act("t1", "thinking", "succeeded"),
      { event: "text_reset" },
      act("a1", "read_file", "started", { input: { path: "a.py" } }),
      act("a1", "read_file", "succeeded", { output: { lines: 40 } }),
      act("t2", "thinking", "started"),
      act("t2", "thinking", "succeeded"),
      act("a2", "grep", "succeeded", { input: { pattern: "jwt" } }),
      act("t3", "thinking", "started"),
      { event: "text", delta: "Sessions use cookies." },
    ]);
    expect(t.segments.map((s) => s.kind)).toEqual(["thought", "narration", "work"]);
    expect(t.segments[1]).toMatchObject({ text: "Checking the auth code first." });
    const work = t.segments[2]!;
    if (work.kind !== "work") throw new Error("expected work");
    // Short thinking between tool calls stays inside the work group.
    expect(work.items.map((i) => (i.kind === "step" ? i.activity.name : "thought"))).toEqual(["read_file", "thought", "grep", "thought"]);
    // Updates merge into the same step, keeping the input from the start event.
    expect(work.items[0]).toMatchObject({ activity: { status: "succeeded", input: { path: "a.py" }, output: { lines: 40 } } });
    expect(t.draft).toBe("Sessions use cookies.");
    expect(stepCount(t)).toBe(2);
  });

  it("skips internal steps and closes everything when the turn finishes", () => {
    const t = finishTurn(run([act("t1", "thinking", "started"), act("r", "reply", "succeeded"), act("a1", "read_file", "started")]), 99_000);
    expect(t.segments.map((s) => s.kind)).toEqual(["thought", "work"]);
    expect(t.segments.every((s) => s.kind === "narration" || s.endedAt !== null)).toBe(true);
  });
});
