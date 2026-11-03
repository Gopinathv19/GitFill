import type { CodeGraph } from "@/lib/analysis/graph";

/**
 * Architecture-health facts computed from the import graph: circular dependencies (between files
 * and between directories) and the most depended-on / most dependent files. Everything here is
 * measured by code, so architecture-review and walkthrough slides can state it as fact, with paths.
 */

export interface DependencyCycle {
  /** Every file in the strongly connected component, sorted. */
  files: string[];
  /** One concrete closed loop inside it: cycle[0] === cycle[cycle.length - 1]. */
  cycle: string[];
}

export interface Hotspot {
  path: string;
  count: number;
}

const MAX_FILE_CYCLES = 8;
const MAX_DIR_CYCLES = 5;
const MAX_HOTSPOTS = 5;
/** Longest loop drawn in full; longer ones are cut so a single fact stays one readable line. */
const MAX_LOOP_STEPS = 10;
const MAX_GROUP_NAMES = 6;

/**
 * Groups of files that import each other (directly or through others), largest first, each with
 * one shortest closed loop through its first path, so a slide can show "a.ts → b.ts → a.ts".
 * Self-imports count as cycles of one file. All cycles are returned unless `limit` is given.
 */
export function dependencyCycles(graph: CodeGraph, opts: { limit?: number } = {}): DependencyCycle[] {
  return cyclesOf(graph.dependencies).slice(0, Math.max(0, opts.limit ?? Infinity));
}

/**
 * Files imported by the most other files (fan-in) and files importing the most internal files
 * (fan-out), top `n` each, ties broken by path. Counted from `dependencies` alone so a graph
 * built by hand cannot disagree with itself; self-imports are not counted.
 */
export function hotspots(graph: CodeGraph, n = MAX_HOTSPOTS): { fanIn: Hotspot[]; fanOut: Hotspot[] } {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const [from, tos] of graph.dependencies) {
    for (const to of tos) {
      if (to === from) continue;
      fanIn.set(to, (fanIn.get(to) ?? 0) + 1);
      fanOut.set(from, (fanOut.get(from) ?? 0) + 1);
    }
  }
  return { fanIn: top(fanIn, n), fanOut: top(fanOut, n) };
}

/**
 * Prompt text in codeFacts style. "" when the graph has no internal imports. States absence of
 * cycles explicitly when there are imports but no loops, since that is a true and useful finding.
 * Every section says it covers the analyzed files only: large repos are read on a budget.
 */
export function architectureFacts(graph: CodeGraph, opts: { analyzedFiles: number }): string {
  const edgeCount = [...graph.dependencies].reduce((sum, [from, tos]) => sum + [...tos].filter((t) => t !== from).length, 0);
  const cycles = dependencyCycles(graph);
  if (edgeCount === 0 && cycles.length === 0) return "";
  const scope = `the ${opts.analyzedFiles} analyzed file${opts.analyzedFiles === 1 ? "" : "s"}`;
  const sections: string[] = [fileCycleSection(cycles, scope)];

  const dirs = directoryDependencies(graph);
  const dirCycles = cyclesOf(dirs.edges);
  if (dirCycles.length) sections.push(dirCycleSection(dirCycles, dirs.examples, scope));
  else if (dirs.edgeCount > 0) sections.push(`No circular dependencies between directories (files grouped by their first two directory levels, e.g. lib/agent/) among ${scope}.`);

  const { fanIn, fanOut } = hotspots(graph, MAX_HOTSPOTS);
  if (fanIn.length) {
    sections.push(`Most depended-on files (imported by the most other files among ${scope}):\n${fanIn.map((h) => `- ${h.path} — imported by ${h.count} file${h.count === 1 ? "" : "s"}`).join("\n")}`);
  }
  if (fanOut.length) {
    sections.push(`Files with the most internal imports (among ${scope}):\n${fanOut.map((h) => `- ${h.path} — imports ${h.count} internal file${h.count === 1 ? "" : "s"}`).join("\n")}`);
  }
  return sections.join("\n\n");
}

function fileCycleSection(cycles: DependencyCycle[], scope: string): string {
  if (!cycles.length) return `No circular dependencies among ${scope} (measured from their imports; files GitFill did not read are not counted).`;
  const involved = cycles.reduce((sum, c) => sum + c.files.length, 0);
  const lines = cycles.slice(0, MAX_FILE_CYCLES).map((c) => `- ${loopText(c.cycle, "files")} (${groupText(c, "file")})`);
  if (cycles.length > MAX_FILE_CYCLES) lines.push(`- …and ${cycles.length - MAX_FILE_CYCLES} more`);
  const groups = `${cycles.length} group${cycles.length === 1 ? "" : "s"}, ${involved} file${involved === 1 ? "" : "s"} involved`;
  return `Circular dependencies (measured from imports among ${scope}; ${groups}; files GitFill did not read are not counted):\n${lines.join("\n")}`;
}

function dirCycleSection(cycles: DependencyCycle[], examples: Map<string, { from: string; to: string }>, scope: string): string {
  const lines = cycles.slice(0, MAX_DIR_CYCLES).map((c) => {
    const steps: string[] = [];
    for (let i = 0; i + 1 < c.cycle.length && i < shownSteps(c.cycle); i++) {
      const e = examples.get(edgeKey(c.cycle[i]!, c.cycle[i + 1]!));
      if (e) steps.push(`${e.from} imports ${e.to}`);
    }
    const labeled = { files: c.files.map(dirLabel), cycle: c.cycle.map(dirLabel) };
    return `- ${loopText(labeled.cycle, "directories")} (${groupText(labeled, "directory")}; e.g. ${steps.join("; ")})`;
  });
  if (cycles.length > MAX_DIR_CYCLES) lines.push(`- …and ${cycles.length - MAX_DIR_CYCLES} more`);
  // "lib/" next to "lib/agent/" reads as the whole of lib/ unless the text says otherwise.
  const shallow = cycles.slice(0, MAX_DIR_CYCLES).some((c) => c.files.some((d) => d !== ROOT && !d.includes("/")));
  const note = shallow ? "; a one-level name such as lib/ means only the files directly in it, not its subdirectories" : "";
  return `Circular dependencies between directories (files grouped by their first two directory levels, e.g. lib/agent/${note}; loops inside one directory are left out; measured among ${scope}):\n${lines.join("\n")}`;
}

/** Arrows drawn before a long loop is cut (all of them when it fits). */
function shownSteps(cycle: string[]): number {
  return cycle.length - 1 <= MAX_LOOP_STEPS ? cycle.length - 1 : MAX_LOOP_STEPS - 1;
}

/**
 * "a → b → a", cut after MAX_LOOP_STEPS nodes so one huge loop cannot flood the prompt. The gap
 * counts the hidden nodes (not steps: hiding k nodes removes k + 1 arrows), so the number is exact.
 */
function loopText(cycle: string[], noun: "files" | "directories"): string {
  if (cycle.length - 1 <= MAX_LOOP_STEPS) return cycle.join(" → ");
  const hidden = cycle.length - 1 - MAX_LOOP_STEPS;
  return `${cycle.slice(0, MAX_LOOP_STEPS).join(" → ")} → …${hidden} more ${hidden === 1 ? (noun === "files" ? "file" : "directory") : noun}… → ${cycle[cycle.length - 1]}`;
}

/** Says how big the group is, and names the members the loop shown does not pass through. */
function groupText(c: DependencyCycle, noun: "file" | "directory"): string {
  const plural = noun === "file" ? "files" : "directories";
  if (c.cycle.length === 2 && c.cycle[0] === c.cycle[1]) return "imports itself";
  const onLoop = new Set(c.cycle);
  const others = c.files.filter((f) => !onLoop.has(f));
  if (!others.length) return `${c.files.length} ${plural} in the cycle`;
  const named = others.slice(0, MAX_GROUP_NAMES).join(", ");
  const more = others.length > MAX_GROUP_NAMES ? `, …and ${others.length - MAX_GROUP_NAMES} more` : "";
  return `one loop among ${c.files.length} mutually dependent ${plural}; also in the group: ${named}${more}`;
}

const ROOT = "(root)";

/** "lib/agent/run/x.ts" → "lib/agent"; "lib/x.ts" → "lib"; "x.ts" → "(root)". */
function directoryOf(path: string): string {
  const dirs = path.split("/").slice(0, -1);
  return dirs.length ? dirs.slice(0, 2).join("/") : ROOT;
}

function dirLabel(dir: string): string {
  return dir === ROOT ? dir : `${dir}/`;
}

function edgeKey(a: string, b: string): string {
  return `${a}\u0000${b}`;
}

/**
 * The file graph collapsed to directories, dropping imports within one directory. Keeps the
 * first file pair (by path) behind each directory edge as evidence for the slide.
 */
function directoryDependencies(graph: CodeGraph): { edges: Map<string, Set<string>>; examples: Map<string, { from: string; to: string }>; edgeCount: number } {
  const edges = new Map<string, Set<string>>();
  const examples = new Map<string, { from: string; to: string }>();
  for (const from of [...graph.dependencies.keys()].sort()) {
    for (const to of [...graph.dependencies.get(from)!].sort()) {
      const a = directoryOf(from);
      const b = directoryOf(to);
      if (a === b) continue;
      const set = edges.get(a) ?? new Set<string>();
      set.add(b);
      edges.set(a, set);
      if (!examples.has(edgeKey(a, b))) examples.set(edgeKey(a, b), { from, to });
    }
  }
  return { edges, examples, edgeCount: examples.size };
}

/** SCCs of size >= 2 plus self-loops, each with a loop, in deterministic order. */
function cyclesOf(dependencies: ReadonlyMap<string, ReadonlySet<string>>): DependencyCycle[] {
  const adjacency = new Map<string, string[]>();
  const nodes = new Set<string>();
  for (const [from, tos] of dependencies) {
    nodes.add(from);
    for (const to of tos) nodes.add(to);
    adjacency.set(from, [...tos].sort());
  }
  const out: DependencyCycle[] = [];
  for (const scc of stronglyConnected([...nodes].sort(), adjacency)) {
    const files = scc.sort();
    const start = files[0]!;
    if (files.length === 1) {
      if (adjacency.get(start)?.includes(start)) out.push({ files, cycle: [start, start] });
      continue;
    }
    out.push({ files, cycle: shortestLoop(start, new Set(files), adjacency) });
  }
  return out.sort((a, b) => b.files.length - a.files.length || compare(a.files[0]!, b.files[0]!));
}

/**
 * Tarjan's algorithm with an explicit stack instead of recursion, so a long import chain in a
 * big repository cannot overflow the call stack.
 */
function stronglyConnected(nodes: string[], adjacency: ReadonlyMap<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let next = 0;
  const visit = (node: string) => {
    index.set(node, next);
    low.set(node, next);
    next++;
    stack.push(node);
    onStack.add(node);
  };
  for (const root of nodes) {
    if (index.has(root)) continue;
    visit(root);
    const work: Array<{ node: string; edge: number }> = [{ node: root, edge: 0 }];
    while (work.length) {
      const frame = work[work.length - 1]!;
      const targets = adjacency.get(frame.node) ?? [];
      if (frame.edge < targets.length) {
        const to = targets[frame.edge++]!;
        if (!index.has(to)) {
          visit(to);
          work.push({ node: to, edge: 0 });
        } else if (onStack.has(to)) {
          low.set(frame.node, Math.min(low.get(frame.node)!, index.get(to)!));
        }
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) === index.get(frame.node)) {
        const scc: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          scc.push(member);
        } while (member !== frame.node);
        out.push(scc);
      }
    }
  }
  return out;
}

/**
 * Shortest closed loop from `start` back to itself, staying inside its component (BFS over
 * sorted edges, so the result is deterministic). Self-edges are skipped: in a group of several
 * files, the loop through the others is the one worth showing.
 */
function shortestLoop(start: string, members: ReadonlySet<string>, adjacency: ReadonlyMap<string, string[]>): string[] {
  const parent = new Map<string, string>();
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head]!;
    for (const to of adjacency.get(node) ?? []) {
      if (!members.has(to) || to === node) continue;
      if (to === start) {
        const back = [start, node];
        while (back[back.length - 1] !== start) back.push(parent.get(back[back.length - 1]!)!);
        return back.reverse();
      }
      if (!parent.has(to)) {
        parent.set(to, node);
        queue.push(to);
      }
    }
  }
  return [start, start];
}

function top(counts: Map<string, number>, n: number): Hotspot[] {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count || compare(a.path, b.path))
    .slice(0, n);
}

/** Code-unit order, like Array.prototype.sort: unlike localeCompare it is the same on every machine. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
