import { describe, expect, it } from "vitest";
import { buildCodeGraph, type CodeGraph } from "@/lib/analysis/graph";
import type { SourceFile } from "@/lib/connectors/types";
import { architectureFacts, dependencyCycles, hotspots } from "@/lib/presentation/facts/architecture";

const file = (path: string, content: string): SourceFile => ({ path, content, category: "source", sizeBytes: content.length, lineCount: content.split("\n").length });

const graphOf = (files: SourceFile[]): CodeGraph => buildCodeGraph({ files, inventory: files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes, selected: true })) });

/** A graph with only file → files edges, for shapes buildCodeGraph never produces (self-imports). */
const handGraph = (edges: Record<string, string[]>): CodeGraph => {
  const dependencies = new Map(Object.entries(edges).map(([from, tos]) => [from, new Set(tos)]));
  return { symbols: [], imports: [], byName: new Map(), byPath: new Map(), dependencies, dependents: new Map(), externalPackages: new Map() };
};

describe("dependencyCycles", () => {
  it("finds a cycle of two TypeScript files with a closed loop", () => {
    const graph = graphOf([file("src/a.ts", "import { b } from './b';\nexport const a = 1;\n"), file("src/b.ts", "import { a } from './a';\nexport const b = 2;\n")]);
    expect(dependencyCycles(graph)).toEqual([{ files: ["src/a.ts", "src/b.ts"], cycle: ["src/a.ts", "src/b.ts", "src/a.ts"] }]);
  });

  it("finds a cycle of three Python modules", () => {
    const graph = graphOf([
      file("app/a.py", "from app.b import x\n"),
      file("app/b.py", "from app.c import y\nx = 1\n"),
      file("app/c.py", "from app.a import z\ny = 2\n"),
      file("app/d.py", "from app.a import z\n"),
    ]);
    const cycles = dependencyCycles(graph);
    expect(cycles).toEqual([{ files: ["app/a.py", "app/b.py", "app/c.py"], cycle: ["app/a.py", "app/b.py", "app/c.py", "app/a.py"] }]);
  });

  it("reports separate cycles largest first, then by first path", () => {
    const graph = graphOf([
      file("x/a.ts", "import './b';\n"),
      file("x/b.ts", "import './a';\n"),
      file("y/a.ts", "import './b';\n"),
      file("y/b.ts", "import './c';\n"),
      file("y/c.ts", "import './a';\n"),
      file("w/a.ts", "import './b';\n"),
      file("w/b.ts", "import './a';\n"),
    ]);
    const cycles = dependencyCycles(graph);
    expect(cycles.map((c) => c.files)).toEqual([["y/a.ts", "y/b.ts", "y/c.ts"], ["w/a.ts", "w/b.ts"], ["x/a.ts", "x/b.ts"]]);
    for (const c of cycles) expect(c.cycle[0]).toBe(c.cycle[c.cycle.length - 1]);
    expect(dependencyCycles(graph, { limit: 2 })).toHaveLength(2);
  });

  it("shows the shortest loop through the first file of a bigger group", () => {
    // a → b → c → d → a, plus a shortcut b → a: the group has 4 files, the shortest loop is a → b → a.
    const graph = handGraph({ "a.ts": ["b.ts"], "b.ts": ["a.ts", "c.ts"], "c.ts": ["d.ts"], "d.ts": ["a.ts"] });
    expect(dependencyCycles(graph)).toEqual([{ files: ["a.ts", "b.ts", "c.ts", "d.ts"], cycle: ["a.ts", "b.ts", "a.ts"] }]);
    expect(architectureFacts(graph, { analyzedFiles: 4 })).toContain("- a.ts → b.ts → a.ts (one loop among 4 mutually dependent files; also in the group: c.ts, d.ts)");
  });

  it("reports a self-import as a cycle of one file", () => {
    const graph = handGraph({ "src/self.ts": ["src/self.ts"], "src/other.ts": ["src/self.ts"] });
    expect(dependencyCycles(graph)).toEqual([{ files: ["src/self.ts"], cycle: ["src/self.ts", "src/self.ts"] }]);
    expect(architectureFacts(graph, { analyzedFiles: 2 })).toContain("- src/self.ts → src/self.ts (imports itself)");
  });

  it("returns nothing for an acyclic graph", () => {
    const graph = graphOf([file("src/a.ts", "import './b';\n"), file("src/b.ts", "import './c';\n"), file("src/c.ts", "export const c = 1;\n")]);
    expect(dependencyCycles(graph)).toEqual([]);
  });

  it("walks a long chain without recursion", () => {
    const edges: Record<string, string[]> = {};
    const n = 50_000;
    for (let i = 0; i < n; i++) edges[`f${String(i).padStart(6, "0")}.ts`] = [`f${String((i + 1) % n).padStart(6, "0")}.ts`];
    const [cycle] = dependencyCycles(handGraph(edges));
    expect(cycle!.files).toHaveLength(n);
    expect(cycle!.cycle).toHaveLength(n + 1);
    expect(architectureFacts(handGraph(edges), { analyzedFiles: n })).toContain("more steps…");
  });
});

describe("hotspots", () => {
  it("orders by count, breaks ties by path and leaves out zero counts", () => {
    const graph = graphOf([
      file("src/types.ts", "export type T = 1;\n"),
      file("src/util.ts", "import './types';\n"),
      file("src/a.ts", "import './types';\nimport './util';\n"),
      file("src/b.ts", "import './types';\nimport './util';\nimport './a';\n"),
      file("src/c.ts", "import './util';\n"),
    ]);
    const { fanIn, fanOut } = hotspots(graph);
    expect(fanIn).toEqual([
      { path: "src/types.ts", count: 3 },
      { path: "src/util.ts", count: 3 },
      { path: "src/a.ts", count: 1 },
    ]);
    expect(fanOut).toEqual([
      { path: "src/b.ts", count: 3 },
      { path: "src/a.ts", count: 2 },
      { path: "src/c.ts", count: 1 },
      { path: "src/util.ts", count: 1 },
    ]);
    expect(hotspots(graph, 1).fanIn).toEqual([{ path: "src/types.ts", count: 3 }]);
  });
});

describe("architectureFacts", () => {
  it("returns an empty string when there is nothing to say", () => {
    expect(architectureFacts(handGraph({}), { analyzedFiles: 0 })).toBe("");
    const isolated = graphOf([file("src/a.ts", "import { z } from 'zod';\n"), file("src/b.ts", "export const b = 1;\n")]);
    expect(architectureFacts(isolated, { analyzedFiles: 2 })).toBe("");
  });

  it("states that an acyclic graph has no cycles, and lists hotspots with counts", () => {
    const graph = graphOf([file("src/a.ts", "import './b';\n"), file("src/b.ts", "import './c';\n"), file("src/c.ts", "export const c = 1;\n")]);
    const text = architectureFacts(graph, { analyzedFiles: 3 });
    expect(text).toContain("No circular dependencies among the 3 analyzed files");
    expect(text).toContain("Most depended-on files (imported by the most other files among the 3 analyzed files):\n- src/b.ts — imported by 1 file\n- src/c.ts — imported by 1 file");
    expect(text).toContain("Files with the most internal imports (among the 3 analyzed files):\n- src/a.ts — imports 1 internal file");
    expect(text).not.toContain("between directories");
  });

  it("lists file cycles with their size and says the analysis covers the analyzed files only", () => {
    const graph = graphOf([file("src/a.ts", "import './b';\n"), file("src/b.ts", "import './a';\n")]);
    const text = architectureFacts(graph, { analyzedFiles: 120 });
    expect(text).toContain("Circular dependencies (measured from imports among the 120 analyzed files; 1 group, 2 files involved; files GitFill did not read are not counted):");
    expect(text).toContain("- src/a.ts → src/b.ts → src/a.ts (2 files in the cycle)");
    // Both files are in src/: a loop inside one directory is not a directory cycle.
    expect(text).not.toContain("Circular dependencies between directories");
  });

  it("reports directory cycles with an example import for each step", () => {
    // No file cycle: lib/agent/run.ts → lib/ai/model.ts, lib/ai/client.ts → lib/agent/types.ts.
    const graph = graphOf([
      file("lib/agent/run.ts", "import { model } from '@/lib/ai/model';\n"),
      file("lib/agent/types.ts", "export type T = 1;\n"),
      file("lib/ai/model.ts", "export const model = 1;\n"),
      file("lib/ai/client.ts", "import type { T } from '../agent/types';\n"),
      file("lib/agent/deep/inner.ts", "import '../run';\n"),
    ]);
    expect(dependencyCycles(graph)).toEqual([]);
    const text = architectureFacts(graph, { analyzedFiles: 5 });
    expect(text).toContain("No circular dependencies among the 5 analyzed files");
    expect(text).toContain("Circular dependencies between directories (files grouped by their first two directory levels, e.g. lib/agent/; loops inside one directory are left out; measured among the 5 analyzed files):");
    expect(text).toContain("- lib/agent/ → lib/ai/ → lib/agent/ (2 directories in the cycle; e.g. lib/agent/run.ts imports lib/ai/model.ts; lib/ai/client.ts imports lib/agent/types.ts)");
  });

  it("says there are no directory cycles when directories import each other one way", () => {
    const graph = graphOf([file("lib/agent/run.ts", "import '@/lib/ai/model';\n"), file("lib/ai/model.ts", "export const m = 1;\n")]);
    expect(architectureFacts(graph, { analyzedFiles: 2 })).toContain("No circular dependencies between directories");
  });

  it("caps the number of cycles listed and says how many were left out", () => {
    const edges: Record<string, string[]> = {};
    for (let i = 0; i < 12; i++) {
      edges[`m${i}/a.ts`] = [`m${i}/b.ts`];
      edges[`m${i}/b.ts`] = [`m${i}/a.ts`];
    }
    const text = architectureFacts(handGraph(edges), { analyzedFiles: 24 });
    expect(text).toContain("12 groups, 24 files involved");
    expect(text).toContain("- …and 4 more");
    expect(text.split("\n").filter((l) => l.includes(" → ")).length).toBe(8);
  });
});
