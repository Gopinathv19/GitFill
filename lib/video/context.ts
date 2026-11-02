import type { DeckSpec } from "@/lib/presentation/spec";

/** The request as the director reads it: what the user asked for and the reader brief. */
export function videoBrief(opts: { spec: DeckSpec; brief: string; instructions: string }): string {
  return [
    `Audience: ${opts.spec.audience}`,
    `The deck's purpose: ${opts.spec.purpose}`,
    opts.instructions ? `What the user asked for in this video: ${opts.instructions}` : "",
    opts.brief ? `Reader brief agreed with the user (it outranks the default arc):\n${opts.brief}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The deck (the story already grounded in the code) and the evidence behind it. */
export function videoContext(spec: DeckSpec, evidence: string): string {
  const deck = { project: spec.project, title: spec.title, subtitle: spec.subtitle, slides: spec.slides };
  return [`The project's presentation deck (JSON; slide content cites claim refs):\n${JSON.stringify(deck)}`, evidence].join("\n\n");
}
