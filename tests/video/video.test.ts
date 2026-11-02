import { describe, expect, it, vi } from "vitest";
import { collectVideos } from "@/components/presentation/video-panel";
import { encodeWav, synthesize } from "@/lib/video/music";

vi.mock("@/lib/storage", () => ({ getStorage: () => ({ get: async () => Buffer.from("0123456789") }) }));

describe("artifact ranges", async () => {
  const { artifactResponse } = await import("@/lib/artifact-response");
  const artifact = { storageKey: "k", mimeType: "video/mp4", filename: "v.mp4" } as Parameters<typeof artifactResponse>[0];

  it("serves a byte range with 206 and Content-Range", async () => {
    const res = await artifactResponse(artifact, false, "bytes=2-5");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(await res.text()).toBe("2345");
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline/);
  });

  it("serves open and suffix ranges, and refuses ranges past the end", async () => {
    expect(await (await artifactResponse(artifact, false, "bytes=7-")).text()).toBe("789");
    expect(await (await artifactResponse(artifact, false, "bytes=-2")).text()).toBe("89");
    expect((await artifactResponse(artifact, false, "bytes=20-")).status).toBe(416);
    const full = await artifactResponse(artifact, false);
    expect(full.status).toBe(200);
    expect(full.headers.get("Accept-Ranges")).toBe("bytes");
  });
});

describe("music", () => {
  it("synthesizes normalized stereo audio and encodes a valid WAV", () => {
    const { left, right } = synthesize(4, "calm");
    expect(left.length).toBe(4 * 44_100);
    let peak = 0;
    for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
    expect(peak).toBeLessThanOrEqual(0.7001);
    expect(peak).toBeGreaterThan(0.1);
    const wav = encodeWav(left, right);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.length).toBe(44 + left.length * 4);
  });
});

describe("collectVideos", () => {
  it("pairs each video with its own thumbnail and source, newest first", () => {
    const a = (id: string, type: string, jobId: string, createdAt: string) => ({ id, type, jobId, createdAt });
    const videos = collectVideos([
      { version: 2, artifacts: [a("v2", "video", "j2", "2026-11-02T10:00:00Z"), a("t2", "thumbnail", "j2", "2026-11-02T10:00:00Z"), a("p", "slide_preview", "g", "2026-11-01T00:00:00Z")] },
      { version: 1, artifacts: [a("v1", "video", "j1", "2026-11-01T10:00:00Z"), a("s1", "video_source", "j1", "2026-11-01T10:00:00Z")] },
    ]);
    expect(videos.map((v) => [v.video.id, v.thumbnail?.id, v.source?.id, v.version])).toEqual([
      ["v2", "t2", undefined, 2],
      ["v1", undefined, "s1", 1],
    ]);
  });
});
