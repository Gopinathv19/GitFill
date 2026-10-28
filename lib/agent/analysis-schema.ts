import { z } from "zod";

const refs = z.array(z.string().regex(/^C\d+$/)).max(8).describe("Refs of recorded claims (e.g. C3) that support this item.");

export const repositoryAnalysisSchema = z.object({
  projectName: z.string().min(1).max(80),
  oneLiner: z.string().min(1).max(200).describe("What the project is, in one sentence."),
  purpose: z.object({ text: z.string().max(600), claimRefs: refs }),
  architectureStyle: z.object({ text: z.string().max(400).describe("e.g. 'Next.js monolith with route handlers and a Postgres database'"), claimRefs: refs }),
  components: z
    .array(z.object({ name: z.string().max(60), responsibility: z.string().max(300), paths: z.array(z.string()).max(6), claimRefs: refs }))
    .min(1)
    .max(12),
  dataFlow: z.array(z.object({ step: z.string().max(240), from: z.string().max(60).optional(), to: z.string().max(60).optional(), claimRefs: refs })).max(10),
  techStack: z
    .array(
      z.object({
        name: z.string().max(60),
        category: z.enum(["language", "framework", "database", "infrastructure", "tooling", "library", "service", "testing"]),
        role: z.string().max(160),
        claimRefs: refs,
      }),
    )
    .max(24),
  apis: z.array(z.object({ name: z.string().max(100), description: z.string().max(300), claimRefs: refs })).max(12),
  dataModels: z.array(z.object({ name: z.string().max(80), description: z.string().max(300), claimRefs: refs })).max(12),
  deployment: z.array(z.object({ aspect: z.string().max(80), description: z.string().max(300), claimRefs: refs })).max(10),
  setup: z.array(z.object({ step: z.string().max(200), command: z.string().max(200).optional(), claimRefs: refs })).max(10),
  openQuestions: z.array(z.string().max(240)).max(8).describe("Things the evidence could not settle."),
});

export type RepositoryAnalysis = z.infer<typeof repositoryAnalysisSchema>;

/** Every claimRefs array in an analysis, for reference validation. */
export function collectAnalysisRefs(a: RepositoryAnalysis): string[] {
  const out: string[] = [...a.purpose.claimRefs, ...a.architectureStyle.claimRefs];
  for (const list of [a.components, a.dataFlow, a.techStack, a.apis, a.dataModels, a.deployment, a.setup]) {
    for (const item of list) out.push(...item.claimRefs);
  }
  return out;
}

/** Drops refs to claims that do not exist, returning the cleaned analysis and what was removed. */
export function pruneAnalysisRefs(a: RepositoryAnalysis, known: ReadonlySet<string>): { analysis: RepositoryAnalysis; removed: string[] } {
  const removed: string[] = [];
  const clean = (r: string[]) =>
    r.filter((x) => {
      if (known.has(x)) return true;
      removed.push(x);
      return false;
    });
  const mapItems = <T extends { claimRefs: string[] }>(items: T[]) => items.map((i) => ({ ...i, claimRefs: clean(i.claimRefs) }));
  return {
    analysis: {
      ...a,
      purpose: { ...a.purpose, claimRefs: clean(a.purpose.claimRefs) },
      architectureStyle: { ...a.architectureStyle, claimRefs: clean(a.architectureStyle.claimRefs) },
      components: mapItems(a.components),
      dataFlow: mapItems(a.dataFlow),
      techStack: mapItems(a.techStack),
      apis: mapItems(a.apis),
      dataModels: mapItems(a.dataModels),
      deployment: mapItems(a.deployment),
      setup: mapItems(a.setup),
    },
    removed,
  };
}
