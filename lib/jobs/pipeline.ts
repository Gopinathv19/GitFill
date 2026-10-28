import { readFile } from "node:fs/promises";
import { and, desc, eq } from "drizzle-orm";
import { MuseClient } from "@/lib/ai/client";
import { generateIllustration } from "@/lib/ai/images";
import { modelFor } from "@/lib/ai/models";
import type { RepositoryAnalysis } from "@/lib/agent/analysis-schema";
import { analyzeRepository } from "@/lib/agent/analyze";
import { applyRevision, planDeck, planRevision } from "@/lib/agent/planner";
import { githubClientForJob } from "@/lib/auth/github-token";
import { ingestGitHubRepository } from "@/lib/connectors/github/ingest";
import type { SourceSnapshot } from "@/lib/connectors/types";
import type { Database } from "@/lib/db";
import { artifacts, deckVersions, decks, evidenceClaims, generationJobs, repositorySnapshots, type ArtifactType } from "@/lib/db/schema";
import { buildEvidenceReport } from "@/lib/documents/evidence-report";
import { generateReadme } from "@/lib/documents/readme";
import type { Claim } from "@/lib/evidence/evidence";
import { buildValidatedDeck, type BuildResult } from "@/lib/presentation/build";
import { deckSpecSchema, normalizeDeckSpec, type DeckSpec } from "@/lib/presentation/spec";
import { getStorage, safeFilename } from "@/lib/storage";
import { generateRequestSchema, reviseRequestSchema } from "@/lib/validation/request";
import { DbRecorder } from "./db-recorder";
import { runCompareJob, runHandbookJob, runReuseJob } from "./document-jobs";

type Job = typeof generationJobs.$inferSelect;
type ExtraArtifact = { type: ArtifactType; name: string; data: Buffer; mime: string };

interface SnapshotSummary {
  displayName: string;
  description: string | null;
  stats: SourceSnapshot["stats"];
  metadata: SourceSnapshot["metadata"];
  analysis: RepositoryAnalysis;
  inventory: Array<{ path: string; sizeBytes: number; selected: boolean; skipReason?: string }>;
  danglingRefs: string[];
  agent: { turns: number; toolCalls: number };
}

export async function runJob(db: Database, job: Job): Promise<void> {
  const recorder = await DbRecorder.create(db, job.id, modelLabel(job.kind));
  const client = new MuseClient(recorder.modelObserver());
  try {
    switch (job.kind) {
      case "generate":
        await runGenerate(db, job, recorder, client);
        break;
      case "revise":
        await runRevise(db, job, recorder, client);
        break;
      case "handbook":
        await runHandbookJob(db, job, recorder, client);
        break;
      case "compare":
        await runCompareJob(db, job, recorder, client);
        break;
      case "reuse":
        await runReuseJob(db, job, recorder, client);
        break;
    }
    await recorder.finish("completed");
  } catch (err) {
    const message = publicErrorMessage(err);
    await recorder.finish("failed", message);
    await db.update(generationJobs).set({ status: "failed", errorMessage: message, completedAt: new Date() }).where(eq(generationJobs.id, job.id));
    console.error(`[job ${job.id}] failed:`, err);
  }
}

function modelLabel(kind: Job["kind"]): string {
  switch (kind) {
    case "generate":
      return `${modelFor("analyst")} + ${modelFor("planner")}`;
    case "revise":
      return modelFor("planner");
    case "handbook":
    case "reuse":
      return `${modelFor("analyst")} + ${modelFor("architect")}`;
    case "compare":
      return modelFor("differ");
  }
}

async function runGenerate(db: Database, job: Job, recorder: DbRecorder, client: MuseClient) {
  const request = generateRequestSchema.parse(job.options);

  // 1. Connector: resolve the repository to an exact commit and read prioritized files.
  await recorder.setStage("analyzing_repository");
  const ingestEvent = await recorder.start("tool", "inspect_repository", { url: request.repositoryUrl, branch: request.branch });
  const snapshot = await ingestGitHubRepository({ url: request.repositoryUrl, branch: request.branch, client: await githubClientForJob(db, job) }).catch(async (err) => {
    await ingestEvent.fail(publicErrorMessage(err));
    throw err;
  });
  await ingestEvent.succeed({ repository: snapshot.displayName, commit: snapshot.version.slice(0, 7), files: snapshot.stats.selectedFiles, tree: snapshot.stats.totalEntries });
  await db.update(generationJobs).set({ branch: snapshot.branch, commitSha: snapshot.version }).where(eq(generationJobs.id, job.id));

  // 2. Analysis agent: real tool loop with verified evidence.
  const analysis = await analyzeRepository({ client, snapshot, userRequest: `${request.purpose} Audience: ${request.audience}. ${request.instructions}`, recorder });

  const summary: SnapshotSummary = {
    displayName: snapshot.displayName,
    description: snapshot.description,
    stats: snapshot.stats,
    metadata: snapshot.metadata,
    analysis: analysis.analysis,
    inventory: snapshot.inventory.slice(0, 5000),
    danglingRefs: analysis.danglingRefs,
    agent: { turns: analysis.turns, toolCalls: analysis.toolCalls },
  };
  const [snap] = await db
    .insert(repositorySnapshots)
    .values({
      projectId: job.projectId,
      repositoryUrl: snapshot.sourceUrl,
      owner: String(snapshot.metadata.owner),
      name: String(snapshot.metadata.repo),
      defaultBranch: snapshot.defaultBranch,
      branch: snapshot.branch,
      commitSha: snapshot.version,
      summary,
    })
    .returning();
  if (analysis.claims.length) {
    await db.insert(evidenceClaims).values(
      analysis.claims.map((c) => ({
        snapshotId: snap!.id,
        ref: c.ref,
        claim: c.claim,
        claimType: c.claimType,
        filePath: c.filePath,
        startLine: c.startLine,
        endLine: c.endLine,
        excerpt: c.excerpt,
        status: c.status,
      })),
    );
  }
  await db.update(generationJobs).set({ snapshotId: snap!.id }).where(eq(generationJobs.id, job.id));

  // 3. Planner (Muse Wonder) → validated deck spec.
  await recorder.setStage("planning_presentation");
  const { spec } = await planDeck({ client, snapshot, analysis: analysis.analysis, claims: analysis.claims, request, recorder });

  const [deck] = await db.insert(decks).values({ projectId: job.projectId, snapshotId: snap!.id, title: spec.title }).returning();
  const version = 1;
  const prefix = `decks/${deck!.id}/v${version}`;

  // 4. Decorative artwork (Muse Image). Optional: failures never block the deck.
  await recorder.setStage("generating_presentation");
  const assets = request.outputs.illustrations ? await makeIllustrations(spec, prefix, recorder) : {};

  // 5. Generate → render → check → repair.
  const footer = `GitFill · ${snapshot.displayName} @ ${snapshot.version.slice(0, 7)}`;
  const built = await buildValidatedDeck({
    spec,
    footer,
    workDir: getStorage().localPath(`work/${job.id}`),
    illustrations: illustrationPaths(assets),
    client,
    recorder,
  });

  // 6. Documents: README.md and the evidence report.
  await recorder.setStage("generating_documents");
  const extra: ExtraArtifact[] = [];
  if (request.outputs.readme) {
    try {
      const readme = await generateReadme({ client, snapshot, analysis: analysis.analysis, claims: analysis.claims, recorder });
      extra.push({ type: "readme", name: "README.md", data: Buffer.from(readme.markdown), mime: "text/markdown; charset=utf-8" });
    } catch {
      // Recorded as a failed step; the deck is still delivered.
    }
  }
  extra.push({ type: "evidence_report", name: "evidence-report.md", data: Buffer.from(buildEvidenceReport(snapshot, analysis.claims, built.spec)), mime: "text/markdown; charset=utf-8" });

  await persistVersion(db, { job, deckId: deck!.id, version, prefix, built, assets, extra, repoName: String(snapshot.metadata.repo), changeSummary: "Initial generation", includePdf: request.outputs.pdf });
}

async function runRevise(db: Database, job: Job, recorder: DbRecorder, client: MuseClient) {
  const { instruction } = reviseRequestSchema.parse(job.options);
  if (!job.deckId) throw new Error("Revision job has no deck.");
  await recorder.setStage("planning_presentation");

  const deck = (await db.select().from(decks).where(eq(decks.id, job.deckId)))[0];
  if (!deck) throw new Error("Deck not found.");
  const latest = (await db.select().from(deckVersions).where(eq(deckVersions.deckId, deck.id)).orderBy(desc(deckVersions.version)).limit(1))[0];
  if (!latest) throw new Error("Deck has no versions.");
  const snap = (await db.select().from(repositorySnapshots).where(eq(repositorySnapshots.id, deck.snapshotId)))[0]!;
  const claims = (await db.select().from(evidenceClaims).where(eq(evidenceClaims.snapshotId, snap.id))).map(toClaim);
  const current = deckSpecSchema.parse(latest.spec);

  const plan = await planRevision({ client, spec: current, instruction, claims, recorder });
  const applied = applyRevision(current, plan);
  const { spec } = normalizeDeckSpec(deckSpecSchema.parse(applied.spec), new Set(claims.map((c) => c.ref)));

  const version = latest.version + 1;
  const prefix = `decks/${deck.id}/v${version}`;
  const assets = (latest.assets ?? {}) as Record<string, string>;
  const themeChanged = spec.theme !== current.theme;
  const built = await buildValidatedDeck({
    spec,
    footer: `GitFill · ${snap.owner}/${snap.name} @ ${snap.commitSha.slice(0, 7)}`,
    workDir: getStorage().localPath(`work/${job.id}`),
    illustrations: illustrationPaths(assets),
    client,
    recorder,
    // Only changed slides need a fresh visual review, unless the theme changed every slide.
    reviewSlideIds: themeChanged ? undefined : new Set(applied.changedIds),
  });

  const summary = snap.summary as SnapshotSummary;
  const snapshotView = { displayName: summary.displayName, sourceUrl: snap.repositoryUrl, branch: snap.branch, version: snap.commitSha } as SourceSnapshot;
  const extra: ExtraArtifact[] = [
    { type: "evidence_report", name: "evidence-report.md", data: Buffer.from(buildEvidenceReport(snapshotView, claims, built.spec)), mime: "text/markdown; charset=utf-8" },
  ];
  const readme = (await db.select().from(artifacts).where(and(eq(artifacts.deckVersionId, latest.id), eq(artifacts.artifactType, "readme"))))[0];
  // The README describes the repository, not the deck, so revisions carry it forward unchanged.
  if (readme) extra.push({ type: "readme", name: "README.md", data: await getStorage().get(readme.storageKey), mime: readme.mimeType });

  await persistVersion(db, {
    job,
    deckId: deck.id,
    version,
    prefix,
    built,
    assets,
    extra,
    repoName: snap.name,
    changeSummary: [plan.summary, ...applied.problems.map((p) => `Skipped: ${p}`)].join(" "),
    includePdf: true,
  });
}

async function persistVersion(
  db: Database,
  p: {
    job: Job;
    deckId: string;
    version: number;
    prefix: string;
    built: BuildResult;
    assets: Record<string, string>;
    extra: ExtraArtifact[];
    repoName: string;
    changeSummary: string;
    includePdf: boolean;
  },
) {
  const storage = getStorage();
  const [ver] = await db
    .insert(deckVersions)
    .values({ deckId: p.deckId, version: p.version, jobId: p.job.id, spec: p.built.spec, validation: p.built.report, assets: p.assets, changeSummary: p.changeSummary })
    .returning();

  const rows: (typeof artifacts.$inferInsert)[] = [];
  const save = async (type: ArtifactType, name: string, data: Buffer, mime: string, filename: string, slideIndex?: number) => {
    const key = `${p.prefix}/${name}`;
    const { sizeBytes } = await storage.put(key, data);
    rows.push({ jobId: p.job.id, deckVersionId: ver!.id, artifactType: type, storageKey: key, filename, mimeType: mime, sizeBytes, slideIndex });
  };

  const base = `${p.repoName}-deck-v${p.version}`;
  await save("pptx", "deck.pptx", p.built.pptx, "application/vnd.openxmlformats-officedocument.presentationml.presentation", safeFilename(base, "pptx"));
  if (p.includePdf) await save("pdf", "deck.pdf", await readFile(p.built.render.pdfPath), "application/pdf", safeFilename(base, "pdf"));
  for (const slide of p.built.render.slides) {
    const n = String(slide.index + 1).padStart(2, "0");
    await save("slide_preview", `slide-${n}.png`, await readFile(slide.pngPath), "image/png", `slide-${n}.png`, slide.index);
  }
  for (const e of p.extra) await save(e.type, e.name, e.data, e.mime, e.type === "readme" ? "README.md" : safeFilename(`${p.repoName}-evidence-report`, "md"));
  await db.insert(artifacts).values(rows);

  await db.update(decks).set({ latestVersion: p.version, title: p.built.spec.title, updatedAt: new Date() }).where(eq(decks.id, p.deckId));
  await db
    .update(generationJobs)
    .set({ status: "completed", deckId: p.deckId, resultVersionId: ver!.id, completedAt: new Date() })
    .where(eq(generationJobs.id, p.job.id));
}

async function makeIllustrations(spec: DeckSpec, prefix: string, recorder: DbRecorder): Promise<Record<string, string>> {
  const targets = spec.slides.filter((s) => s.layout === "title" || s.layout === "section").slice(0, 3);
  const assets: Record<string, string> = {};
  await Promise.all(
    targets.map(async (slide) => {
      const prompt = slide.layout === "title" && slide.illustrationPrompt ? slide.illustrationPrompt : `${spec.title}: ${slide.title}`;
      const event = await recorder.start("tool", "generate_illustration", { slide: slide.id, prompt }, modelFor("illustrator"));
      try {
        const png = await generateIllustration(prompt, recorder.modelObserver(), spec.theme);
        const key = `${prefix}/illustration-${slide.id}.png`;
        await getStorage().put(key, png);
        assets[slide.id] = key;
        await event.succeed({ bytes: png.byteLength });
      } catch (err) {
        await event.fail(publicErrorMessage(err));
      }
    }),
  );
  return assets;
}

function illustrationPaths(assets: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(assets).map(([slideId, key]) => [slideId, getStorage().localPath(key)]));
}

function toClaim(row: typeof evidenceClaims.$inferSelect): Claim {
  return {
    ref: row.ref,
    claim: row.claim,
    claimType: row.claimType as Claim["claimType"],
    filePath: row.filePath,
    startLine: row.startLine,
    endLine: row.endLine,
    excerpt: row.excerpt,
    status: row.status,
    note: "",
  };
}

/** Error text safe to show users: known error classes pass through, everything else is generic. */
export function publicErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const safe = ["InvalidRepositoryUrlError", "GitHubError", "ModelError", "StructuredOutputError", "ToolLoopError", "RenderError", "ConfigError", "ZodError"];
    if (safe.includes(err.name)) return err.message.slice(0, 500);
  }
  return "Unexpected error while running this job. See server logs for details.";
}

