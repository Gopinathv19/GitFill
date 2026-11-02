import type { z } from "zod";
import type { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { UNTRUSTED_CONTENT_RULE } from "@/lib/ai/prompts";
import type { RepositoryAnalysis } from "@/lib/agent/analysis-schema";
import { renderClaimsForPrompt } from "@/lib/agent/planner";
import type { RunRecorder } from "@/lib/agent/recorder";
import type { Claim } from "@/lib/evidence/evidence";
import { checkFigurePaths, normalizeFigure } from "@/lib/presentation/spec";
import type { Theme } from "@/lib/presentation/themes";
import { checkSvgText } from "@/lib/render/browser";
import { readmeVisualsSchema, renderBanner, renderDiagramImage, type ReadmeVisuals } from "./visuals";

/** A file the README ships with, under docs/readme/. */
export interface ReadmeFile {
  /** Repository path, e.g. docs/readme/architecture.svg. */
  path: string;
  mime: string;
  bytes: Buffer;
  alt: string;
  kind: "banner" | "architecture" | "flow" | "screenshot" | "logo";
}

export const README_ASSET_DIR = "docs/readme";

const VISUALS_PROMPT = `You design the images for a repository's README: a banner, an architecture diagram and a flow diagram, as structured specs that code draws. Use only the provided evidence.

${UNTRUSTED_CONTENT_RULE}

- banner: kicker = what the project is in 2-4 words; title = a claim about what it does for its user (not its name), with accent = a phrase copied exactly from the title; tagline = three short proof points separated by " · " that the code supports; footnote only when the code shows the model, platform or sponsor it is built on. panel: "chat" for chat or assistant products (a realistic exchange the product would really have, chips = real source or button names), "terminal" for developer tools (real commands from the repository), otherwise "cards" (2-4 key features).
- architecture: lanes left to right (people → apps/entry → backend → storage and external services), built from the measured module dependencies and the analysis components. Every node names the repository path it stands for in "path". External services use tone "external", the main entry point "accent". Edge labels say what moves. At most 12 nodes. caption: one sentence that tells the reader how to read it.
- flow: the product's main flow as a "flow" figure (steps with side exits as branches and end results as outcomes), or a "sequence" figure for a request between components, from a traced workflow.
- badges: only technologies that appear in the evidence (language, framework, key service, license), with their brand colour and simple-icons logo slug.
- Keep every label short: node titles under 24 characters, sub lines under 40.
Only fill the parts you are asked for. Return only the JSON.`;

/**
 * Plans the README's images with the writer model, checks diagram paths against the repository,
 * draws them as SVG and checks in the browser that every label fits; a second pass shortens
 * labels that do not. Never throws: images that cannot be made are simply left out.
 */
export async function makeReadmeVisuals(opts: {
  client: MuseClient;
  recorder: RunRecorder;
  name: string;
  analysis: RepositoryAnalysis;
  claims: Claim[];
  facts: string;
  brief: string;
  wants: { banner: boolean; diagrams: boolean; badges: boolean };
  paths: ReadonlySet<string>;
  theme: Theme;
  logo?: string;
}): Promise<{ files: ReadmeFile[]; badges: ReadmeVisuals["badges"]; issues: string[] }> {
  if (!opts.wants.banner && !opts.wants.diagrams && !opts.wants.badges) return { files: [], badges: [], issues: [] };
  const ask = [opts.wants.banner ? "banner" : "", opts.wants.diagrams ? "architecture, flow" : "", opts.wants.badges ? "badges" : ""].filter(Boolean).join(", ");
  const event = await opts.recorder.start("step", "design_readme_images", { parts: ask }, modelFor("writer"));
  const issues: string[] = [];
  try {
    const evidence = [
      opts.brief,
      `Fill: ${ask}.`,
      `Code facts (computed from the source):\n${opts.facts}`,
      `Analysis:\n${JSON.stringify(opts.analysis)}`,
      `Claims:\n${renderClaimsForPrompt(opts.claims.filter((c) => c.status !== "unverified"))}`,
    ].join("\n\n");
    const schema = requiredVisuals(opts.wants);
    let visuals = await plan(opts.client, opts.recorder, evidence, schema);
    let files = draw(visuals, opts, issues);
    const clipped = await checkSvgText(files.map((f) => f.bytes.toString("utf8"))).catch(() => files.map(() => [] as string[]));
    if (clipped.some((c) => c.length)) {
      const notes = files.map((f, i) => (clipped[i]!.length ? `${f.kind}: ${clipped[i]!.map((t) => `"${t}"`).join(", ")}` : "")).filter(Boolean);
      visuals = await plan(opts.client, opts.recorder, `${evidence}\n\nYour previous design:\n${JSON.stringify(visuals)}\n\nThese texts do not fit their boxes; shorten exactly these, keep everything else:\n${notes.join("\n")}`, schema);
      files = draw(visuals, opts, issues);
      const again = await checkSvgText(files.map((f) => f.bytes.toString("utf8"))).catch(() => files.map(() => [] as string[]));
      again.forEach((c, i) => c.length && issues.push(`${files[i]!.kind}: text still does not fit (${c.join(", ")})`));
    }
    await event.succeed({ images: files.map((f) => f.path), badges: visuals.badges.length, issues });
    return { files, badges: opts.wants.badges ? visuals.badges : [], issues };
  } catch (err) {
    await event.fail(err instanceof Error ? err.message : "README images failed");
    return { files: [], badges: [], issues: ["The README images could not be made; the README is written without them."] };
  }
}

/**
 * The visuals schema with every part the user asked for made required: with all parts optional the
 * model may return an empty design (it did, on a real repository).
 */
export function requiredVisuals(wants: { banner: boolean; diagrams: boolean; badges: boolean }): z.ZodType<ReadmeVisuals> {
  const shape = readmeVisualsSchema.shape;
  // Still a ReadmeVisuals: only optional parts become required.
  return readmeVisualsSchema.extend({
    ...(wants.banner ? { banner: shape.banner.unwrap() } : {}),
    ...(wants.diagrams ? { architecture: shape.architecture.unwrap(), flow: shape.flow.unwrap() } : {}),
    ...(wants.badges ? { badges: shape.badges.removeDefault().min(1) } : {}),
  }) as unknown as z.ZodType<ReadmeVisuals>;
}

async function plan(client: MuseClient, recorder: RunRecorder, input: string, schema: ReturnType<typeof requiredVisuals>): Promise<ReadmeVisuals> {
  const { data, usage } = await client.structured({
    model: modelFor("writer"),
    purpose: "design_readme_images",
    schema,
    schemaName: "ReadmeImages",
    correctionAttempts: 2,
    reasoningEffort: "low",
    maxTokens: 12_000,
    messages: [
      { role: "system", content: VISUALS_PROMPT },
      { role: "user", content: input },
    ],
  });
  await recorder.addUsage(usage.inputTokens, usage.outputTokens);
  return data;
}

function draw(visuals: ReadmeVisuals, opts: { name: string; wants: { banner: boolean; diagrams: boolean }; paths: ReadonlySet<string>; theme: Theme; logo?: string }, issues: string[]): ReadmeFile[] {
  const files: ReadmeFile[] = [];
  const svg = (kind: ReadmeFile["kind"], name: string, body: string, alt: string) => files.push({ kind, path: `${README_ASSET_DIR}/${name}.svg`, mime: "image/svg+xml", bytes: Buffer.from(body), alt });
  if (opts.wants.banner && visuals.banner) svg("banner", "banner", renderBanner(visuals.banner, { name: opts.name, theme: opts.theme, logo: opts.logo }), `${opts.name}: ${visuals.banner.title}`);
  if (opts.wants.diagrams && visuals.architecture) {
    const fig = structuredClone(visuals.architecture.figure);
    normalizeFigure(fig, (m) => issues.push(`architecture: ${m}`));
    checkFigurePaths(fig, opts.paths, (m) => issues.push(`architecture: ${m}`));
    svg("architecture", "architecture", renderDiagramImage(fig, { title: visuals.architecture.title, caption: visuals.architecture.caption, theme: opts.theme }), visuals.architecture.caption ?? `${opts.name} architecture`);
  }
  if (opts.wants.diagrams && visuals.flow) {
    const fig = structuredClone(visuals.flow.figure);
    normalizeFigure(fig, (m) => issues.push(`flow: ${m}`));
    checkFigurePaths(fig, opts.paths, (m) => issues.push(`flow: ${m}`));
    svg("flow", visuals.flow.figure.kind === "sequence" ? "request-flow" : "flow", renderDiagramImage(fig, { title: visuals.flow.title, caption: visuals.flow.caption, theme: opts.theme }), visuals.flow.caption ?? visuals.flow.title);
  }
  return files;
}

/** Repository-safe file name for an uploaded image under docs/readme/. */
export function assetFileName(filename: string, used: Set<string>): string {
  const ext = (/\.(png|jpe?g|gif|webp)$/i.exec(filename)?.[1] ?? "png").toLowerCase().replace("jpeg", "jpg");
  const base = filename.replace(/\.(png|jpe?g|gif|webp)$/i, "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
  let name = `${base}.${ext}`;
  for (let n = 2; used.has(name); n++) name = `${base}-${n}.${ext}`;
  used.add(name);
  return name;
}

export type { StoredReadmeFile } from "./files";
