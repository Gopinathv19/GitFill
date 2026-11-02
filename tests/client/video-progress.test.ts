import { describe, expect, it } from "vitest";
import type { JobEvent } from "@/components/jobs/activity-timeline";
import { videoStills } from "@/lib/client/video-progress";

const ev = (name: string, status: JobEvent["status"], output: unknown): JobEvent => ({ id: name + Math.random(), type: "tool", name, status, model: null, input: null, output, error: null, durationMs: null });

describe("videoStills", () => {
  it("collects previewed frames and thumbnails in order, skipping failed and unrelated events", () => {
    const stills = videoStills({
      events: [
        ev("write_video", "succeeded", { version: 1 }),
        ev("preview_video", "succeeded", { version: 1, stills: [{ t: 3, file: "stills/v1/t0003.0.png", score: 7 }, { t: 12, file: "stills/v1/t0012.0.png", score: null }] }),
        ev("preview_video", "failed", null),
        ev("preview_thumbnail", "succeeded", { version: 2, stills: [{ file: "stills/thumbnail-v2.png", score: 9 }] }),
      ],
    });
    expect(stills).toEqual([
      { file: "stills/v1/t0003.0.png", t: 3, version: 1, thumbnail: false, score: 7 },
      { file: "stills/v1/t0012.0.png", t: 12, version: 1, thumbnail: false, score: null },
      { file: "stills/thumbnail-v2.png", t: null, version: 2, thumbnail: true, score: 9 },
    ]);
  });
});
