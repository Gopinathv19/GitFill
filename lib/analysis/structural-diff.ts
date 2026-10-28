import type { SourceFile } from "@/lib/connectors/types";
import { detectRoutes, type RouteInfo } from "./routes";
import { extractImports, resolveImports } from "./imports";
import { extractSymbols, type CodeSymbol } from "./symbols";

/**
 * Structural comparison of two versions of a repository: which declarations, module
 * dependencies, packages, routes and directories changed. Everything here is computed
 * from real file contents, so a commit report can separate measured facts from the
 * model's interpretation of them.
 */

export interface FileChange {
  path: string;
  status: "added" | "removed" | "modified" | "renamed";
  previousPath?: string;
  additions: number;
  deletions: number;
  /** Unified diff hunk text from the provider, when available (bounded). */
  patch?: string;
}

export interface SymbolMove {
  name: string;
  kind: CodeSymbol["kind"];
  from: string;
  to: string;
}

export interface StructuralDiff {
  files: FileChange[];
  symbols: { added: CodeSymbol[]; removed: CodeSymbol[]; modified: CodeSymbol[]; moved: SymbolMove[] };
  dependencies: { added: Array<{ from: string; to: string }>; removed: Array<{ from: string; to: string }> };
  packages: { added: string[]; removed: string[] };
  routes: { added: RouteInfo[]; removed: RouteInfo[] };
  directories: { added: string[]; removed: string[] };
  summary: { filesChanged: number; additions: number; deletions: number };
}

export interface VersionContents {
  /** Contents of changed files (and their neighbours, when fetched) at this version. */
  files: ReadonlyMap<string, string>;
  /** Every path in the tree at this version, for import resolution and directory diffs. */
  allPaths: ReadonlySet<string>;
}

export function computeStructuralDiff(changes: FileChange[], before: VersionContents, after: VersionContents): StructuralDiff {
  const symBefore = symbolsOf(before.files);
  const symAfter = symbolsOf(after.files);
  const keyOf = (s: CodeSymbol) => `${s.path}\u0000${s.kind}\u0000${s.parent ?? ""}\u0000${s.name}`;
  const mapBefore = new Map(symBefore.map((s) => [keyOf(s), s]));
  const mapAfter = new Map(symAfter.map((s) => [keyOf(s), s]));

  const added: CodeSymbol[] = [];
  const removed: CodeSymbol[] = [];
  const modified: CodeSymbol[] = [];
  for (const [k, s] of mapAfter) {
    const prev = mapBefore.get(k);
    if (!prev) added.push(s);
    else if (bodyOf(after.files, s) !== bodyOf(before.files, prev)) modified.push(s);
  }
  for (const [k, s] of mapBefore) if (!mapAfter.has(k)) removed.push(s);

  // A symbol removed from one file and added to another with the same name and kind moved.
  const moved: SymbolMove[] = [];
  const addedByName = new Map(added.map((s) => [`${s.kind}:${s.name}`, s]));
  const movedAdded = new Set<CodeSymbol>();
  const movedRemoved = new Set<CodeSymbol>();
  for (const r of removed) {
    const a = addedByName.get(`${r.kind}:${r.name}`);
    if (a && a.path !== r.path) {
      moved.push({ name: r.name, kind: r.kind, from: r.path, to: a.path });
      movedAdded.add(a);
      movedRemoved.add(r);
    }
  }

  const depsBefore = dependencyEdges(before);
  const depsAfter = dependencyEdges(after);
  const edgeKey = (e: { from: string; to: string }) => `${e.from}→${e.to}`;
  const beforeKeys = new Set(depsBefore.map(edgeKey));
  const afterKeys = new Set(depsAfter.map(edgeKey));

  const routesBefore = detectRoutes(asSourceFiles(before.files));
  const routesAfter = detectRoutes(asSourceFiles(after.files));
  const routeKey = (r: RouteInfo) => `${r.method} ${r.path}`;
  const rb = new Set(routesBefore.map(routeKey));
  const ra = new Set(routesAfter.map(routeKey));

  const dirsBefore = topDirs(before.allPaths);
  const dirsAfter = topDirs(after.allPaths);

  const pkgBefore = packagesOf(before.files);
  const pkgAfter = packagesOf(after.files);

  return {
    files: changes,
    symbols: {
      added: added.filter((s) => !movedAdded.has(s)).slice(0, 200),
      removed: removed.filter((s) => !movedRemoved.has(s)).slice(0, 200),
      modified: modified.slice(0, 200),
      moved: moved.slice(0, 100),
    },
    dependencies: {
      added: depsAfter.filter((e) => !beforeKeys.has(edgeKey(e))).slice(0, 100),
      removed: depsBefore.filter((e) => !afterKeys.has(edgeKey(e))).slice(0, 100),
    },
    packages: {
      added: [...pkgAfter].filter((p) => !pkgBefore.has(p)).sort(),
      removed: [...pkgBefore].filter((p) => !pkgAfter.has(p)).sort(),
    },
    routes: {
      added: routesAfter.filter((r) => !rb.has(routeKey(r))),
      removed: routesBefore.filter((r) => !ra.has(routeKey(r))),
    },
    directories: {
      added: [...dirsAfter].filter((d) => !dirsBefore.has(d)).sort(),
      removed: [...dirsBefore].filter((d) => !dirsAfter.has(d)).sort(),
    },
    summary: {
      filesChanged: changes.length,
      additions: changes.reduce((n, c) => n + c.additions, 0),
      deletions: changes.reduce((n, c) => n + c.deletions, 0),
    },
  };
}

function symbolsOf(files: ReadonlyMap<string, string>): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  for (const [path, content] of files) out.push(...extractSymbols(path, content));
  return out;
}

function bodyOf(files: ReadonlyMap<string, string>, s: CodeSymbol): string {
  const content = files.get(s.path);
  if (!content) return "";
  return content
    .split("\n")
    .slice(s.line - 1, s.endLine)
    .map((l) => l.trim())
    .join("\n");
}

function dependencyEdges(v: VersionContents): Array<{ from: string; to: string }> {
  const raw: ReturnType<typeof extractImports> = [];
  for (const [path, content] of v.files) raw.push(...extractImports(path, content));
  return resolveImports(raw, { allPaths: v.allPaths })
    .filter((e) => e.to && e.to !== e.from)
    .map((e) => ({ from: e.from, to: e.to! }));
}

function asSourceFiles(files: ReadonlyMap<string, string>): SourceFile[] {
  return [...files].map(([path, content]) => ({ path, content, category: "source", sizeBytes: content.length, lineCount: content.split("\n").length }));
}

function topDirs(paths: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    if (parts.length >= 2) out.add(parts[0]!);
    if (parts.length >= 3) out.add(parts.slice(0, 2).join("/"));
  }
  return out;
}

/** Declared dependencies across common manifests, as "name" strings. */
export function packagesOf(files: ReadonlyMap<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [path, content] of files) {
    const base = path.slice(path.lastIndexOf("/") + 1);
    try {
      if (base === "package.json") {
        const pkg = JSON.parse(content) as Record<string, Record<string, string> | undefined>;
        for (const section of ["dependencies", "devDependencies", "peerDependencies"]) for (const name of Object.keys(pkg[section] ?? {})) out.add(`npm:${name}`);
      } else if (base === "requirements.txt" || /^requirements[-_.\w]*\.txt$/.test(base)) {
        for (const line of content.split("\n")) {
          const m = /^\s*([A-Za-z0-9_.-]+)/.exec(line);
          if (m && !line.trim().startsWith("#") && !line.trim().startsWith("-")) out.add(`pypi:${m[1]!.toLowerCase()}`);
        }
      } else if (base === "pyproject.toml") {
        const section = /\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/.exec(content)?.[1] ?? "";
        for (const m of section.matchAll(/["']([A-Za-z0-9_.-]+)/g)) out.add(`pypi:${m[1]!.toLowerCase()}`);
        const poetry = /\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(content)?.[1] ?? "";
        for (const m of poetry.matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)) if (m[1] !== "python") out.add(`pypi:${m[1]!.toLowerCase()}`);
      } else if (base === "go.mod") {
        for (const m of content.matchAll(/^\s*([\w.-]+\/[\w./-]+)\s+v[\w.+-]+/gm)) out.add(`go:${m[1]}`);
      } else if (base === "Cargo.toml") {
        const section = /\[dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(content)?.[1] ?? "";
        for (const m of section.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)) out.add(`crate:${m[1]}`);
      } else if (base === "Gemfile") {
        for (const m of content.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)) out.add(`gem:${m[1]}`);
      } else if (base === "pom.xml") {
        for (const m of content.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) out.add(`maven:${m[1]}`);
      } else if (base === "build.gradle" || base === "build.gradle.kts") {
        for (const m of content.matchAll(/(?:implementation|api|compileOnly|testImplementation)\s*\(?\s*["']([^"':]+:[^"':]+)/g)) out.add(`gradle:${m[1]}`);
      }
    } catch {
      // Unparseable manifest: skip.
    }
  }
  return out;
}

/** Compact text rendering for prompts and reports. */
export function renderStructuralDiff(d: StructuralDiff): string {
  const sym = (s: CodeSymbol) => `${s.kind} ${s.parent ? `${s.parent}.` : ""}${s.name} (${s.path}:${s.line})`;
  const lines: string[] = [
    `Files changed: ${d.summary.filesChanged} (+${d.summary.additions} / -${d.summary.deletions})`,
    ...d.files.slice(0, 80).map((f) => `  ${f.status.padEnd(8)} ${f.previousPath ? `${f.previousPath} → ` : ""}${f.path} (+${f.additions}/-${f.deletions})`),
  ];
  if (d.directories.added.length || d.directories.removed.length) {
    lines.push(`Directories added: ${d.directories.added.join(", ") || "none"}`, `Directories removed: ${d.directories.removed.join(", ") || "none"}`);
  }
  lines.push(`Symbols added (${d.symbols.added.length}):`, ...d.symbols.added.slice(0, 60).map((s) => `  + ${sym(s)}`));
  lines.push(`Symbols removed (${d.symbols.removed.length}):`, ...d.symbols.removed.slice(0, 60).map((s) => `  - ${sym(s)}`));
  lines.push(`Symbols modified (${d.symbols.modified.length}):`, ...d.symbols.modified.slice(0, 60).map((s) => `  ~ ${sym(s)}`));
  lines.push(`Symbols moved (${d.symbols.moved.length}):`, ...d.symbols.moved.map((m) => `  ↪ ${m.kind} ${m.name}: ${m.from} → ${m.to}`));
  lines.push(`Module dependencies added:`, ...d.dependencies.added.slice(0, 40).map((e) => `  + ${e.from} → ${e.to}`));
  lines.push(`Module dependencies removed:`, ...d.dependencies.removed.slice(0, 40).map((e) => `  - ${e.from} → ${e.to}`));
  lines.push(`Packages added: ${d.packages.added.join(", ") || "none"}`, `Packages removed: ${d.packages.removed.join(", ") || "none"}`);
  lines.push(`Routes added: ${d.routes.added.map((r) => `${r.method} ${r.path}`).join(", ") || "none"}`, `Routes removed: ${d.routes.removed.map((r) => `${r.method} ${r.path}`).join(", ") || "none"}`);
  return lines.join("\n");
}
