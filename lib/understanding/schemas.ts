import { z } from "zod";
import { diagramSpecSchema } from "@/lib/analysis/mermaid";

/**
 * Structured outputs of the understanding features. Models fill these in; code validates
 * them, strips unknown claim refs, renders Markdown and Mermaid, and stores both.
 */

const refs = (re: RegExp, max = 8) => z.array(z.string().regex(re)).max(max).default([]).describe("Refs of recorded claims that support this item.");
const C = /^C\d+$/;
const RT = /^[RT]\d+$/;

const text = (max: number) => z.string().trim().min(1).max(max);
const bullet = (re: RegExp) => z.object({ text: text(300), claimRefs: refs(re), inferred: z.boolean().optional() });
const paragraph = (re: RegExp) => z.object({ text: text(1500), claimRefs: refs(re) });

// ─── Handbook ──────────────────────────────────────────────────────────────────

export const HANDBOOK_AUDIENCES = ["technical_handbook", "hackathon_pitch", "new_developer", "backend_deep_dive", "frontend_deep_dive"] as const;
export type HandbookAudience = (typeof HANDBOOK_AUDIENCES)[number];

export const explorationNotesSchema = z.object({
  workflows: z
    .array(
      z.object({
        name: text(80),
        trigger: text(200).describe("What starts it, e.g. 'POST /api/login from the web client'."),
        hops: z.array(z.object({ step: text(200), location: z.string().max(200).describe("path:line or path:start-end"), claimRefs: refs(C, 4) })).min(2).max(14),
      }),
    )
    .max(8),
  designDecisions: z.array(z.object({ decision: text(200), evidence: text(300), claimRefs: refs(C, 4), inferred: z.boolean().default(false) })).max(12),
  unclear: z.array(text(240)).max(10),
});
export type ExplorationNotes = z.infer<typeof explorationNotesSchema>;

export const handbookSpecSchema = z.object({
  title: text(90),
  subtitle: z.string().max(160).default(""),
  scope: text(160).describe("What this handbook covers, e.g. 'whole repository' or 'the authentication module'."),
  audience: z.enum(HANDBOOK_AUDIENCES),
  overview: z.object({ summary: paragraph(C), problemSolved: paragraph(C), keyFacts: z.array(bullet(C)).max(8) }),
  architecture: z.object({ narrative: paragraph(C), layers: z.array(z.object({ name: text(60), responsibility: text(240), paths: z.array(z.string().max(200)).max(8), claimRefs: refs(C) })).max(10), diagram: diagramSpecSchema.optional() }),
  directoryGuide: z.array(z.object({ path: text(200), purpose: text(240), startHere: z.array(z.string().max(200)).max(4).default([]), claimRefs: refs(C) })).max(20),
  workflows: z
    .array(
      z.object({
        name: text(80),
        description: paragraph(C),
        steps: z.array(z.object({ text: text(240), location: z.string().max(200).optional(), claimRefs: refs(C, 4) })).min(2).max(14),
        diagram: diagramSpecSchema.optional(),
      }),
    )
    .max(8),
  api: z.object({ narrative: z.string().max(1200).default(""), endpoints: z.array(z.object({ method: text(10), path: text(200), purpose: text(240), location: z.string().max(200).optional(), claimRefs: refs(C, 4) })).max(40) }),
  dataFlow: z.object({ narrative: paragraph(C), diagram: diagramSpecSchema.optional() }),
  dataModels: z.array(z.object({ name: text(80), purpose: text(240), location: z.string().max(200).optional(), claimRefs: refs(C, 4) })).max(20),
  erDiagram: diagramSpecSchema.optional(),
  techStack: z.array(z.object({ name: text(60), category: text(40), role: text(200), claimRefs: refs(C, 4) })).max(30),
  designDecisions: z.array(z.object({ decision: text(200), rationale: text(400), tradeoffs: z.string().max(300).optional(), claimRefs: refs(C, 4), inferred: z.boolean().default(false) })).max(12),
  presentationGuide: z.object({ narrative: z.array(z.object({ heading: text(80), talkingPoints: z.array(text(240)).min(1).max(6), minutes: z.number().min(0.5).max(20).optional() })).max(10), demoPath: z.array(text(240)).max(8).default([]) }),
  qa: z.array(z.object({ question: text(240), answer: text(800), claimRefs: refs(C, 4), inferred: z.boolean().default(false) })).max(16),
  gettingStarted: z.array(z.object({ step: text(200), command: z.string().max(200).optional(), claimRefs: refs(C, 4) })).max(12),
  openQuestions: z.array(text(240)).max(10),
});
export type HandbookSpec = z.infer<typeof handbookSpecSchema>;

export const handbookRequestSchema = z.object({
  scope: z.enum(["repository", "module", "feature"]).default("repository"),
  /** Directory or file path for module scope; description for feature scope. */
  focus: z.string().trim().max(400).default(""),
  audience: z.enum(HANDBOOK_AUDIENCES).default("technical_handbook"),
  instructions: z.string().trim().max(2000).default(""),
  branch: z.string().trim().max(200).optional(),
});
export type HandbookRequest = z.infer<typeof handbookRequestSchema>;

// ─── Explanation ───────────────────────────────────────────────────────────────

export const explanationSpecSchema = z.object({
  title: text(120),
  answer: z.string().min(1).max(12_000).describe("Markdown answer. Reference code as `path:line`."),
  claimRefs: refs(C, 30),
  references: z.array(z.object({ path: text(300), startLine: z.number().int().min(1), endLine: z.number().int().min(1), why: text(200) })).max(20),
  diagram: diagramSpecSchema.optional(),
  unverified: z.array(text(240)).max(8).describe("Parts of the answer the code could not confirm."),
  followUps: z.array(text(160)).max(4).default([]),
});
export type ExplanationSpec = z.infer<typeof explanationSpecSchema>;

export const askRequestSchema = z.object({
  question: z.string().trim().min(3).max(4000),
  branch: z.string().trim().max(200).optional(),
  /** Optional focus: a file path or symbol the question is about. */
  focus: z.string().trim().max(400).optional(),
  /** Ask for a diagram even when the question does not imply one. */
  diagram: z.enum(["auto", "flowchart", "sequence", "class", "er", "component", "dependency", "none"]).default("auto"),
});
export type AskRequest = z.infer<typeof askRequestSchema>;

// ─── Commit comparison ─────────────────────────────────────────────────────────

export const commitReportSchema = z.object({
  title: text(120),
  summary: z.array(bullet(C)).min(1).max(10).describe("What changed, as measured facts."),
  structuralBefore: diagramSpecSchema.optional(),
  structuralAfter: diagramSpecSchema.optional(),
  layerChanges: z.array(z.object({ change: text(240), kind: z.enum(["added_layer", "removed_layer", "moved_responsibility", "new_dependency", "interface_change", "data_model_change", "config_change", "other"]), claimRefs: refs(C, 4) })).max(16),
  impact: z.object({
    dependents: z.array(bullet(C)).max(12).describe("Modules that now depend on new/changed code."),
    interfaces: z.array(bullet(C)).max(12).describe("Changed function signatures, routes, schemas or contracts."),
    tests: z.array(bullet(C)).max(12).describe("Tests likely affected, by file."),
    dependencies: z.array(bullet(C)).max(12),
    risks: z.array(bullet(C)).max(10).describe("Potential regressions or compatibility concerns."),
  }),
  explanation: paragraph(C).describe("Developer-friendly narrative of what the new structure enables."),
  hypotheses: z.array(z.object({ text: text(300), basis: text(200).describe("Commit message, comment or pattern this rests on.") })).max(8),
  verified: z.array(text(240)).max(12).describe("Conclusions directly supported by the diff and code."),
});
export type CommitReportSpec = z.infer<typeof commitReportSchema>;

export const compareRequestSchema = z.object({
  base: z.string().trim().min(1).max(200),
  head: z.string().trim().min(1).max(200),
  focus: z.string().trim().max(2000).default("Focus on architectural and structural changes and their impact on the application."),
});
export type CompareRequest = z.infer<typeof compareRequestSchema>;

// ─── Architecture reuse ────────────────────────────────────────────────────────

export const REUSE_KINDS = ["architectural", "component", "implementation", "design", "dependency"] as const;
export type ReuseKind = (typeof REUSE_KINDS)[number];

export const reuseNotesSchema = z.object({
  patterns: z.array(z.object({ name: text(80), description: text(400), referenceLocations: z.array(z.string().max(200)).min(1).max(8), claimRefs: refs(RT, 6) })).min(1).max(16),
  targetTouchpoints: z.array(z.object({ pattern: text(80), where: text(200), note: text(300), claimRefs: refs(RT, 6) })).max(20),
  conflicts: z.array(z.object({ issue: text(300), resolution: text(300) })).max(10),
  unclear: z.array(text(240)).max(8),
});
export type ReuseNotes = z.infer<typeof reuseNotesSchema>;

export const implementationBriefSchema = z.object({
  title: text(120),
  objective: paragraph(RT),
  reuseKinds: z.array(z.enum(REUSE_KINDS)).min(1),
  referencePatterns: z.array(z.object({ name: text(80), whatItIs: text(400), whyItMatters: text(300), referenceFiles: z.array(z.string().max(200)).min(1).max(8), claimRefs: refs(RT, 6) })).min(1).max(16),
  targetState: z.object({ currentStructure: paragraph(RT), preserve: z.array(bullet(RT)).max(12), gaps: z.array(bullet(RT)).max(12) }),
  comparison: z.array(z.object({ aspect: text(80), reference: text(240), target: text(240), action: z.enum(["adopt", "adapt", "keep_target", "skip"]), claimRefs: refs(RT, 4) })).max(16),
  plan: z
    .array(
      z.object({
        order: z.number().int().min(1),
        path: text(300).describe("Target repository path."),
        action: z.enum(["create", "modify", "move", "delete"]),
        description: text(600),
        consultReference: z.array(z.string().max(200)).max(6).default([]),
        claimRefs: refs(RT, 4),
      }),
    )
    .min(1)
    .max(40),
  dependencies: z.array(z.object({ name: text(80), purpose: text(200), configuration: z.string().max(300).optional() })).max(16),
  constraints: z.array(bullet(RT)).max(16),
  doNotModify: z.array(z.string().max(200)).max(20),
  acceptanceCriteria: z.array(text(300)).min(1).max(16),
  tests: z.array(z.object({ description: text(240), command: z.string().max(200).optional(), existing: z.boolean().default(false) })).max(16),
  openQuestions: z.array(text(240)).max(10),
  targetDiagram: diagramSpecSchema.optional().describe("Target architecture after the change."),
});
export type ImplementationBrief = z.infer<typeof implementationBriefSchema>;

export const reuseRequestSchema = z.object({
  referenceRepositoryId: z.string().uuid(),
  targetRepositoryId: z.string().uuid(),
  request: z.string().trim().min(10).max(4000),
  reuseKinds: z.array(z.enum(REUSE_KINDS)).min(1).default(["architectural"]),
  referenceBranch: z.string().trim().max(200).optional(),
  targetBranch: z.string().trim().max(200).optional(),
});
export type ReuseRequest = z.infer<typeof reuseRequestSchema>;

// ─── Documentation assistance ──────────────────────────────────────────────────

export const docCommentsSchema = z.object({
  comments: z
    .array(
      z.object({
        /** 1-based line the comment is inserted before (the declaration line). */
        insertBeforeLine: z.number().int().min(1),
        symbol: z.string().max(120).optional(),
        kind: z.enum(["doc", "inline"]),
        text: text(2000).describe("The full comment text including comment markers, indented to match the declaration."),
        rationale: z.string().max(200).optional(),
      }),
    )
    .max(40),
  skipped: z.array(z.string().max(200)).max(20).describe("Declarations that needed no comment and why."),
});
export type DocComments = z.infer<typeof docCommentsSchema>;

export const docsDriftSchema = z.object({
  findings: z
    .array(
      z.object({
        original: text(600).describe("Exact text from the document that is now outdated."),
        issue: text(300),
        proposed: z.string().max(1200).describe("Replacement text, or empty to delete."),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(20),
  missing: z.array(text(300)).max(10).describe("Topics the changes introduce that the document does not cover."),
});
export type DocsDrift = z.infer<typeof docsDriftSchema>;
