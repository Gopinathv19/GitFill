import type { FileCategory, InventoryEntry } from "../types";
import type { TreeEntry } from "./client";

export interface SelectionLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxFileBytes: number;
}

export const DEFAULT_LIMITS: SelectionLimits = {
  maxFiles: 200,
  maxTotalBytes: 900_000,
  maxFileBytes: 120_000,
};

export interface SelectedPath {
  path: string;
  sizeBytes: number;
  category: FileCategory;
  priority: number;
}

const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "vendor", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", "coverage",
  "__pycache__", ".venv", "venv", "env", ".tox", "target", "bin", "obj", ".idea", ".vscode", ".cache",
  ".turbo", "Pods", ".gradle", "__snapshots__", ".terraform", "site-packages", "bower_components", ".yarn",
]);

const LOCKFILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock", "Cargo.lock", "poetry.lock",
  "Gemfile.lock", "composer.lock", "go.sum", "Pipfile.lock", "uv.lock", "flake.lock", "mix.lock",
]);

const SECRET_PATTERNS = [
  /^\.env(\..*)?$/i, /\.pem$/i, /\.key$/i, /^id_(rsa|dsa|ecdsa|ed25519)/i, /\.p12$/i, /\.pfx$/i,
  /^credentials.*\.json$/i, /^secrets?\.(json|ya?ml|toml)$/i, /^\.npmrc$/i, /^\.pypirc$/i, /^\.netrc$/i,
  /service[-_]?account.*\.json$/i, /\.keystore$/i, /\.jks$/i,
];

const BINARY_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "tiff", "psd", "woff", "woff2", "ttf", "otf", "eot",
  "zip", "tar", "gz", "tgz", "bz2", "7z", "rar", "jar", "war", "pdf", "mp3", "mp4", "mov", "avi", "webm", "wav",
  "ogg", "exe", "dll", "so", "dylib", "a", "o", "wasm", "class", "pyc", "pyo", "db", "sqlite", "sqlite3", "bin",
  "dat", "parquet", "onnx", "pt", "pth", "ckpt", "safetensors", "h5", "pkl", "npy", "ipynb", "pptx", "docx", "xlsx",
]);

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt", "kts", "scala", "rb", "php", "cs",
  "fs", "swift", "m", "mm", "c", "h", "cc", "cpp", "hpp", "ex", "exs", "erl", "clj", "dart", "lua", "r",
  "vue", "svelte", "astro", "sql", "graphql", "gql", "proto", "sh", "bash", "zig", "nim", "hs", "ml", "elm",
]);

const MANIFESTS = new Set([
  "package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "pom.xml", "build.gradle",
  "build.gradle.kts", "settings.gradle", "Gemfile", "composer.json", "setup.py", "setup.cfg", "Pipfile",
  "mix.exs", "pubspec.yaml", "deno.json", "turbo.json", "pnpm-workspace.yaml", "lerna.json", "nx.json",
]);

const DEPLOY_FILES = new Set([
  "Procfile", "fly.toml", "vercel.json", "netlify.toml", "app.yaml", "render.yaml", "railway.json", "railway.toml",
  "skaffold.yaml", "serverless.yml", "serverless.yaml", "cloudbuild.yaml", "app.json", "Makefile", "Justfile",
]);

const CONFIG_RE = /^(tsconfig.*\.json|next\.config\.\w+|vite\.config\.\w+|webpack\.config\.\w+|nuxt\.config\.\w+|svelte\.config\.\w+|astro\.config\.\w+|drizzle\.config\.\w+|tailwind\.config\.\w+|babel\.config\.\w+|jest\.config\.\w+|vitest\.config\.\w+|\.env\.example|\.env\.sample|nginx\.conf|settings\.py|config\.(ya?ml|toml|json))$/i;

const CATEGORY_CAPS: Partial<Record<FileCategory, number>> = {
  test: 10, docs: 15, config: 12, infrastructure: 15, manifest: 12, deployment: 10, entrypoint: 30,
};

/** Folders that rarely explain the core system; their files are heavily down-ranked. */
const PERIPHERAL_DIR_RE = /(^|\/)(benchmarks?|examples?|samples?|fixtures?|demos?|playground|runtime-tests|e2e|scripts|\.github\/(?!workflows))\//i;
/** Re-export "barrel" files this small carry almost no information. */
const BARREL_MAX_BYTES = 400;

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Returns why a path must never be read, or undefined if it is eligible. */
export function exclusionReason(path: string): string | undefined {
  const parts = path.split("/");
  const name = parts[parts.length - 1]!;
  if (parts.slice(0, -1).some((p) => EXCLUDED_DIRS.has(p))) return "excluded_directory";
  if (SECRET_PATTERNS.some((re) => re.test(name)) && !/\.(example|sample|template)$/i.test(name)) return "possible_secret";
  if (LOCKFILES.has(name)) return "lockfile";
  if (/\.min\.(js|css)$/i.test(name) || /\.map$/i.test(name) || /\.generated\./i.test(name) || /\.pb\.go$/.test(name)) {
    return "generated";
  }
  if (BINARY_EXT.has(extension(name))) return "binary_or_asset";
  return undefined;
}

/** Classifies an eligible path and scores how useful it is for understanding the system. */
export function classify(path: string): { category: FileCategory; priority: number } | undefined {
  const parts = path.split("/");
  const name = parts[parts.length - 1]!;
  const lower = path.toLowerCase();
  const depth = parts.length - 1;
  const ext = extension(name);
  const depthPenalty = Math.min(depth * 4, 24);

  if (/^readme(\.\w+)?$/i.test(name)) return { category: "docs", priority: depth === 0 ? 100 : 55 - depthPenalty };
  if (/^(architecture|design|overview)\.md$/i.test(name)) return { category: "docs", priority: 90 };
  if (MANIFESTS.has(name) || ext === "csproj") return { category: "manifest", priority: 95 - depthPenalty };
  if (/^dockerfile/i.test(name) || /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(name) || DEPLOY_FILES.has(name)) {
    return { category: "deployment", priority: 85 - depthPenalty / 2 };
  }
  if (lower.startsWith(".github/workflows/") && /\.ya?ml$/.test(name)) return { category: "deployment", priority: 70 };
  if (ext === "tf" || ext === "hcl" || /(^|\/)(k8s|kubernetes|helm|charts|deploy|infra|terraform)\//.test(lower)) {
    if (["tf", "hcl", "yaml", "yml", "json", "tpl"].includes(ext)) return { category: "infrastructure", priority: 65 - depthPenalty / 2 };
  }
  if (CONFIG_RE.test(name)) return { category: "config", priority: 50 - depthPenalty };

  const isCode = CODE_EXT.has(ext) || name === "schema.prisma";
  if (ext === "md" || ext === "mdx" || ext === "rst") {
    return /(^|\/)docs?\//.test(lower) ? { category: "docs", priority: 45 - depthPenalty } : undefined;
  }
  if (/^openapi.*\.(ya?ml|json)$/i.test(name) || /^swagger.*\.(ya?ml|json)$/i.test(name)) return { category: "api", priority: 85 };
  if (!isCode) return undefined;

  if (/(^|\/)(tests?|__tests__|spec|e2e)\//.test(lower) || /\.(test|spec)\.\w+$/.test(name) || /^test_.*\.py$/.test(name)) {
    return { category: "test", priority: 20 - depthPenalty / 2 };
  }
  if (name === "schema.prisma" || /(^|\/)(migrations?|models?|entities|schema|db|database|prisma)\//.test(lower) || /schema\.\w+$/.test(name) || ext === "sql") {
    return { category: "database", priority: 78 - depthPenalty / 2 };
  }
  if (/(^|\/)(api|routes?|controllers?|handlers?|endpoints?|resolvers?|views)\//.test(lower) || /^route\.\w+$/.test(name) || ext === "proto" || ext === "graphql") {
    return { category: "api", priority: 75 - depthPenalty / 2 };
  }
  const stem = name.replace(/\.\w+$/, "");
  if (["main", "index", "app", "server", "cli", "__main__", "manage", "wsgi", "asgi", "program", "lib", "mod"].includes(stem) || /^cmd\/[^/]+\/main\.go$/.test(path)) {
    return { category: "entrypoint", priority: 82 - depthPenalty };
  }
  return { category: "source", priority: 40 - depthPenalty };
}

/**
 * Chooses which repository files to read within the configured budget.
 * Highest-priority files first; shallow and small files win ties.
 */
export function selectFiles(entries: TreeEntry[], limits: SelectionLimits = DEFAULT_LIMITS) {
  const inventory: InventoryEntry[] = [];
  const candidates: SelectedPath[] = [];

  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    const size = entry.size ?? 0;
    const reason = exclusionReason(entry.path);
    if (reason) {
      inventory.push({ path: entry.path, sizeBytes: size, selected: false, skipReason: reason });
      continue;
    }
    const cls = classify(entry.path);
    if (!cls) {
      inventory.push({ path: entry.path, sizeBytes: size, selected: false, skipReason: "unsupported_type" });
      continue;
    }
    if (size > limits.maxFileBytes) {
      inventory.push({ path: entry.path, sizeBytes: size, selected: false, skipReason: "too_large" });
      continue;
    }
    if (size === 0) {
      inventory.push({ path: entry.path, sizeBytes: size, selected: false, skipReason: "empty" });
      continue;
    }
    let priority = cls.priority;
    if (PERIPHERAL_DIR_RE.test(entry.path) && cls.category !== "deployment") priority -= 40;
    if (cls.category === "entrypoint" && size < BARREL_MAX_BYTES) priority = Math.min(priority, 15);
    candidates.push({ path: entry.path, sizeBytes: size, category: cls.category, priority });
  }

  candidates.sort(
    (a, b) => b.priority - a.priority || a.path.split("/").length - b.path.split("/").length || a.sizeBytes - b.sizeBytes,
  );

  const selected: SelectedPath[] = [];
  const perCategory = new Map<FileCategory, number>();
  let totalBytes = 0;
  for (const c of candidates) {
    const cap = CATEGORY_CAPS[c.category];
    const count = perCategory.get(c.category) ?? 0;
    let skipReason: string | undefined;
    if (selected.length >= limits.maxFiles) skipReason = "file_budget";
    else if (totalBytes + c.sizeBytes > limits.maxTotalBytes) skipReason = "byte_budget";
    else if (cap !== undefined && count >= cap) skipReason = "category_cap";

    if (skipReason) {
      inventory.push({ path: c.path, sizeBytes: c.sizeBytes, selected: false, skipReason });
    } else {
      selected.push(c);
      perCategory.set(c.category, count + 1);
      totalBytes += c.sizeBytes;
      inventory.push({ path: c.path, sizeBytes: c.sizeBytes, selected: true });
    }
  }

  inventory.sort((a, b) => a.path.localeCompare(b.path));
  return { selected, inventory, totalBytes };
}

export function languageStats(entries: TreeEntry[]): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const e of entries) {
    if (e.type !== "blob" || exclusionReason(e.path)) continue;
    const ext = extension(basename(e.path));
    if (CODE_EXT.has(ext)) stats[ext] = (stats[ext] ?? 0) + (e.size ?? 0);
  }
  return stats;
}
