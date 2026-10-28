import type { SourceFile, SourceSnapshot } from "@/lib/connectors/types";
import { extractImports, goModuleName, resolveImports, type ImportEdge } from "./imports";
import { extractSymbols, type CodeSymbol } from "./symbols";

/**
 * The code graph: every declaration and import found by deterministic analysis of the
 * snapshot's files. Agents query it through tools; diagrams are derived from it.
 */
export interface CodeGraph {
  symbols: CodeSymbol[];
  imports: ImportEdge[];
  /** Symbols by name (several files can declare the same name). */
  byName: Map<string, CodeSymbol[]>;
  /** Symbols by file. */
  byPath: Map<string, CodeSymbol[]>;
  /** Resolved internal dependencies: file → files it imports. */
  dependencies: Map<string, Set<string>>;
  /** Reverse edges: file → files that import it. */
  dependents: Map<string, Set<string>>;
  /** External packages by import count. */
  externalPackages: Map<string, number>;
}

export function buildCodeGraph(snapshot: Pick<SourceSnapshot, "files" | "inventory">): CodeGraph {
  const files = new Map(snapshot.files.map((f) => [f.path, f.content]));
  const allPaths = new Set(snapshot.inventory.map((i) => i.path));
  for (const f of snapshot.files) allPaths.add(f.path);
  const goModule = goModuleName(files);

  const symbols: CodeSymbol[] = [];
  const rawImports: Omit<ImportEdge, "to" | "external">[] = [];
  for (const f of snapshot.files) {
    symbols.push(...extractSymbols(f.path, f.content));
    rawImports.push(...extractImports(f.path, f.content));
  }
  const imports = resolveImports(rawImports, { allPaths, goModule });

  const byName = new Map<string, CodeSymbol[]>();
  const byPath = new Map<string, CodeSymbol[]>();
  for (const s of symbols) {
    push(byName, s.name, s);
    push(byPath, s.path, s);
  }
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  const externalPackages = new Map<string, number>();
  for (const e of imports) {
    if (e.to && e.to !== e.from) {
      add(dependencies, e.from, e.to);
      add(dependents, e.to, e.from);
    } else if (e.external) {
      const pkg = packageName(e.specifier);
      if (pkg) externalPackages.set(pkg, (externalPackages.get(pkg) ?? 0) + 1);
    }
  }
  return { symbols, imports, byName, byPath, dependencies, dependents, externalPackages };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function add<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

/** "@scope/pkg/sub" → "@scope/pkg"; "lodash/fp" → "lodash"; "github.com/a/b/c" → "github.com/a/b". */
export function packageName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("mod:") || specifier.startsWith("rel:")) return null;
  if (specifier.startsWith("node:")) return null;
  if (specifier.includes("github.com/") || specifier.includes("golang.org/")) return specifier.split("/").slice(0, 3).join("/");
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0]!.split("::")[0]!.split(".")[0]!;
}

export interface Reference {
  path: string;
  line: number;
  text: string;
}

/** Whole-word occurrences of an identifier across the snapshot (bounded). */
export function findReferences(files: SourceFile[], name: string, opts: { limit?: number; excludePath?: string } = {}): Reference[] {
  const limit = opts.limit ?? 60;
  const re = new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`);
  const out: Reference[] = [];
  for (const f of files) {
    if (f.path === opts.excludePath) continue;
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      if (re.test(lines[i]!)) out.push({ path: f.path, line: i + 1, text: lines[i]!.trim().slice(0, 160) });
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Known symbols referenced inside a symbol's body (a cheap call graph, by name). */
export function callsWithin(graph: CodeGraph, files: ReadonlyMap<string, SourceFile>, symbol: CodeSymbol, limit = 40): CodeSymbol[] {
  const file = files.get(symbol.path);
  if (!file) return [];
  const body = file.content.split("\n").slice(symbol.line, symbol.endLine).join("\n");
  const identifiers = new Set(body.match(/[A-Za-z_$][\w$]*(?=\s*\()/g) ?? []);
  const out: CodeSymbol[] = [];
  for (const id of identifiers) {
    if (id === symbol.name) continue;
    const targets = graph.byName.get(id);
    if (!targets) continue;
    // Prefer same-file or imported-file targets.
    const deps = graph.dependencies.get(symbol.path);
    const best = targets.find((t) => t.path === symbol.path) ?? targets.find((t) => deps?.has(t.path)) ?? targets[0]!;
    out.push(best);
    if (out.length >= limit) break;
  }
  return out;
}

export interface DirectorySummary {
  dir: string;
  files: number;
  bytes: number;
  categories: Record<string, number>;
  languages: Record<string, number>;
}

/** Top-level (and second-level for the biggest) directories with file counts, for directory guides. */
export function directorySummary(snapshot: Pick<SourceSnapshot, "inventory" | "files">, depth = 2): DirectorySummary[] {
  const map = new Map<string, DirectorySummary>();
  const categoryByPath = new Map(snapshot.files.map((f) => [f.path, f.category]));
  for (const entry of snapshot.inventory) {
    const parts = entry.path.split("/");
    if (parts.length < 2) continue;
    for (let d = 1; d <= Math.min(depth, parts.length - 1); d++) {
      const dir = parts.slice(0, d).join("/");
      const s = map.get(dir) ?? { dir, files: 0, bytes: 0, categories: {}, languages: {} };
      s.files++;
      s.bytes += entry.sizeBytes;
      const cat = categoryByPath.get(entry.path);
      if (cat) s.categories[cat] = (s.categories[cat] ?? 0) + 1;
      const ext = parts[parts.length - 1]!.includes(".") ? parts[parts.length - 1]!.split(".").pop()! : "";
      if (ext) s.languages[ext] = (s.languages[ext] ?? 0) + 1;
      map.set(dir, s);
    }
  }
  return [...map.values()].sort((a, b) => a.dir.localeCompare(b.dir));
}

export interface ModuleGraphView {
  nodes: Array<{ id: string; label: string; files: number }>;
  edges: Array<{ from: string; to: string; weight: number }>;
  /** True when files were collapsed into directories to fit. */
  collapsed: boolean;
}

/**
 * Dependency graph for diagrams. Uses files when there are few; otherwise collapses to
 * directories at the shallowest depth that fits within `maxNodes`.
 */
export function moduleGraph(graph: CodeGraph, opts: { maxNodes?: number; focus?: string } = {}): ModuleGraphView {
  const maxNodes = opts.maxNodes ?? 18;
  let paths = [...new Set([...graph.dependencies.keys(), ...graph.dependents.keys()])];
  if (opts.focus) {
    const f = opts.focus.replace(/\/$/, "");
    paths = paths.filter((p) => p === f || p.startsWith(`${f}/`) || [...(graph.dependencies.get(p) ?? [])].some((d) => d.startsWith(`${f}/`)));
  }
  for (let depth = 6; depth >= 1; depth--) {
    const key = (p: string) => collapse(p, depth);
    const ids = new Set(paths.map(key));
    if (ids.size <= maxNodes || depth === 1) {
      const counts = new Map<string, number>();
      for (const p of paths) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);
      const edges = new Map<string, number>();
      for (const [from, tos] of graph.dependencies) {
        if (!paths.includes(from)) continue;
        for (const to of tos) {
          const a = key(from);
          const b = key(to);
          if (a === b || !ids.has(b)) continue;
          edges.set(`${a}\u0000${b}`, (edges.get(`${a}\u0000${b}`) ?? 0) + 1);
        }
      }
      const nodes = [...ids].sort().slice(0, maxNodes);
      const nodeSet = new Set(nodes);
      return {
        nodes: nodes.map((id) => ({ id, label: id, files: counts.get(id) ?? 0 })),
        edges: [...edges.entries()]
          .map(([k, weight]) => {
            const [from, to] = k.split("\u0000") as [string, string];
            return { from, to, weight };
          })
          .filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to))
          .sort((a, b) => b.weight - a.weight)
          .slice(0, 40),
        collapsed: depth < 6 || ids.size > paths.length,
      };
    }
  }
  return { nodes: [], edges: [], collapsed: false };
}

function collapse(p: string, depth: number): string {
  const parts = p.split("/");
  return parts.length <= depth ? p : parts.slice(0, depth).join("/");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
