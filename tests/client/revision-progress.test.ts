import { describe, expect, it } from "vitest";
import type { JobEvent } from "@/components/jobs/activity-timeline";
import { revisionProgress } from "@/lib/client/revision-progress";

let n = 0;
const ev = (name: string, status: JobEvent["status"], input: unknown = null, output: unknown = null): JobEvent => ({ id: String(n++), type: "step", name, status, model: null, input, output, error: null, durationMs: null });

describe("revisionProgress", () => {
  it("marks planned targets as being rewritten before anything renders", () => {
    const p = revisionProgress({ events: [ev("plan_revision", "succeeded", null, { targets: ["s2"] }), ev("compose_slide", "started", { slide: "s9" })] });
    expect(p.render).toBeNull();
    expect([...p.busy].sort()).toEqual(["s2", "s9"]);
  });

  it("shows the newest render round and only slides still being repaired", () => {
    const p = revisionProgress({
      events: [
        ev("plan_revision", "succeeded", null, { targets: ["s2"] }),
        ev("compose_slide", "succeeded", { slide: "s2" }),
        ev("render_slides", "succeeded", { round: 0 }, { round: 0, pages: 3, slideIds: ["s1", "s2", "s3"] }),
        ev("repair_slide", "started", { slide: "s3" }),
        ev("render_slides", "succeeded", { round: 1 }, { round: 1, pages: 3, slideIds: ["s1", "s2", "s3"] }),
        ev("repair_slide", "started", { slide: "s1" }),
      ],
    });
    expect(p.render).toEqual({ round: 1, slideIds: ["s1", "s2", "s3"] });
    expect([...p.busy]).toEqual(["s1"]);
  });

  it("ignores render events from before slide ids were recorded", () => {
    expect(revisionProgress({ events: [ev("render_slides", "succeeded", null, { pages: 3 })] }).render).toBeNull();
  });
});
