import { numberLines } from "@/lib/ai/prompts";
import { detectRoutes } from "@/lib/analysis/routes";
import { classify } from "@/lib/connectors/github/filter";
import type { SourceFile } from "@/lib/connectors/types";
import type { CodeSource } from "./types";

export interface RepoMeta {
  displayName: string;
  branch: string;
  description: string | null;
}

export interface RepoMap {
  text: string;
  files: number;
  routes: number;
}

const MAX_CHARS = 10_000;
const ROUTE_FILE_LIMIT = 60;
const cache = new Map<string, Promise<RepoMap>>();

/**
 * The agent's starting context instead of inline file contents: layout, languages, manifests,
 * entry points, HTTP routes and the README head, all computed by code (~2–3K tokens). Cached per
 * commit. Everything else the agent reads on demand.
 */
export function buildRepoMap(source: CodeSource, meta: RepoMeta): Promise<RepoMap> {
  const key = source.label;
  let map = cache.get(key);
  if (!map) {
    map = compute(source, meta).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, map);
    if (cache.size > 30) cache.delete(cache.keys().next().value!);
  }
  return map;
}

async function compute(source: CodeSource, meta: RepoMeta): Promise<RepoMap> {
  const { paths, total } = await source.listFiles({ limit: 5000 });
  const read = (p: string, end?: number) => source.read(p, end ? { end } : undefined);

  // Layout: top-level directories with file counts and their busiest subdirectories.
  const top = new Map<string, { n: number; sub: Map<string, number> }>();
  const rootFiles: string[] = [];
  for (const p of paths) {
    const parts = p.split("/");
    if (parts.length === 1) {
      rootFiles.push(p);
      continue;
    }
    const t = top.get(parts[0]!) ?? { n: 0, sub: new Map() };
    t.n++;
    if (parts.length > 2) t.sub.set(parts[1]!, (t.sub.get(parts[1]!) ?? 0) + 1);
    top.set(parts[0]!, t);
  }
  const layout = [...top.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 16)
    .map(([d, t]) => {
      const subs = [...t.sub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => `${s}/ ${n}`);
      return `- ${d}/ (${t.n} files)${subs.length ? `: ${subs.join(", ")}` : ""}`;
    });

  const ext = new Map<string, number>();
  for (const p of paths) {
    const e = /\.([A-Za-z0-9]+)$/.exec(p)?.[1]?.toLowerCase();
    if (e) ext.set(e, (ext.get(e) ?? 0) + 1);
  }
  const languages = [...ext.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e, n]) => `${e} ${n}`).join(", ");

  // Manifests near the root say what the project is built with.
  const manifests = paths.filter((p) => p.split("/").length <= 2 && classify(p)?.category === "manifest").slice(0, 5);
  const manifestText = (await Promise.all(manifests.map(async (p) => summarizeManifest(p, (await read(p, 120))?.lines.join("\n") ?? "")))).filter(Boolean);

  const entrypoints = paths
    .map((p) => ({ p, c: classify(p) }))
    .filter((x) => x.c?.category === "entrypoint")
    .sort((a, b) => b.c!.priority - a.c!.priority)
    .slice(0, 14)
    .map((x) => x.p);

  // Routes from the files most likely to declare them.
  const routeCandidates = paths
    .filter((p) => /\.(ts|tsx|js|jsx|mjs|py|go|java|kt|rb|php|cs)$/.test(p) && (classify(p)?.category === "api" || /(^|\/)(routes?|router|controllers?|handlers?|urls|views|server|app|main|api)(\/|\.|$)/i.test(p)))
    .slice(0, ROUTE_FILE_LIMIT);
  const routeFiles = (
    await mapLimit(routeCandidates, 8, async (p): Promise<SourceFile | null> => {
      const r = await read(p);
      return r ? { path: p, category: "api", sizeBytes: 0, content: r.lines.join("\n"), lineCount: r.total } : null;
    })
  ).filter((f): f is SourceFile => f !== null);
  const routes = detectRoutes(routeFiles);

  const readme = rootFiles.find((p) => /^readme(\.md|\.rst|\.txt)?$/i.test(p));
  // Numbered like read_file output, so citations of the README use real line numbers.
  const readmeLines = readme ? (await read(readme, 40))?.lines : undefined;
  const readmeHead = readmeLines?.length ? numberLines(readmeLines) : "";

  const text = [
    `Repository: ${meta.displayName} (branch ${meta.branch}, commit ${source.version.slice(0, 12)})`,
    meta.description ? `Description: ${meta.description}` : "",
    `Files: ${total} searchable (secrets, lockfiles, generated files and binaries are hidden). Languages by extension: ${languages || "unknown"}.`,
    "",
    "Layout:",
    ...layout,
    rootFiles.length ? `- (root): ${rootFiles.slice(0, 20).join(", ")}${rootFiles.length > 20 ? ", …" : ""}` : "",
    manifestText.length ? `\nManifests:\n${manifestText.join("\n")}` : "",
    entrypoints.length ? `\nLikely entry points: ${entrypoints.join(", ")}` : "",
    routes.length ? `\nHTTP routes (detected by code):\n${routes.slice(0, 40).map((r) => `- ${r.method} ${r.path} → ${r.file}:${r.line}`).join("\n")}${routes.length > 40 ? `\n- … ${routes.length - 40} more` : ""}` : "",
    readmeHead ? `\n${readme} (lines 1-${readmeLines!.length}):\n${readmeHead}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…` : text, files: total, routes: routes.length };
}

function summarizeManifest(path: string, content: string): string {
  if (!content) return "";
  if (path.endsWith("package.json")) {
    try {
      const pkg = JSON.parse(content) as { name?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const deps = Object.keys(pkg.dependencies ?? {});
      return `- ${path}: name ${pkg.name ?? "?"}; scripts: ${Object.keys(pkg.scripts ?? {}).slice(0, 14).join(", ") || "none"}; dependencies (${deps.length}): ${deps.slice(0, 30).join(", ")}; devDependencies: ${Object.keys(pkg.devDependencies ?? {}).length}`;
    } catch {
      // Truncated or invalid JSON: fall through to the raw head.
    }
  }
  if (path.endsWith("go.mod")) {
    const lines = content.split("\n");
    return `- ${path}: ${lines.find((l) => l.startsWith("module ")) ?? ""}; requires: ${lines.filter((l) => /^\s+[\w.-]+\.[a-z]+\//.test(l)).slice(0, 20).map((l) => l.trim().split(/\s/)[0]).join(", ")}`;
  }
  return `- ${path}:\n${content.split("\n").slice(0, 20).map((l) => `    ${l}`).join("\n")}`;
}

async function mapLimit<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}
