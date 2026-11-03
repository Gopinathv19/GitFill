import type { SourceFile } from "@/lib/connectors/types";
import { redactText } from "@/lib/presentation/redact";

/**
 * "How to run it" facts read from manifests and config files: package.json scripts, pyproject,
 * requirements, Django, Makefile targets, Dockerfiles, Compose services, go.mod, Cargo.toml,
 * Procfile and the variable names in .env.example. Getting-started slides may only show commands
 * that appear in the evidence, so these lines quote real commands verbatim and cite their file.
 * Parsing is line based and forgiving: a malformed file is skipped, never thrown on.
 */

const MAX_PACKAGES = 6;
const MAX_SCRIPTS = 12;
const MAX_BINS = 5;
const MAX_WORKSPACES = 6;
const MAX_PYPROJECTS = 3;
const MAX_PY_SCRIPTS = 10;
const MAX_REQUIREMENTS = 4;
const MAX_PY_SERVERS = 6;
const MAX_GO_MODULES = 3;
const MAX_GO_MAINS = 6;
const MAX_CRATES = 3;
const MAX_MAKEFILES = 3;
const MAX_TARGETS = 12;
const MAX_DOCKERFILES = 4;
const MAX_IMAGES = 4;
const MAX_COMPOSE_FILES = 3;
const MAX_SERVICES = 15;
const MAX_PORTS = 6;
const MAX_PROCESSES = 10;
const MAX_ENV = 30;
/** Commands longer than this are cut with "…" so one script cannot flood the prompt. */
const MAX_COMMAND = 140;
/** Per-section ceiling, so one busy monorepo section cannot crowd out Docker or env facts. */
const MAX_SECTION = 3_500;
/** Hard ceiling for the whole block, a backstop behind the per-list and per-section caps. */
const MAX_TOTAL = 12_000;

/** "" when no manifest or config file says anything about running the project. */
export function runFacts(files: SourceFile[]): string {
  const sorted = [...files].sort(byDepth);
  const procfiles = sorted.filter((f) => /^Procfile(\.[\w-]+)?$/.test(base(f.path))).map((f) => ({ path: f.path, processes: safe(() => procfileProcesses(f.content), []) }));
  const dockerfiles = sorted.filter((f) => isDockerfile(f.path)).map((f) => ({ path: f.path, ...safe(() => parseDockerfile(f.content), { stages: [], commands: [] }) }));
  const composes = sorted.filter((f) => isComposeFile(f.path)).map((f) => ({ path: f.path, services: safe(() => composeServices(f.content), []) }));

  const sections = [
    safe(() => nodeFacts(sorted), ""),
    safe(() => pythonFacts(sorted, { procfiles, dockerfiles, composes }), ""),
    safe(() => goFacts(sorted), ""),
    safe(() => rustFacts(sorted), ""),
    safe(() => makeFacts(sorted), ""),
    safe(() => dockerFacts(dockerfiles), ""),
    safe(() => composeFacts(composes), ""),
    safe(() => procfileFacts(procfiles), ""),
    safe(() => envFacts(sorted), ""),
  ].filter(Boolean);
  if (!sections.length) return "";
  // Scripts, recipes and Compose commands are quoted verbatim and sometimes inline a credential
  // ("DATABASE_URL=postgres://u:pw@… node seed.js"); the prompt goes to a model, so mask it here.
  return bounded(redactText(`How to run it, from manifests and config files (run each command from the folder of the file it cites):\n\n${sections.join("\n\n")}`).text);
}

// ---------------------------------------------------------------- Node.js

interface PackageManager {
  name: string;
  version?: string;
  /** The package.json that declares it: workspaces inherit the root's packageManager. */
  from: string;
}

/**
 * Script families in the order a getting-started slide needs them. Exact names ("dev") come
 * before their variants ("dev:web"); everything else keeps its declaration order.
 */
const SCRIPT_PRIORITY = [
  /^dev(?:[:._-]|$)/,
  /^start(?:[:._-]|$)/,
  /^build(?:[:._-]|$)/,
  /^test(?:[:._-]|$)/,
  /^lint(?:[:._-]|$)/,
  /^(?:db|migrate|migrations?)(?:[:._-]|$)|migrat/,
  /^workers?(?:[:._-]|$)/,
];

function nodeFacts(files: SourceFile[]): string {
  const manifests = files
    .filter((f) => base(f.path) === "package.json")
    .map((f) => ({ path: f.path, json: parseJsonObject(f.content) }))
    .filter((m): m is { path: string; json: Record<string, unknown> } => m.json !== undefined);
  const managers = new Map<string, PackageManager>();
  for (const m of manifests) {
    const pm = packageManager(m.json.packageManager, m.path);
    if (pm) managers.set(dirOf(m.path), pm);
  }
  const blocks = manifests.map((m) => packageLines(m.path, m.json, inheritedManager(m.path, managers))).filter((b) => b.length);
  // The package count lives in the header so it survives the section budget.
  const shown = blocks.length > MAX_PACKAGES ? `; first ${MAX_PACKAGES} of ${blocks.length} package.json files` : "";
  return section(`Node.js packages (package.json; scripts quoted verbatim${shown}):`, blocks.slice(0, MAX_PACKAGES).flat());
}

function packageLines(path: string, json: Record<string, unknown>, pm: PackageManager | undefined): string[] {
  const scripts = isRecord(json.scripts)
    ? orderScripts(Object.entries(json.scripts).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== ""))
    : [];
  const bins = binEntries(json);
  const node = isRecord(json.engines) && typeof json.engines.node === "string" ? json.engines.node : undefined;
  const workspaces = workspaceGlobs(json.workspaces);
  // A package.json with only a name tells nobody how to run anything.
  if (!scripts.length && !bins.length && !node && !workspaces.length && !(pm && pm.from === path)) return [];

  const meta: string[] = [];
  if (typeof json.name === "string" && json.name.trim()) meta.push(`package "${clip(json.name, 80)}"`);
  if (pm) meta.push(`package manager ${pm.name}${pm.version ? ` ${pm.version}` : ""}${pm.from === path ? "" : ` (packageManager in ${pm.from})`}`);
  if (node) meta.push(`Node ${clip(node, 40)}`);
  if (workspaces.length) {
    const extra = workspaces.length - MAX_WORKSPACES;
    meta.push(`workspaces ${workspaces.slice(0, MAX_WORKSPACES).join(", ")}${extra > 0 ? ` …and ${extra} more` : ""}`);
  }
  const runner = `${pm?.name ?? "npm"} run`;
  return [
    ...(meta.length ? [`- ${path}: ${meta.join(", ")}`] : []),
    ...capped(scripts.map(([name, cmd]) => `- ${runner} ${name} → ${clip(cmd)} (${path})`), MAX_SCRIPTS, `scripts in ${path}`),
    ...capped(bins.map(([name, target]) => `- command ${name} → ${clip(target, 80)} (${path} "bin")`), MAX_BINS, `commands in ${path}`),
  ];
}

function orderScripts(scripts: [string, string][]): [string, string][] {
  const rank = (name: string) => {
    const i = SCRIPT_PRIORITY.findIndex((re) => re.test(name));
    return i < 0 ? SCRIPT_PRIORITY.length : i;
  };
  const variant = (name: string) => (/[:._-]/.test(name) ? 1 : 0);
  // Array.prototype.sort is stable, so ties keep the order the author declared them in.
  return [...scripts].sort((a, b) => rank(a[0]) - rank(b[0]) || variant(a[0]) - variant(b[0]));
}

/** Only the explicit packageManager field counts: lockfiles are never in the snapshot. */
function packageManager(value: unknown, from: string): PackageManager | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^(npm|pnpm|yarn|bun)(?:@([^+\s]+))?/.exec(value.trim());
  return m ? { name: m[1]!, version: m[2], from } : undefined;
}

function inheritedManager(path: string, managers: Map<string, PackageManager>): PackageManager | undefined {
  let dir = dirOf(path);
  for (;;) {
    const pm = managers.get(dir);
    if (pm) return pm;
    if (!dir) return undefined;
    const parent = dir.replace(/[^/]*\/$/, "");
    // "/package.json" or "a//b/package.json": stop rather than loop when no parent can be cut off.
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function binEntries(json: Record<string, unknown>): [string, string][] {
  if (typeof json.bin === "string" && typeof json.name === "string" && json.name) {
    return [[json.name.replace(/^@[^/]+\//, ""), json.bin]];
  }
  if (!isRecord(json.bin)) return [];
  return Object.entries(json.bin).filter((e): e is [string, string] => typeof e[1] === "string");
}

function workspaceGlobs(value: unknown): string[] {
  const list = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.packages) ? value.packages : [];
  return list.filter((w): w is string => typeof w === "string").map((w) => clip(w, 60));
}

// ---------------------------------------------------------------- Python

/** Commands that start a Python web app or worker, looked for in Procfile, Dockerfile and Compose. */
const PY_SERVER_RE = /\b(?:uvicorn|gunicorn|hypercorn|daphne|granian|celery|flask\s+run|fastapi\s+(?:run|dev)|streamlit\s+run)\b/;

const PY_SCRIPT_TABLES: { table: string; run: string }[] = [
  { table: "project.scripts", run: "" },
  { table: "tool.poetry.scripts", run: "poetry run " },
  { table: "tool.pdm.scripts", run: "pdm run " },
  { table: "tool.poe.tasks", run: "poe " },
];

interface Parsed {
  procfiles: { path: string; processes: [string, string][] }[];
  dockerfiles: ({ path: string } & DockerfileInfo)[];
  composes: { path: string; services: ComposeService[] }[];
}

function pythonFacts(files: SourceFile[], parsed: Parsed): string {
  const lines: string[] = [];
  for (const f of files.filter((x) => base(x.path) === "pyproject.toml").slice(0, MAX_PYPROJECTS)) {
    lines.push(...safe(() => pyprojectLines(f), []));
  }
  const requirements = files.filter((f) => /^requirements[\w.-]*\.txt$/i.test(base(f.path))).map((f) => {
    const count = f.content.split(/\r?\n/).filter((l) => /^[A-Za-z0-9]/.test(l.trim())).length;
    return `- pip install -r ${base(f.path)} (${f.path}${count ? `, ${count} package${count === 1 ? "" : "s"}` : ""})`;
  });
  lines.push(...capped(requirements, MAX_REQUIREMENTS, "requirements files"));
  for (const f of files.filter((x) => base(x.path) === "manage.py" && /django/i.test(x.content)).slice(0, 2)) {
    lines.push(`- python manage.py runserver (Django, ${f.path})`);
  }
  lines.push(...capped(pythonServers(parsed), MAX_PY_SERVERS, "Python server commands"));
  return section("Python:", lines);
}

function pyprojectLines(f: SourceFile): string[] {
  const toml = tomlTables(f.content);
  const name = tomlValue(toml, "project", "name") ?? tomlValue(toml, "tool.poetry", "name");
  const python = tomlValue(toml, "project", "requires-python") ?? tomlValue(toml, "tool.poetry.dependencies", "python");
  const tooling = (["poetry", "uv", "pdm", "hatch"] as const).find((t) => hasTable(toml, `tool.${t}`));
  const meta = [
    name ? `project "${clip(name, 80)}"` : "",
    python ? `Python ${clip(python, 40)}` : "",
    tooling ? `uses ${tooling} ([tool.${tooling}])` : "",
  ].filter(Boolean);
  const scripts = PY_SCRIPT_TABLES.flatMap(({ table, run }) =>
    (toml.get(table) ?? [])
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, value]) => `- ${run}${key} → ${clip(value)} (${run ? "" : "console script, "}${f.path} [${table}])`),
  );
  return [...(meta.length ? [`- ${f.path}: ${meta.join(", ")}`] : []), ...capped(scripts, MAX_PY_SCRIPTS, `scripts in ${f.path}`)];
}

function pythonServers(parsed: Parsed): string[] {
  const out = new Set<string>();
  for (const p of parsed.procfiles) {
    for (const [type, cmd] of p.processes) if (PY_SERVER_RE.test(cmd)) out.add(`- ${clip(cmd)} (${p.path}, ${type} process)`);
  }
  for (const d of parsed.dockerfiles) {
    for (const c of d.commands) {
      const cmd = shellForm(c.args);
      if (PY_SERVER_RE.test(cmd)) out.add(`- ${clip(cmd)} (${d.path} ${c.op})`);
    }
  }
  for (const c of parsed.composes) {
    for (const s of c.services) if (s.command && PY_SERVER_RE.test(s.command)) out.add(`- ${clip(s.command)} (${c.path}, service ${s.name})`);
  }
  return [...out];
}

// ---------------------------------------------------------------- Go and Rust

function goFacts(files: SourceFile[]): string {
  const modules = files
    .filter((f) => base(f.path) === "go.mod")
    .map((f) => ({
      path: f.path,
      dir: dirOf(f.path),
      module: /^\s*module\s+(\S+)/m.exec(f.content)?.[1],
      go: /^\s*go\s+(\d[\w.]*)/m.exec(f.content)?.[1],
      toolchain: /^\s*toolchain\s+(\S+)/m.exec(f.content)?.[1],
    }));
  if (!modules.length) return "";
  const lines: string[] = [];
  for (const m of modules.slice(0, MAX_GO_MODULES)) {
    const meta = [m.module ? `module ${m.module}` : "", m.go ? `go ${m.go}` : "", m.toolchain ? `toolchain ${m.toolchain}` : ""].filter(Boolean);
    if (meta.length) lines.push(`- ${m.path}: ${meta.join(", ")}`);
  }
  // `go run ./dir` works for any package main inside the module, so these commands are true by construction.
  const mains = new Map<string, string>();
  for (const f of files) {
    if (!f.path.endsWith(".go") || !/^package\s+main\b/m.test(f.content) || !/^func\s+main\s*\(\s*\)/m.test(f.content)) continue;
    // Generator scripts ("//go:build ignore", run as `go run gen.go`) are not the directory's package.
    if (/^\/\/(?:go:build|\s*\+build)\s+ignore\b/m.test(f.content)) continue;
    const owner = modules.filter((m) => f.path.startsWith(m.dir)).sort((a, b) => b.dir.length - a.dir.length)[0];
    if (!owner) continue;
    const rel = dirOf(f.path).slice(owner.dir.length).replace(/\/$/, "");
    const cmd = `go run ${rel ? `./${rel}` : "."}`;
    if (!mains.has(`${owner.path} ${cmd}`)) mains.set(`${owner.path} ${cmd}`, `- ${cmd} (${owner.path}; package main in ${f.path})`);
  }
  lines.push(...capped([...mains.values()], MAX_GO_MAINS, "main packages"));
  return section("Go:", lines);
}

function rustFacts(files: SourceFile[]): string {
  const paths = new Set(files.map((f) => f.path));
  const lines: string[] = [];
  for (const f of files.filter((x) => base(x.path) === "Cargo.toml").slice(0, MAX_CRATES)) {
    const toml = tomlTables(f.content);
    const name = tomlValue(toml, "package", "name");
    const edition = tomlValue(toml, "package", "edition");
    const rust = tomlValue(toml, "package", "rust-version");
    const meta = [name ? `crate "${clip(name, 80)}"` : "", edition ? `edition ${edition}` : "", rust ? `Rust ${rust}` : "", hasTable(toml, "workspace") ? "Cargo workspace" : ""].filter(Boolean);
    if (meta.length) lines.push(`- ${f.path}: ${meta.join(", ")}`);
    const bins = (toml.get("bin") ?? []).filter(([key]) => key === "name").map(([, value]) => value);
    if (bins.length) lines.push(...capped(bins.map((b) => `- cargo run --bin ${b} (${f.path} [[bin]])`), MAX_BINS, `binaries in ${f.path}`));
    else if (name && paths.has(`${dirOf(f.path)}src/main.rs`)) lines.push(`- cargo run (${f.path}; binary in ${dirOf(f.path)}src/main.rs)`);
  }
  return section("Rust:", lines);
}

// ---------------------------------------------------------------- Makefile

interface MakeTarget {
  name: string;
  deps: string;
  recipe?: string;
  help?: string;
}

function makeFacts(files: SourceFile[]): string {
  const makefiles = files.filter((f) => /^(GNUmakefile|[Mm]akefile)$/.test(base(f.path)));
  const lines: string[] = [];
  for (const f of makefiles.slice(0, MAX_MAKEFILES)) {
    const targets = safe(() => makeTargets(f.content), []).map((t) => {
      const body = t.recipe ? ` → ${clip(t.recipe, 100)}` : t.deps ? ` → runs targets: ${clip(t.deps, 80)}` : "";
      return `- make ${t.name}${body} (${f.path}${t.help ? `; "${clip(t.help, 80)}"` : ""})`;
    });
    lines.push(...capped(targets, MAX_TARGETS, `targets in ${f.path}`));
  }
  if (makefiles.length > MAX_MAKEFILES) lines.push(`- …and ${makefiles.length - MAX_MAKEFILES} more Makefiles`);
  return section("Make targets (first recipe line shown):", lines);
}

/**
 * Explicit targets in file order with their first recipe line. Special targets (.PHONY), pattern
 * rules (%.o) and variable-named targets ($(BIN)) are skipped: none is something a reader types.
 */
function makeTargets(content: string): MakeTarget[] {
  const lines = content.split(/\r?\n/);
  const out: MakeTarget[] = [];
  const seen = new Set<string>();
  let inDefine = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*define\b/.test(line)) inDefine = true;
    if (inDefine) {
      if (/^\s*endef\b/.test(line)) inDefine = false;
      continue;
    }
    const m = /^([A-Za-z0-9_][\w.\-\/]*(?:[ \t]+[A-Za-z0-9_][\w.\-\/]*)*)[ \t]*::?(.*)$/.exec(line);
    if (!m) continue;
    const rest = m[2]!;
    // ":=" / "::=" assignments and target-specific variables ("build: CFLAGS += -O2").
    if (/^:?=/.test(rest) || /^\s*[\w.-]+\s*[:+?!]?=/.test(rest)) continue;
    const semi = rest.indexOf(";");
    const head = semi >= 0 ? rest.slice(0, semi) : rest;
    const help = /##\s*(.+)$/.exec(head)?.[1]?.trim();
    const deps = head.replace(/#.*$/, "").trim();
    const recipe = semi >= 0 ? rest.slice(semi + 1).trim() || undefined : firstRecipeLine(lines, i + 1);
    for (const name of m[1]!.split(/\s+/)) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, deps, recipe, help });
    }
  }
  return out;
}

function firstRecipeLine(lines: string[], from: number): string | undefined {
  for (let j = from; j < lines.length; j++) {
    const line = lines[j]!;
    if (line.startsWith("\t")) {
      const text = line.trim().replace(/^[@+-]+/, "").trim();
      if (!text || text.startsWith("#")) continue;
      return text.endsWith("\\") ? `${text.slice(0, -1).trimEnd()} …` : text;
    }
    if (line.trim() && !line.startsWith("#")) return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------- Docker

interface DockerStage {
  image: string;
  name?: string;
  expose: string[];
  cmd?: string;
  entrypoint?: string;
}

interface DockerfileInfo {
  stages: DockerStage[];
  /** Every CMD and ENTRYPOINT in the file, in any stage, for spotting server commands. */
  commands: { op: string; args: string }[];
}

function isDockerfile(path: string): boolean {
  const name = base(path);
  return /^dockerfile(\.[\w.-]+)?$/i.test(name) || /\.dockerfile$/i.test(name);
}

function parseDockerfile(content: string): DockerfileInfo {
  const stages: DockerStage[] = [];
  const commands: { op: string; args: string }[] = [];
  for (const { op, args } of dockerInstructions(content)) {
    if (op === "FROM") {
      const tokens = args.split(/\s+/).filter((t) => t && !t.startsWith("--"));
      if (tokens[0]) stages.push({ image: tokens[0], name: tokens[1]?.toLowerCase() === "as" ? tokens[2]?.toLowerCase() : undefined, expose: [] });
      continue;
    }
    const stage = stages[stages.length - 1];
    if (!stage) continue;
    if (op === "EXPOSE") stage.expose.push(...args.split(/\s+/).filter(Boolean));
    else if (op === "CMD" || op === "ENTRYPOINT") {
      commands.push({ op, args });
      if (op === "CMD") stage.cmd = args;
      else stage.entrypoint = args;
    }
  }
  return { stages, commands };
}

/** Instructions with line continuations joined; comments and blank lines dropped. */
function dockerInstructions(content: string): { op: string; args: string }[] {
  const out: { op: string; args: string }[] = [];
  let buffer = "";
  const flush = () => {
    const m = /^([A-Za-z]+)\s+([\s\S]*)$/.exec(buffer.trim());
    if (m) out.push({ op: m[1]!.toUpperCase(), args: m[2]!.replace(/\s+/g, " ").trim() });
    buffer = "";
  };
  // Heredoc bodies (RUN python3 <<EOF … EOF) are script text: "from pathlib import Path" is no FROM.
  let heredocs: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (heredocs.length) {
      if (line === heredocs[0]) heredocs.shift();
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    if (line.endsWith("\\")) {
      buffer += `${line.slice(0, -1)} `;
      continue;
    }
    buffer += line;
    heredocs = [...buffer.matchAll(/<<-?["']?([A-Za-z_]\w*)["']?/g)].map((m) => m[1]!);
    flush();
  }
  if (buffer.trim()) flush();
  return out;
}

/**
 * What the built image runs: the final stage, inheriting from earlier stages it is built FROM.
 * An ENTRYPOINT resets an inherited CMD, as Docker does. A CMD inside an external base image is
 * unknown, so nothing is claimed for it.
 */
function finalStage(stages: DockerStage[]): { expose: string[]; cmd?: string; entrypoint?: string } {
  let stage: DockerStage | undefined = stages[stages.length - 1];
  const expose: string[] = [];
  let cmd: string | undefined;
  let entrypoint: string | undefined;
  let cmdDone = false;
  let entrypointDone = false;
  const visited = new Set<DockerStage>();
  while (stage && !visited.has(stage)) {
    visited.add(stage);
    for (const p of stage.expose) if (!expose.includes(p)) expose.push(p);
    if (!cmdDone && stage.cmd) {
      cmd = stage.cmd;
      cmdDone = true;
    }
    if (!entrypointDone && stage.entrypoint) {
      entrypoint = stage.entrypoint;
      entrypointDone = true;
      cmdDone = true;
    }
    const parent = stage.image.toLowerCase();
    const index = stages.indexOf(stage);
    stage = stages.slice(0, index).reverse().find((s) => s.name === parent);
  }
  return { expose, cmd, entrypoint };
}

function dockerFacts(dockerfiles: ({ path: string } & DockerfileInfo)[]): string {
  const lines: string[] = [];
  const withStages = dockerfiles.filter((d) => d.stages.length);
  for (const d of withStages.slice(0, MAX_DOCKERFILES)) {
    const stageNames = new Set(d.stages.map((s) => s.name).filter(Boolean));
    const images = [...new Set(d.stages.map((s) => s.image).filter((img) => !stageNames.has(img.toLowerCase())))];
    const final = finalStage(d.stages);
    const parts = [
      images.length
        ? `FROM ${images.slice(0, MAX_IMAGES).join(", ")}${images.length > MAX_IMAGES ? ` …and ${images.length - MAX_IMAGES} more` : ""}${d.stages.length > 1 ? ` (${d.stages.length} stages)` : ""}`
        : "",
      final.expose.length ? `EXPOSE ${final.expose.slice(0, MAX_PORTS).join(" ")}` : "",
      final.entrypoint ? `ENTRYPOINT ${clip(final.entrypoint)}` : "",
      final.cmd ? `CMD ${clip(final.cmd)}` : "",
    ].filter(Boolean);
    lines.push(`- ${d.path}: ${parts.join("; ")}`);
  }
  if (withStages.length > MAX_DOCKERFILES) lines.push(`- …and ${withStages.length - MAX_DOCKERFILES} more Dockerfiles`);
  return section("Docker images (Dockerfile instructions quoted; CMD and EXPOSE are the final image's):", lines);
}

/** Exec-form ["a", "b"] as the command line it runs; shell form unchanged. */
function shellForm(args: string): string {
  if (!args.startsWith("[")) return args;
  try {
    const parsed: unknown = JSON.parse(args);
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) return parsed.join(" ");
  } catch {
    // Not valid JSON: Docker runs it in shell form, and so do we.
  }
  return args;
}

// ---------------------------------------------------------------- Docker Compose

interface ComposeService {
  name: string;
  image?: string;
  /** Build context; "" when the service builds but the context is not a plain value. */
  build?: string;
  ports: string[];
  command?: string;
}

const DEFAULT_COMPOSE = new Set(["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"]);
const COMPOSE_TOP_LEVEL = new Set(["version", "name", "services", "volumes", "networks", "configs", "secrets", "include"]);

function isComposeFile(path: string): boolean {
  return /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(base(path));
}

interface YamlLine {
  indent: number;
  text: string;
}

/** Non-blank, non-comment lines with their indentation and trailing comments removed. */
function yamlLines(content: string): YamlLine[] {
  const out: YamlLine[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const text = raw.replace(/\s+#.*$/, "").trim();
    if (!text || text.startsWith("#") || text === "---" || text === "...") continue;
    out.push({ indent: /^[ \t]*/.exec(raw)![0].length, text });
  }
  return out;
}

function yamlKey(text: string): { key: string; value?: string } | undefined {
  const m = /^["']?([\w.\-\/]+)["']?\s*:(?:[ \t]+(.*))?$/.exec(text);
  return m ? { key: m[1]!, value: m[2]?.trim() || undefined } : undefined;
}

function yamlScalar(value: string): string {
  const v = value.trim();
  const quoted = /^"(.*)"$/.exec(v) ?? /^'(.*)'$/.exec(v);
  return (quoted ? quoted[1]! : v).trim();
}

function inlineList(value: string): string[] {
  const m = /^\[(.*)\]$/.exec(value.trim());
  return m ? m[1]!.split(",").map(yamlScalar).filter(Boolean) : [];
}

function commandText(value: string): string | undefined {
  if (/^[|>][-+]?$/.test(value)) return undefined;
  if (value.startsWith("[")) {
    const items = inlineList(value);
    return items.length ? items.join(" ") : undefined;
  }
  return yamlScalar(value) || undefined;
}

/**
 * Services from an indent-based line scan, no YAML parser: name, image or build context, ports
 * (short "8080:80" and long target/published syntax) and an inline command. Files without a
 * top-level "services:" are read as the legacy v1 format, where services are top-level keys.
 * One level of YAML merge keys ("<<: *app" from an "x-app: &app" block) is resolved, since
 * Compose files often share one image definition across web and worker services.
 */
function composeServices(content: string): ComposeService[] {
  const lines = yamlLines(content);
  const servicesAt = lines.findIndex((l) => l.indent === 0 && /^services\s*:\s*$/.test(l.text));
  // Every top-level block, for anchors; it is also the service list of a legacy file.
  const topLevel = scanBlocks(lines);
  let services: RawService[];
  if (servicesAt < 0) {
    services = topLevel.filter((s) => !COMPOSE_TOP_LEVEL.has(s.name) && !s.name.startsWith("x-") && (s.image !== undefined || s.build !== undefined || s.merges.length));
  } else {
    const rest = lines.slice(servicesAt + 1);
    const end = rest.findIndex((l) => l.indent === 0);
    services = scanBlocks(end < 0 ? rest : rest.slice(0, end));
  }
  const anchors = new Map<string, RawService>();
  for (const s of [...topLevel, ...services]) if (s.anchor) anchors.set(s.anchor, s);
  return services.map((raw) => {
    const service: ComposeService = { name: raw.name, image: raw.image, build: raw.build, ports: raw.ports, command: raw.command };
    for (const ref of raw.merges) {
      const shared = anchors.get(ref);
      if (!shared) continue;
      // Keys written on the service itself win over merged ones, as in YAML.
      service.image ??= shared.image;
      service.build ??= shared.build;
      service.command ??= shared.command;
      if (!service.ports.length) service.ports = [...shared.ports];
    }
    return service;
  });
}

interface RawService extends ComposeService {
  /** "&app" on the block's key line. */
  anchor?: string;
  /** "<<: *app" merge references. */
  merges: string[];
}

/** Blocks keyed at the shallowest indent of `block`, with the properties Compose facts use. */
function scanBlocks(block: YamlLine[]): RawService[] {
  if (!block.length) return [];
  const serviceIndent = block[0]!.indent;
  const services: RawService[] = [];
  let svc: RawService | undefined;
  let propIndent = -1;
  let prop = "";
  let longPort: { published?: string; target?: string } | undefined;
  const flushPort = (into: RawService | undefined) => {
    const port = longPort?.published ? `${longPort.published}:${longPort.target ?? "?"}` : longPort?.target;
    if (into && port) into.ports.push(port);
    longPort = undefined;
  };

  for (const { indent, text } of block) {
    if (indent <= serviceIndent) {
      flushPort(svc);
      // Any key at this depth is a block, even "web: &defaults"; callers filter what is not a service.
      const kv = indent === serviceIndent ? yamlKey(text) : undefined;
      svc = kv ? { name: kv.key, ports: [], merges: [], anchor: /^&([\w.-]+)/.exec(kv.value ?? "")?.[1] } : undefined;
      if (svc) services.push(svc);
      propIndent = -1;
      prop = "";
      continue;
    }
    if (!svc) continue;
    if (propIndent < 0 || indent < propIndent) propIndent = indent;
    // "ports:" followed by "- 3000:3000" at the same indent is valid YAML, and common.
    const sameIndentItem = indent === propIndent && prop === "ports" && /^-(?:\s|$)/.test(text);
    if (indent === propIndent && !sameIndentItem) {
      flushPort(svc);
      if (/^<<\s*:/.test(text)) {
        svc.merges.push(...[...text.matchAll(/\*([\w.-]+)/g)].map((m) => m[1]!));
        prop = "";
        continue;
      }
      const kv = yamlKey(text);
      prop = kv?.key ?? "";
      const value = kv?.value ? yamlScalar(kv.value) : "";
      if (prop === "image" && value) svc.image = value;
      else if (prop === "build") svc.build = value || svc.build || "";
      else if (prop === "ports" && kv?.value) svc.ports.push(...inlineList(kv.value));
      else if (prop === "command" && kv?.value) svc.command = commandText(kv.value);
      continue;
    }
    if (prop === "build") {
      const kv = yamlKey(text);
      if (kv?.key === "context" && kv.value) svc.build = yamlScalar(kv.value);
    } else if (prop === "ports") {
      const item = /^-\s*(.*)$/.exec(text);
      if (item) flushPort(svc);
      const body = item ? item[1]!.trim() : text;
      const kv = yamlKey(body);
      if (kv) {
        longPort ??= {};
        if ((kv.key === "published" || kv.key === "target") && kv.value) longPort[kv.key] = yamlScalar(kv.value);
      } else if (item && body) {
        svc.ports.push(yamlScalar(body));
      }
    }
  }
  flushPort(svc);
  return services;
}

function composeFacts(composes: { path: string; services: ComposeService[] }[]): string {
  const withServices = composes.filter((c) => c.services.length);
  const lines: string[] = [];
  for (const c of withServices.slice(0, MAX_COMPOSE_FILES)) {
    const name = base(c.path);
    const up = DEFAULT_COMPOSE.has(name) ? "docker compose up" : `docker compose -f ${name} up`;
    lines.push(`- ${up} (${c.path} defines ${c.services.length} service${c.services.length === 1 ? "" : "s"})`);
    const services = c.services.map((s) => {
      const parts = [
        s.image ? `image ${clip(s.image, 80)}` : "",
        s.build !== undefined ? (s.build ? `build ${clip(s.build, 60)}` : "build") : "",
        s.ports.length ? `ports ${s.ports.slice(0, MAX_PORTS).join(", ")}${s.ports.length > MAX_PORTS ? ` …and ${s.ports.length - MAX_PORTS} more` : ""}` : "",
        s.command ? `command ${clip(s.command, 100)}` : "",
      ].filter(Boolean);
      return `- service ${s.name}${parts.length ? `: ${parts.join(", ")}` : ""} (${c.path})`;
    });
    lines.push(...capped(services, MAX_SERVICES, `services in ${c.path}`));
  }
  if (withServices.length > MAX_COMPOSE_FILES) lines.push(`- …and ${withServices.length - MAX_COMPOSE_FILES} more Compose files`);
  return section("Docker Compose:", lines);
}

// ---------------------------------------------------------------- Procfile and environment

function procfileProcesses(content: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of content.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(\S.*)$/.exec(line.trim());
    if (m) out.push([m[1]!, m[2]!.trim()]);
  }
  return out;
}

function procfileFacts(procfiles: { path: string; processes: [string, string][] }[]): string {
  const lines = procfiles.flatMap((p) => p.processes.map(([type, cmd]) => `- ${type}: ${clip(cmd)} (${p.path})`));
  return section("Procfile process types:", capped(lines, MAX_PROCESSES, "processes"));
}

const ENV_EXAMPLE_RE = /^(?:\.env(?:\.[\w-]+)*\.(?:example|sample|template|dist)|(?:example|sample)\.env|env\.example)$/i;

/**
 * Variable names only. Example env files are committed, and sometimes with real keys in them,
 * so a value never leaves this function.
 */
function envFacts(files: SourceFile[]): string {
  const names: string[] = [];
  const sources: string[] = [];
  for (const f of files.filter((x) => ENV_EXAMPLE_RE.test(base(x.path)))) {
    let found = false;
    // Inside a multi-line value (a quoted or pasted private key) until this marker: its base64
    // lines can look like "NAME=" and must never be read as names.
    let until: string | undefined;
    for (const line of f.content.split(/\r?\n/)) {
      if (until) {
        if (line.includes(until)) until = undefined;
        continue;
      }
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      until = multiLineEnd(m[2]!);
      const name = m[1]!;
      if (!isEnvName(name)) continue;
      found = true;
      if (!names.includes(name)) names.push(name);
    }
    if (found) sources.push(f.path);
  }
  if (!names.length) return "";
  const from = `${sources.slice(0, 4).join(", ")}${sources.length > 4 ? ` and ${sources.length - 4} more files` : ""}`;
  const more = names.length > MAX_ENV ? `, …and ${names.length - MAX_ENV} more` : "";
  return `Environment variables the app reads (names from ${from}): ${names.slice(0, MAX_ENV).join(", ")}${more}`;
}

/** The marker that ends a value continuing past its line, or undefined for a one-line value. */
function multiLineEnd(value: string): string | undefined {
  const quote = /^["'`]/.exec(value)?.[0];
  if (quote) {
    const rest = (quote === '"' ? value.replace(/\\./g, "") : value).slice(1);
    return rest.includes(quote) ? undefined : quote;
  }
  return value.includes("-----BEGIN") && !value.includes("-----END") ? "-----END" : undefined;
}

/**
 * Env names are UPPER_SNAKE or lower_snake. A very long or mixed-case token with digits is more
 * likely key material pasted unquoted, and is left out rather than printed.
 */
function isEnvName(name: string): boolean {
  if (name.length > 64) return false;
  return !/[a-z]/.test(name) || !/[A-Z]/.test(name) || (!/\d/.test(name) && name.length <= 40);
}

// ---------------------------------------------------------------- TOML (just enough)

/** Table name → [key, string value] pairs. Non-string values and multi-line values are skipped. */
type TomlTables = Map<string, [string, string][]>;

/**
 * A forgiving line scanner for the few TOML facts we need, not a TOML parser: [table] and
 * [[array]] headers, `key = "string"` pairs, and multi-line arrays, inline tables and triple-quoted
 * strings skipped so their contents are never mistaken for keys.
 */
function tomlTables(content: string): TomlTables {
  const tables: TomlTables = new Map([["", []]]);
  let current = "";
  let depth = 0;
  let closeQuote: string | undefined;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (closeQuote) {
      if (line.includes(closeQuote)) closeQuote = undefined;
      continue;
    }
    if (depth > 0) {
      depth += bracketBalance(line);
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    const header = /^\[\[?\s*([A-Za-z0-9_.\-"' ]+?)\s*\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) {
      current = header[1]!.replace(/["']/g, "").replace(/\s*\.\s*/g, ".");
      if (!tables.has(current)) tables.set(current, []);
      continue;
    }
    const kv = /^("[^"]+"|'[^']+'|[A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!.replace(/^["']|["']$/g, "");
    const value = kv[2]!;
    if (value.startsWith('"""') || value.startsWith("'''")) {
      if (!value.slice(3).includes(value.slice(0, 3))) closeQuote = value.slice(0, 3);
      continue;
    }
    if (value.startsWith("[") || value.startsWith("{")) {
      depth = Math.max(0, bracketBalance(value));
      continue;
    }
    const str = tomlString(value);
    if (str !== undefined) tables.get(current)!.push([key, str]);
  }
  return tables;
}

function tomlString(value: string): string | undefined {
  const basic = /^"((?:[^"\\]|\\.)*)"/.exec(value);
  if (basic) return basic[1]!.replace(/\\(["\\])/g, "$1");
  return /^'([^']*)'/.exec(value)?.[1];
}

/** Opening minus closing brackets outside quoted strings. */
function bracketBalance(text: string): number {
  let balance = 0;
  let quote: string | undefined;
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#") break;
    else if (ch === "[" || ch === "{") balance++;
    else if (ch === "]" || ch === "}") balance--;
  }
  return balance;
}

function tomlValue(tables: TomlTables, table: string, key: string): string | undefined {
  return tables.get(table)?.find(([k]) => k === key)?.[1];
}

function hasTable(tables: TomlTables, prefix: string): boolean {
  return [...tables.keys()].some((k) => k === prefix || k.startsWith(`${prefix}.`));
}

// ---------------------------------------------------------------- helpers

function base(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** "web/" for "web/package.json", "" for a root file. */
function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

/** Root files first, so the root manifest leads and wins the caps. */
function byDepth(a: SourceFile, b: SourceFile): number {
  // Code-point order, not localeCompare: the same snapshot must give the same facts on every host.
  return a.path.split("/").length - b.path.split("/").length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content.replace(/^\uFEFF/, ""));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** One line, at most `max` characters, "…" marking a cut. */
function clip(text: string, max = MAX_COMMAND): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function capped(lines: string[], max: number, noun: string): string[] {
  return lines.length > max ? [...lines.slice(0, max), `- …and ${lines.length - max} more ${noun}`] : lines;
}

/** Header plus the bullets that fit in MAX_SECTION characters; "" without bullets. */
function section(header: string, lines: string[]): string {
  if (!lines.length) return "";
  const kept: string[] = [];
  let size = header.length;
  for (const line of lines) {
    if (size + line.length + 1 > MAX_SECTION) break;
    kept.push(line);
    size += line.length + 1;
  }
  const dropped = lines.length - kept.length;
  if (dropped) kept.push(`- …and ${dropped} more lines left out`);
  return `${header}\n${kept.join("\n")}`;
}

function bounded(text: string): string {
  if (text.length <= MAX_TOTAL) return text;
  const cut = text.lastIndexOf("\n", MAX_TOTAL);
  return `${text.slice(0, cut > 0 ? cut : MAX_TOTAL)}\n- …more run facts left out`;
}

/** A parser bug on one odd file must cost that file's facts, never the deck. */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
