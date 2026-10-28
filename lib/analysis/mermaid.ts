import { z } from "zod";

/**
 * Diagrams are structured data first and Mermaid text second. Models produce the
 * structure (nodes and edges that point at files); this module validates it and renders
 * syntactically safe Mermaid. Nothing a model writes is pasted into Mermaid verbatim.
 */

export const DIAGRAM_KINDS = ["flowchart", "sequence", "class", "er", "component", "dependency", "call"] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

const id = z.string().regex(/^[A-Za-z_][\w-]{0,40}$/).describe("Short unique id, letters/digits/underscore.");

export const diagramNodeSchema = z.object({
  id,
  label: z.string().trim().min(1).max(60),
  kind: z.enum(["actor", "service", "process", "decision", "store", "external", "component", "class", "entity", "module", "function"]).optional(),
  /** Repository path (and optional line) the node represents. */
  path: z.string().max(400).optional(),
  line: z.number().int().min(1).optional(),
  /** Members for class/entity nodes, e.g. "+save(): void" or "id: uuid PK". */
  members: z.array(z.string().max(80)).max(16).optional(),
  /** True when this element is not directly observed in code. */
  inferred: z.boolean().optional(),
});

export const diagramEdgeSchema = z.object({
  from: id,
  to: id,
  label: z.string().max(60).optional(),
  kind: z.enum(["sync", "async", "data", "inherits", "implements", "composes", "uses", "one_to_one", "one_to_many", "many_to_many", "returns"]).optional(),
  inferred: z.boolean().optional(),
  /** Order for sequence diagrams (lower first). Defaults to array order. */
  order: z.number().int().min(0).optional(),
});

export const diagramSpecSchema = z.object({
  kind: z.enum(DIAGRAM_KINDS),
  title: z.string().trim().min(1).max(90),
  direction: z.enum(["TB", "LR"]).optional(),
  nodes: z.array(diagramNodeSchema).min(1).max(30),
  edges: z.array(diagramEdgeSchema).max(60),
  groups: z.array(z.object({ id, label: z.string().max(60), nodes: z.array(id).max(30) })).max(8).optional(),
  caption: z.string().max(240).optional().describe("One sentence on what the diagram shows and any uncertainty."),
});

export type DiagramSpec = z.infer<typeof diagramSpecSchema>;
export type DiagramNode = z.infer<typeof diagramNodeSchema>;

export interface DiagramIssue {
  message: string;
}

/** Drops edges to unknown nodes, duplicate ids and empty groups. Returns issues found. */
export function normalizeDiagram(spec: DiagramSpec): { spec: DiagramSpec; issues: DiagramIssue[] } {
  const issues: DiagramIssue[] = [];
  const seen = new Set<string>();
  const nodes = spec.nodes.filter((n) => {
    if (seen.has(n.id)) {
      issues.push({ message: `Duplicate node id ${n.id} removed.` });
      return false;
    }
    seen.add(n.id);
    return true;
  });
  const edges = spec.edges.filter((e) => {
    if (!seen.has(e.from) || !seen.has(e.to)) {
      issues.push({ message: `Edge ${e.from} → ${e.to} references an unknown node.` });
      return false;
    }
    return true;
  });
  const groups = spec.groups
    ?.map((g) => ({ ...g, nodes: g.nodes.filter((n) => seen.has(n)) }))
    .filter((g) => g.nodes.length > 0);
  return { spec: { ...spec, nodes, edges, ...(groups ? { groups } : {}) }, issues };
}

/** Renders validated structure into Mermaid. Labels are escaped; ids are regenerated. */
export function renderMermaid(spec: DiagramSpec): string {
  const ids = new Map(spec.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const nid = (x: string) => ids.get(x) ?? "n0";
  switch (spec.kind) {
    case "sequence":
      return renderSequence(spec, nid);
    case "class":
      return renderClass(spec, nid);
    case "er":
      return renderEr(spec, nid);
    default:
      return renderFlowchart(spec, nid);
  }
}

function esc(label: string): string {
  return label.replace(/"/g, "#quot;").replace(/[<>]/g, (c) => (c === "<" ? "#lt;" : "#gt;")).replace(/\n/g, " ");
}

function shape(kind: DiagramNode["kind"], label: string): string {
  const l = `"${esc(label)}"`;
  switch (kind) {
    case "actor":
      return `([${l}])`;
    case "decision":
      return `{${l}}`;
    case "store":
    case "entity":
      return `[(${l})]`;
    case "external":
      return `[[${l}]]`;
    case "function":
      return `>${l}]`;
    default:
      return `[${l}]`;
  }
}

function renderFlowchart(spec: DiagramSpec, nid: (x: string) => string): string {
  const dir = spec.direction ?? (spec.kind === "dependency" || spec.kind === "component" ? "LR" : "TB");
  const lines = [`flowchart ${dir}`];
  const grouped = new Set(spec.groups?.flatMap((g) => g.nodes) ?? []);
  for (const n of spec.nodes) if (!grouped.has(n.id)) lines.push(`  ${nid(n.id)}${shape(n.kind, n.label)}`);
  spec.groups?.forEach((g, i) => {
    lines.push(`  subgraph g${i + 1}["${esc(g.label)}"]`);
    for (const m of g.nodes) {
      const n = spec.nodes.find((x) => x.id === m);
      if (n) lines.push(`    ${nid(n.id)}${shape(n.kind, n.label)}`);
    }
    lines.push("  end");
  });
  for (const e of spec.edges) {
    const arrow = e.inferred || e.kind === "async" ? "-.->" : e.kind === "data" ? "==>" : "-->";
    const label = e.label ? `|"${esc(e.label)}"|` : "";
    lines.push(`  ${nid(e.from)} ${arrow}${label} ${nid(e.to)}`);
  }
  const inferred = spec.nodes.filter((n) => n.inferred).map((n) => nid(n.id));
  if (inferred.length) {
    lines.push("  classDef inferred stroke-dasharray: 5 5,stroke:#999,color:#666;");
    lines.push(`  class ${inferred.join(",")} inferred;`);
  }
  return lines.join("\n");
}

function renderSequence(spec: DiagramSpec, nid: (x: string) => string): string {
  const lines = ["sequenceDiagram"];
  for (const n of spec.nodes) lines.push(`  ${n.kind === "actor" ? "actor" : "participant"} ${nid(n.id)} as ${esc(n.label).replace(/#quot;/g, "'")}`);
  const edges = [...spec.edges].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const e of edges) {
    const arrow = e.kind === "returns" ? "-->>" : e.kind === "async" ? "-)" : e.inferred ? "-->>" : "->>";
    lines.push(`  ${nid(e.from)}${arrow}${nid(e.to)}: ${seqLabel(e.label ?? "")}${e.inferred ? " (inferred)" : ""}`);
  }
  return lines.join("\n");
}

function seqLabel(label: string): string {
  return (label || "call").replace(/[;:\n]/g, " ").slice(0, 80);
}

function renderClass(spec: DiagramSpec, nid: (x: string) => string): string {
  const lines = ["classDiagram"];
  for (const n of spec.nodes) {
    lines.push(`  class ${nid(n.id)}["${esc(n.label)}"] {`);
    for (const m of n.members ?? []) lines.push(`    ${m.replace(/[{}"]/g, "").slice(0, 70)}`);
    lines.push("  }");
  }
  for (const e of spec.edges) {
    const rel = e.kind === "inherits" ? "<|--" : e.kind === "implements" ? "<|.." : e.kind === "composes" ? "*--" : e.inferred ? "..>" : "-->";
    const label = e.label ? ` : ${e.label.replace(/[:"\n]/g, " ").slice(0, 40)}` : "";
    // Mermaid draws A <|-- B as "B inherits A": flip so from→to reads naturally.
    if (e.kind === "inherits" || e.kind === "implements") lines.push(`  ${nid(e.to)} ${rel} ${nid(e.from)}${label}`);
    else lines.push(`  ${nid(e.from)} ${rel} ${nid(e.to)}${label}`);
  }
  return lines.join("\n");
}

function renderEr(spec: DiagramSpec, nid: (x: string) => string): string {
  const lines = ["erDiagram"];
  for (const n of spec.nodes) {
    lines.push(`  ${nid(n.id)}["${esc(n.label)}"] {`);
    for (const m of n.members ?? []) {
      // "id: uuid PK" → "uuid id PK"; fall back to "string name".
      const parts = /^([\w.]+)\s*:\s*([\w\[\]]+)(?:\s+(PK|FK|UK))?/.exec(m);
      if (parts) lines.push(`    ${parts[2]!.replace(/[\[\]]/g, "")} ${parts[1]}${parts[3] ? ` ${parts[3]}` : ""}`);
      else lines.push(`    string ${m.replace(/[^\w]/g, "_").slice(0, 40) || "field"}`);
    }
    lines.push("  }");
  }
  for (const e of spec.edges) {
    const rel = e.kind === "one_to_one" ? "||--||" : e.kind === "many_to_many" ? "}o--o{" : "||--o{";
    const label = (e.label ?? "has").replace(/["\n]/g, " ").slice(0, 40);
    lines.push(`  ${nid(e.from)} ${rel} ${nid(e.to)} : "${label}"`);
  }
  return lines.join("\n");
}

/** Light syntax guard for Mermaid we render ourselves: balanced brackets and a known header. */
export function checkMermaidSyntax(text: string): string[] {
  const issues: string[] = [];
  const header = text.split("\n")[0]?.trim() ?? "";
  if (!/^(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram)/.test(header)) issues.push("Unknown diagram header.");
  const pairs: Record<string, string> = { "[": "]", "(": ")", "{": "}" };
  const stack: string[] = [];
  let inQuote = false;
  // ER relationship tokens (||--o{, }o--o{) and the async sequence arrow (-)) use bracket
  // characters as syntax, not as delimiters.
  const body = text.replace(/[|}o]{1,2}--[|{o]{1,2}/g, "--").replace(/-\)/g, "-");
  for (const ch of body) {
    if (ch === '"') inQuote = !inQuote;
    if (inQuote) continue;
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === "]" || ch === ")" || ch === "}") {
      if (stack.pop() !== ch) {
        issues.push("Unbalanced brackets.");
        break;
      }
    }
  }
  if (stack.length) issues.push("Unclosed brackets.");
  if (inQuote) issues.push("Unclosed quote.");
  return issues;
}

/** Wraps Mermaid text in a fenced block for Markdown output. */
export function mermaidFence(text: string): string {
  return `\`\`\`mermaid\n${text}\n\`\`\``;
}

/** A dependency diagram built by code from the module graph (no model involved). */
export function dependencyDiagram(view: { nodes: Array<{ id: string; label: string; files: number }>; edges: Array<{ from: string; to: string; weight: number }> }, title: string): DiagramSpec {
  const ids = new Map(view.nodes.map((n, i) => [n.id, `m${i + 1}`]));
  return {
    kind: "dependency",
    title,
    direction: "LR",
    nodes: view.nodes.map((n) => ({ id: ids.get(n.id)!, label: n.files > 1 ? `${n.label} (${n.files} files)` : n.label, kind: "module" as const, path: n.id })),
    edges: view.edges.map((e) => ({ from: ids.get(e.from)!, to: ids.get(e.to)!, kind: "uses" as const, ...(e.weight > 1 ? { label: `${e.weight} imports` } : {}) })),
    caption: "Derived from import statements in the analyzed files.",
  };
}
