import { eq } from "drizzle-orm";
import type { MuseClient } from "@/lib/ai/client";
import { analyzeRepository } from "@/lib/agent/analyze";
import { githubClientForJob } from "@/lib/auth/github-token";
import type { Database } from "@/lib/db";
import { generationJobs, projects } from "@/lib/db/schema";
import { generateReadme } from "@/lib/documents/readme";
import { codeFacts, repositoryPaths } from "@/lib/presentation/evidence";
import { assetFileName, makeReadmeVisuals, README_ASSET_DIR, type ReadmeFile, type StoredReadmeFile } from "@/lib/readme/plan";
import { README_TEMPLATES, type ChosenSection } from "@/lib/readme/templates";
import { badgeMarkdown, readmeTheme } from "@/lib/readme/visuals";
import { getStorage } from "@/lib/storage";
import { uploadsByIds } from "@/lib/uploads/service";
import { writeBrainstormSpec } from "@/lib/gitfill/brainstorm";
import { describeGitfill, readGitfill } from "@/lib/gitfill/read";
import { brainstormRequestSchema, readmeRequestSchema } from "@/lib/validation/request";
import type { DbRecorder } from "./db-recorder";
import { complete, ingest, saveDocument, saveSnapshot } from "./document-jobs";

type Job = typeof generationJobs.$inferSelect;

/**
 * README.md written (or brought up to date) from the code and the team's .gitfill folder: the
 * analysis agent reads the code, the writer combines it with the team's assets and notes and the
 * current README, and image links are checked against the tree.
 */
export async function runReadmeJob(db: Database, job: Job, recorder: DbRecorder, client: MuseClient) {
  const request = readmeRequestSchema.parse(job.options);
  await recorder.setStage("analyzing_repository");
  const github = await githubClientForJob(db, job);
  const snapshot = await ingest(github, job.repositoryUrl, request.branch ?? job.branch ?? undefined, recorder);
  await db.update(generationJobs).set({ branch: snapshot.branch, commitSha: snapshot.version }).where(eq(generationJobs.id, job.id));

  const gitfillEvent = await recorder.start("tool", "read_gitfill", { repository: snapshot.displayName });
  const gitfill = await readGitfill(github, { owner: String(snapshot.metadata.owner), name: String(snapshot.metadata.repo), sha: snapshot.version, paths: snapshot.inventory });
  await gitfillEvent.succeed({ present: gitfill.present, images: gitfill.assets.filter((a) => a.kind === "image").length, notes: gitfill.notes.map((n) => n.path), docs: gitfill.docs.length });

  const template = README_TEMPLATES[request.template];
  const style = { ...template.style, ...request.style };
  const sections: ChosenSection[] = request.sections.length ? request.sections : template.sections.map((id) => ({ id }));
  const brief = [
    `README template: ${template.name}. Sections: ${sections.map((x) => x.title ?? x.id).join(", ")}.`,
    request.instructions ? `What the team asked for: ${request.instructions}` : "",
    request.answers ? `The team's answers:\n${request.answers}` : "",
    describeGitfill(gitfill),
  ]
    .filter(Boolean)
    .join("\n");
  const analysis = await analyzeRepository({ client, snapshot, userRequest: `Write or update the repository's README.md.\n${brief}`, recorder });
  const facts = codeFacts(analysis.context);

  // The team's screenshots and logo, copied under docs/readme/ so the README can show them.
  await recorder.setStage("composing_document");
  const workspaceId = (await db.select({ workspaceId: projects.workspaceId }).from(projects).where(eq(projects.id, job.projectId)))[0]?.workspaceId;
  const logoId = request.brand?.logoAssetId;
  const rows = workspaceId ? await uploadsByIds(db, workspaceId, [...new Set([...request.assetIds, ...(logoId ? [logoId] : [])])]) : [];
  const used = new Set<string>();
  const uploaded: ReadmeFile[] = [];
  let logo: string | undefined;
  for (const row of rows.filter((r) => r.kind === "image")) {
    const bytes = await getStorage().get(row.storageKey).catch(() => null);
    if (!bytes) continue;
    const isLogo = row.id === logoId;
    const name = isLogo ? assetFileName(`logo.${row.filename.split(".").pop() ?? "png"}`, used) : assetFileName(row.filename, used);
    uploaded.push({ path: `${README_ASSET_DIR}/${name}`, mime: row.mimeType, bytes, alt: row.description || row.filename, kind: isLogo ? "logo" : "screenshot" });
    if (isLogo) logo = `data:${row.mimeType};base64,${bytes.toString("base64")}`;
  }

  const visuals = await makeReadmeVisuals({
    client,
    recorder,
    name: request.brand?.name || String(snapshot.metadata.repo),
    analysis: analysis.analysis,
    claims: analysis.claims,
    facts,
    brief,
    wants: { banner: style.banner, diagrams: style.diagrams, badges: style.badges },
    paths: repositoryPaths(analysis.context),
    theme: readmeTheme(request.imageTheme ?? template.imageTheme, request.brand),
    logo,
  });
  const files = [...visuals.files, ...uploaded];

  const current = snapshot.files.find((f) => /^readme(\.md|\.markdown)?$/i.test(f.path))?.content;
  const readme = await generateReadme({
    client,
    snapshot,
    analysis: analysis.analysis,
    claims: analysis.claims,
    recorder,
    gitfill: describeGitfill(gitfill),
    current,
    instructions: request.instructions,
    design: {
      template,
      style,
      sections,
      reference: request.reference || undefined,
      files: files.map((f) => ({ path: f.path, alt: f.alt, kind: f.kind, description: f.kind === "screenshot" ? f.alt : undefined })),
      badges: visuals.badges.length ? badgeMarkdown(visuals.badges) : undefined,
      links: request.links,
      answers: request.answers || undefined,
      facts,
    },
  });

  // The files are kept with the document: shown in the preview, shipped in the pull request and the zip.
  const stored: StoredReadmeFile[] = [];
  for (const f of files) {
    const key = `documents/files/${job.id}/${f.path}`;
    const { sizeBytes } = await getStorage().put(key, f.bytes);
    stored.push({ path: f.path, mime: f.mime, alt: f.alt, kind: f.kind, key, sizeBytes });
  }

  const snap = await saveSnapshot(db, job.projectId, snapshot, { analysis: analysis.analysis, agent: { turns: analysis.turns, toolCalls: analysis.toolCalls } }, analysis.claims);
  const doc = await saveDocument(db, {
    projectId: job.projectId,
    kind: "readme",
    title: `README.md for ${snapshot.displayName}`,
    markdown: readme.markdown,
    spec: { updated: Boolean(current) },
    metadata: {
      request,
      repository: snapshot.displayName,
      commitSha: snapshot.version,
      branch: snapshot.branch,
      updatedExisting: Boolean(current),
      imagesAvailable: gitfill.assets.filter((a) => a.kind === "image").map((a) => a.path),
      removedImages: readme.removedImages,
      unknownPaths: readme.unknownPaths,
      template: template.id,
      files: stored,
      imageIssues: visuals.issues,
    },
    snapshotId: snap.id,
    jobId: job.id,
  });
  await complete(db, job.id, doc.id, snap.id);
}

/** A brainstorm from chat, written as an implementation spec grounded in the code. */
export async function runBrainstormJob(db: Database, job: Job, recorder: DbRecorder, client: MuseClient) {
  const request = brainstormRequestSchema.parse(job.options);
  await recorder.setStage("analyzing_repository");
  const github = await githubClientForJob(db, job);
  const snapshot = await ingest(github, job.repositoryUrl, request.branch ?? job.branch ?? undefined, recorder);
  await db.update(generationJobs).set({ branch: snapshot.branch, commitSha: snapshot.version }).where(eq(generationJobs.id, job.id));

  await recorder.setStage("composing_document");
  const result = await writeBrainstormSpec({ client, snapshot, conversation: request.conversation, title: request.title, recorder });
  const snap = await saveSnapshot(db, job.projectId, snapshot, {}, result.claims);
  const doc = await saveDocument(db, {
    projectId: job.projectId,
    kind: "brainstorm",
    title: result.spec.title,
    markdown: result.markdown,
    spec: result.spec,
    metadata: { repository: snapshot.displayName, commitSha: snapshot.version, branch: snapshot.branch, tasks: result.spec.tasks.length, openQuestions: result.spec.openQuestions.length },
    snapshotId: snap.id,
    jobId: job.id,
  });
  await complete(db, job.id, doc.id, snap.id);
}
