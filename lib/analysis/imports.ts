import path from "node:path/posix";
import { languageOf } from "./symbols";

/** One import statement, resolved to a repository file when possible. */
export interface ImportEdge {
  from: string;
  /** Repository-relative path of the imported module, or null when external/unresolved. */
  to: string | null;
  specifier: string;
  external: boolean;
  line: number;
}

const TS_IMPORT_RES = [
  /\bimport\s+(?:type\s+)?(?:[\w*\s{},$]*?\s+from\s+)?["']([^"']+)["']/g,
  /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

const TS_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".d.ts", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

export function extractImports(filePath: string, content: string): Omit<ImportEdge, "to" | "external">[] {
  const lang = languageOf(filePath);
  const out: Omit<ImportEdge, "to" | "external">[] = [];
  const lines = content.split("\n");
  const push = (specifier: string, line: number) => {
    if (specifier && out.length < 300) out.push({ from: filePath, specifier, line });
  };

  switch (lang) {
    case "typescript":
      lines.forEach((line, i) => {
        for (const re of TS_IMPORT_RES) for (const m of line.matchAll(re)) push(m[1]!, i + 1);
      });
      break;
    case "python":
      lines.forEach((line, i) => {
        const from = /^\s*from\s+([\w.]+)\s+import\b/.exec(line);
        if (from) return push(from[1]!, i + 1);
        const imp = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/.exec(line);
        if (imp) for (const spec of imp[1]!.split(",")) push(spec.trim().split(/\s+as\s+/)[0]!, i + 1);
      });
      break;
    case "go": {
      let inBlock = false;
      lines.forEach((line, i) => {
        if (/^\s*import\s*\(/.test(line)) return void (inBlock = true);
        if (inBlock && /^\s*\)/.test(line)) return void (inBlock = false);
        const single = /^\s*import\s+(?:\w+\s+)?"([^"]+)"/.exec(line);
        if (single) return push(single[1]!, i + 1);
        if (inBlock) {
          const m = /^\s*(?:[\w.]+\s+)?"([^"]+)"/.exec(line);
          if (m) push(m[1]!, i + 1);
        }
      });
      break;
    }
    case "java":
    case "kotlin":
      lines.forEach((line, i) => {
        const m = /^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;?/.exec(line);
        if (m) push(m[1]!, i + 1);
      });
      break;
    case "csharp":
      lines.forEach((line, i) => {
        const m = /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/.exec(line);
        if (m) push(m[1]!, i + 1);
      });
      break;
    case "rust":
      lines.forEach((line, i) => {
        const use = /^\s*(?:pub\s+)?use\s+([\w:]+)/.exec(line);
        if (use) return push(use[1]!, i + 1);
        const mod = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/.exec(line);
        if (mod) push(`mod:${mod[1]}`, i + 1);
      });
      break;
    case "ruby":
      lines.forEach((line, i) => {
        const m = /^\s*require(_relative)?\s+["']([^"']+)["']/.exec(line);
        if (m) push(`${m[1] ? "rel:" : ""}${m[2]}`, i + 1);
      });
      break;
    case "php":
      lines.forEach((line, i) => {
        const m = /^\s*(?:use|require_once|require|include_once|include)\s+["']?([\w\\\/.-]+)["']?/.exec(line);
        if (m) push(m[1]!, i + 1);
      });
      break;
    default:
      break;
  }
  return out;
}

export interface ResolveContext {
  /** Every path in the repository tree (not only the files read). */
  allPaths: ReadonlySet<string>;
  /** Go module path from go.mod, when present. */
  goModule?: string;
}

/** Resolves import specifiers to repository paths. Anything unresolved is treated as external. */
export function resolveImports(edges: Omit<ImportEdge, "to" | "external">[], ctx: ResolveContext): ImportEdge[] {
  const dirs = new Set<string>();
  for (const p of ctx.allPaths) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  const bySuffix = new Map<string, string[]>();
  for (const p of ctx.allPaths) {
    const base = p.slice(p.lastIndexOf("/") + 1);
    const list = bySuffix.get(base) ?? [];
    list.push(p);
    bySuffix.set(base, list);
  }
  const has = (p: string) => ctx.allPaths.has(p);

  return edges.map((e) => {
    const to = resolveOne(e, { has, dirs, bySuffix, goModule: ctx.goModule });
    return { ...e, to, external: to === null };
  });
}

function resolveOne(
  e: Omit<ImportEdge, "to" | "external">,
  ctx: { has: (p: string) => boolean; dirs: Set<string>; bySuffix: Map<string, string[]>; goModule?: string },
): string | null {
  const lang = languageOf(e.from);
  const dir = path.dirname(e.from);
  const spec = e.specifier;
  const tryTs = (base: string) => {
    for (const ext of TS_EXTS) if (ctx.has(base + ext)) return base + ext;
    return null;
  };

  switch (lang) {
    case "typescript": {
      if (spec.startsWith(".")) return tryTs(path.normalize(path.join(dir, spec)));
      if (spec.startsWith("@/")) return tryTs(spec.slice(2)) ?? tryTs(`src/${spec.slice(2)}`);
      if (spec.startsWith("~/")) return tryTs(spec.slice(2)) ?? tryTs(`src/${spec.slice(2)}`);
      if (spec.startsWith("src/") || spec.startsWith("lib/") || spec.startsWith("app/")) return tryTs(spec);
      return null;
    }
    case "python": {
      if (spec.startsWith(".")) {
        const ups = spec.match(/^\.+/)![0].length;
        let base = dir;
        for (let i = 1; i < ups; i++) base = path.dirname(base);
        const rest = spec.slice(ups).replace(/\./g, "/");
        const target = rest ? path.join(base, rest) : base;
        return firstExisting([`${target}.py`, `${target}/__init__.py`], ctx.has);
      }
      const rel = spec.replace(/\./g, "/");
      return firstExisting([`${rel}.py`, `${rel}/__init__.py`, `src/${rel}.py`, `src/${rel}/__init__.py`, `app/${rel}.py`, `app/${rel}/__init__.py`], ctx.has);
    }
    case "go": {
      if (ctx.goModule && spec.startsWith(ctx.goModule)) {
        const rest = spec.slice(ctx.goModule.length).replace(/^\//, "");
        if (rest === "") return null;
        return ctx.dirs.has(rest) ? rest : null;
      }
      return null;
    }
    case "java":
    case "kotlin": {
      const parts = spec.split(".");
      const cls = parts[parts.length - 1]!;
      const candidates = [...(ctx.bySuffix.get(`${cls}.java`) ?? []), ...(ctx.bySuffix.get(`${cls}.kt`) ?? [])];
      const pkgPath = parts.slice(0, -1).join("/");
      return candidates.find((c) => c.includes(`${pkgPath}/`)) ?? candidates[0] ?? null;
    }
    case "rust": {
      if (spec.startsWith("mod:")) {
        const name = spec.slice(4);
        return firstExisting([path.join(dir, `${name}.rs`), path.join(dir, name, "mod.rs")], ctx.has);
      }
      if (spec.startsWith("crate::")) {
        const segs = spec.slice(7).split("::").filter((s) => s && s !== "self" && s !== "super");
        for (let n = segs.length; n > 0; n--) {
          const base = `src/${segs.slice(0, n).join("/")}`;
          const found = firstExisting([`${base}.rs`, `${base}/mod.rs`], ctx.has);
          if (found) return found;
        }
      }
      return null;
    }
    case "ruby": {
      if (spec.startsWith("rel:")) return firstExisting([path.join(dir, `${spec.slice(4)}.rb`)], ctx.has);
      return firstExisting([`lib/${spec}.rb`, `app/${spec}.rb`], ctx.has);
    }
    case "php": {
      if (spec.includes("/")) return firstExisting([path.normalize(path.join(dir, spec))], ctx.has);
      const cls = spec.split("\\").pop()!;
      return ctx.bySuffix.get(`${cls}.php`)?.[0] ?? null;
    }
    default:
      return null;
  }
}

function firstExisting(candidates: string[], has: (p: string) => boolean): string | null {
  for (const c of candidates) {
    const n = path.normalize(c);
    if (has(n)) return n;
  }
  return null;
}

/** Module path declared in go.mod, if the file is present. */
export function goModuleName(files: ReadonlyMap<string, string>): string | undefined {
  const goMod = files.get("go.mod");
  return goMod ? /^module\s+(\S+)/m.exec(goMod)?.[1] : undefined;
}
