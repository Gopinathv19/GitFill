import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MuseClient } from "@/lib/ai/client";
import { effortFor, modelFor } from "@/lib/ai/models";
import { buildCodeGraph } from "@/lib/analysis/graph";
import { digestFiles, needsDigest, outlineDigest } from "@/lib/agent/digest";
import { MemoryRecorder } from "@/lib/agent/recorder";
import { createRepositoryContext, describeCompressed, describeSnapshot } from "@/lib/agent/repo-tools";
import type { SourceFile, SourceSnapshot } from "@/lib/connectors/types";

const h = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/storage", async (load) => {
  const m = await load<typeof import("@/lib/storage")>();
  let s: InstanceType<typeof m.LocalStorage> | undefined;
  return { ...m, getStorage: () => (s ??= new m.LocalStorage(h.root)) };
});

beforeAll(async () => {
  h.root = await mkdtemp(path.join(tmpdir(), "gitfill-digest-"));
});
afterAll(async () => {
  await rm(h.root, { recursive: true, force: true });
});

function file(p: string, lines: number, category: SourceFile["category"] = "source", seed = p): SourceFile {
  const body = Array.from({ length: lines }, (_, i) => (i === 0 ? `export function ${seed.replace(/\W/g, "_")}() {` : i === lines - 1 ? "}" : `  const v${i} = ${i}; // ${seed}`));
  const content = body.join("\n");
  return { path: p, category, sizeBytes: content.length, content, lineCount: lines };
}

function snapshotOf(files: SourceFile[]): SourceSnapshot {
  return {
    displayName: "acme/app",
    branch: "main",
    version: "abc1234def",
    description: null,
    files,
    inventory: files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes, selected: true })),
    stats: { totalEntries: files.length, selectedFiles: files.length, languages: {} },
    metadata: {},
  } as unknown as SourceSnapshot;
}

/** A reader that digests whatever it is sent, with one point out of range to be dropped. */
function fakeReader(fail = false) {
  const structured = vi.fn(async (req: { messages: Array<{ content: unknown }> }) => {
    if (fail) throw new Error("model down");
    const body = String(req.messages[1]!.content);
    const paths = [...body.matchAll(/path="([^"]+)"/g)].map((m) => m[1]!);
    return {
      data: { files: paths.map((p) => ({ path: p, purpose: `Purpose of ${p}`, keyPoints: [{ text: "Main function", startLine: 1, endLine: 3 }, { text: "Made up", startLine: 900, endLine: 950 }] })) },
      usage: { inputTokens: 100, outputTokens: 20 },
    };
  });
  return { client: { structured } as unknown as MuseClient, structured };
}

describe("light reading tier", () => {
  it("routes reading and describing to the fast model at minimal effort", () => {
    expect(modelFor("reader")).toBe("muse-spark-1.3");
    expect(effortFor("reader")).toBe("minimal");
    expect(effortFor("describer")).toBe("minimal");
    expect(effortFor("reviewer")).toBe("minimal");
    expect(effortFor("analyst")).toBeUndefined();
    process.env.MUSE_MODEL_READER = "muse-spark-1.2";
    process.env.MUSE_EFFORT_READER = "low";
    try {
      expect(modelFor("reader")).toBe("muse-spark-1.2");
      expect(effortFor("reader")).toBe("low");
    } finally {
      delete process.env.MUSE_MODEL_READER;
      delete process.env.MUSE_EFFORT_READER;
    }
  });

  it("digests only large source files", () => {
    expect(needsDigest(file("a.ts", 50))).toBe(false);
    expect(needsDigest(file("package.json", 400, "manifest"))).toBe(false);
    expect(needsDigest(file("README.md", 400, "docs"))).toBe(false);
    expect(needsDigest(file("src/big.ts", 400))).toBe(true);
  });

  it("reads each file once, drops line ranges outside the file, and caches by content", async () => {
    const files = [file("src/a.ts", 300), file("src/b.ts", 200)];
    const graph = buildCodeGraph(snapshotOf(files));
    const first = fakeReader();
    const digests = await digestFiles({ client: first.client, files, graph, recorder: new MemoryRecorder() });
    expect(first.structured).toHaveBeenCalledTimes(1);
    expect(digests.get("src/a.ts")).toMatchObject({ purpose: "Purpose of src/a.ts", points: [{ text: "Main function", startLine: 1, endLine: 3 }], source: "model" });

    const again = fakeReader();
    const cached = await digestFiles({ client: again.client, files, graph, recorder: new MemoryRecorder() });
    expect(again.structured).not.toHaveBeenCalled();
    expect(cached.get("src/b.ts")?.purpose).toBe("Purpose of src/b.ts");
  });

  it("falls back to a static outline when the reader fails", async () => {
    const files = [file("src/c.ts", 300, "source", "fallback")];
    const graph = buildCodeGraph(snapshotOf(files));
    const digests = await digestFiles({ client: fakeReader(true).client, files, graph, recorder: new MemoryRecorder() });
    expect(digests.get("src/c.ts")).toEqual(outlineDigest(files[0]!, graph));
    expect(digests.get("src/c.ts")!.source).toBe("outline");
  });

  it("shows large files as digests and keeps small and key files in full", async () => {
    const files = [file("README.md", 20, "docs"), file("src/small.ts", 30), ...Array.from({ length: 6 }, (_, i) => file(`src/big${i}.ts`, 400, "source", `big${i}`))];
    const ctx = createRepositoryContext(snapshotOf(files), { retriever: null });
    const full = describeSnapshot(ctx, { inlineBudgetChars: 1_000_000 });
    const reader = fakeReader();
    const compressed = await describeCompressed(ctx, { client: reader.client, recorder: new MemoryRecorder(), inlineBudgetChars: 100_000 });
    expect(compressed.digestCount).toBe(6);
    expect(compressed.text).toContain('<file_digest path="src/big0.ts" lines="400">');
    expect(compressed.text).toContain('path="src/small.ts"');
    expect(compressed.text).not.toContain("// big0");
    expect(compressed.text.length).toBeLessThan(full.text.length / 4);
  });

  it("does not digest a repository that fits in full", async () => {
    const files = [file("src/a.ts", 150), file("src/b.ts", 30)];
    const ctx = createRepositoryContext(snapshotOf(files), { retriever: null });
    const reader = fakeReader();
    const out = await describeCompressed(ctx, { client: reader.client, recorder: new MemoryRecorder(), inlineBudgetChars: 110_000 });
    expect(reader.structured).not.toHaveBeenCalled();
    expect(out.digestCount).toBe(0);
  });
});
