import { directorySummary, moduleGraph } from "@/lib/analysis/graph";
import type { RepositoryContext } from "@/lib/agent/repo-tools";
import type { Material } from "./spec";

/**
 * Facts code computed from the repository, for deck prompts: HTTP routes, directories with file
 * counts and the module dependency graph. Diagrams drawn from these are true by construction;
 * the deck writers are told to prefer them over prose when drawing architecture.
 */
export function codeFacts(context: Pick<RepositoryContext, "snapshot" | "graph" | "routes">): string {
  const routes = context.routes.slice(0, 40).map((r) => `- ${r.method} ${r.path} — ${r.file}:${r.line} (${r.framework})`);
  const dirs = directorySummary(context.snapshot, 2)
    .filter((d) => d.files >= 2)
    .slice(0, 40)
    .map((d) => `- ${d.dir}/ — ${d.files} files`);
  const graph = moduleGraph(context.graph, { maxNodes: 16 });
  const edges = graph.edges.slice(0, 30).map((e) => `- ${e.from} → ${e.to} (${e.weight} import${e.weight === 1 ? "" : "s"})`);
  const packages = [...context.graph.externalPackages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, n]) => `${name} (${n})`);
  return [
    routes.length ? `HTTP routes found in the code:\n${routes.join("\n")}` : "",
    dirs.length ? `Directories:\n${dirs.join("\n")}` : "",
    edges.length ? `Module dependencies (measured from imports; use these for architecture edges):\n${edges.join("\n")}` : "",
    packages.length ? `Most imported external packages: ${packages.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Every repository path the snapshot knows, for checking paths named in diagrams. */
export function repositoryPaths(context: Pick<RepositoryContext, "snapshot">): Set<string> {
  return new Set([...context.snapshot.inventory.map((i) => i.path), ...context.snapshot.files.map((f) => f.path)]);
}

export interface MaterialText {
  material: Material;
  /** Extracted text for documents, capped. */
  text: string;
}

const MATERIAL_BUDGET = 60_000;

/**
 * What the user uploaded, for deck prompts. Documents are quoted (capped) and cited as U refs;
 * images are listed with their asset ids so pages can show them.
 */
export function materialsEvidence(items: MaterialText[]): string {
  if (!items.length) return "";
  let budget = MATERIAL_BUDGET;
  const images = items.filter((i) => i.material.kind === "image");
  const docs = items.filter((i) => i.material.kind !== "image");
  const parts: string[] = [];
  if (images.length) {
    parts.push(
      `Images the user provided (show them with an "image" block or as the cover visual, by asset id; never invent ids):\n${images
        .map((i) => `- asset ${i.material.id} (${i.material.ref}) "${i.material.name}": ${i.material.description || "no description"}`)
        .join("\n")}`,
    );
  }
  for (const d of docs) {
    if (budget <= 0) break;
    const text = d.text.slice(0, Math.min(budget, 20_000));
    budget -= text.length;
    parts.push(`<user_material ref="${d.material.ref}" name="${d.material.name.replace(/"/g, "")}">\n${text}\n</user_material>`);
  }
  return `Material the user provided (not code; cite it as its U ref, e.g. "U1"; prefer it for product framing, goals, results and roadmap, and the code for how things work):\n\n${parts.join("\n\n")}`;
}
