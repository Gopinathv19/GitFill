import type { TemplateId } from "./themes";

/**
 * What kind of presentation a deck is. The type decides the story (which sections, in what
 * order), how much text a page carries, which page recipes fit, and how full a page must be
 * before validation calls it unfinished. A pitch and an architecture review about the same
 * repository should not look like the same deck.
 *
 * Pure data: safe to import in client components.
 */

export const DECK_TYPES = ["engineering_walkthrough", "hackathon_pitch", "architecture_review", "onboarding", "stakeholder_update", "tech_talk"] as const;
export type DeckType = (typeof DECK_TYPES)[number];

export type Density = "airy" | "balanced" | "dense";

export interface DeckTypeDef {
  id: DeckType;
  label: string;
  description: string;
  defaultAudience: string;
  /** Typical speaking time per slide, used to turn minutes into a slide count. */
  minutesPerSlide: number;
  density: Density;
  suggestedTemplate: TemplateId;
  /** The story the outline follows when the user's brief does not decide it. */
  story: string;
  /** Page recipes that suit this kind of deck. */
  recipes: string;
}

export const DECK_TYPE_DEFS: Record<DeckType, DeckTypeDef> = {
  engineering_walkthrough: {
    id: "engineering_walkthrough",
    label: "Engineering walkthrough",
    description: "How the system is built and how its key flows work, for engineers.",
    defaultAudience: "Engineering team",
    minutesPerSlide: 1.5,
    density: "dense",
    suggestedTemplate: "midnight",
    story: "what it is and why → capabilities → architecture → how the key flows work (one page per traced workflow) → data and integrations → security / operations / setup → reference.",
    recipes: [
      "What it is: split · cards (4, 2 columns) + takeaway | steps (vertical, \"How it works\").",
      "System map: stack · architecture diagram + takeaway callout.",
      "Components: stack · components (6, 3 columns), or split · components | table.",
      "A request end to end: stack · sequence diagram built from a traced workflow (+ callout).",
      "Pipeline / how X works: split · flow diagram | explain + stats.",
      "Lifecycle / routing: stack · states or decision diagram, or split · states | list.",
      "Data model: split · table | list + callout.",
      "Setup and operations: split · code or steps | list with statuses + limit callout.",
      "Quick reference: stats + table or code; closing: glossary | flashcards.",
    ].join("\n"),
  },
  hackathon_pitch: {
    id: "hackathon_pitch",
    label: "Hackathon pitch",
    description: "A short, punchy story for judges: problem, demo, how it works, what's next.",
    defaultAudience: "Hackathon judges",
    minutesPerSlide: 0.6,
    density: "airy",
    suggestedTemplate: "aurora",
    story: "the problem (who hurts and why) → the solution in one sentence → demo (screenshots, the user's path) → how it works (one simple architecture picture) → what is technically hard or novel → impact / results → what's next → thanks + Q&A.",
    recipes: [
      "Problem: split_even · callout (takeaway, the pain in one sentence) | stats (2-3 numbers only if the evidence has them) or list (3 points).",
      "Solution: stack · cards (3, 3 columns) + takeaway.",
      "Demo: stack · image (a user screenshot) + callout, or split · image | steps (vertical, the user's path).",
      "How it works: stack · architecture diagram with at most 8 nodes.",
      "Technical highlight: split · flow diagram | explain.",
      "What's next: split_even · list (planned, with status badges) | callout.",
      "Close: split_even · callout (the one thing to remember) | flashcards (judge questions).",
    ].join("\n"),
  },
  architecture_review: {
    id: "architecture_review",
    label: "Architecture review",
    description: "Structure, boundaries, decisions and their trade-offs, risks and open questions.",
    defaultAudience: "Architects and senior engineers",
    minutesPerSlide: 2,
    density: "dense",
    suggestedTemplate: "paper",
    story: "context and goals → system map (components, boundaries, deployable units) → module dependencies → key flows (sequence diagrams from traced workflows) → data and storage → design decisions with evidence and trade-offs → risks, limits and technical debt → open questions → recommendations.",
    recipes: [
      "System map: stack · architecture diagram (zones for deployable units / trust boundaries) + note callout.",
      "Dependencies: split · table (module · depends on · why) | list + callout.",
      "Key flow: stack · sequence diagram + limit callout.",
      "Decision: split_even · explain (purpose / behaviour / value / limits) | table (option · chosen · trade-off).",
      "Risks: split · list with statuses | callout (limit).",
      "Open questions: split_even · list | list.",
    ].join("\n"),
  },
  onboarding: {
    id: "onboarding",
    label: "Onboarding guide",
    description: "Orient a new developer: the big picture, where things live, how to run and change it.",
    defaultAudience: "New developers joining the team",
    minutesPerSlide: 1.5,
    density: "balanced",
    suggestedTemplate: "evergreen",
    story: "what the product does → the big picture (one architecture diagram) → the repository map (where things live, where to start) → how a request flows → the data model → how to run it locally → how to make a change (tests, conventions) → where to get help / glossary.",
    recipes: [
      "Repository map: split · table (path · owns · start here) | callout.",
      "Big picture: stack · architecture diagram + takeaway.",
      "Run it locally: split · code (real commands) | list (prerequisites) + limit callout.",
      "Make a change: split · steps (vertical) | list (conventions).",
      "Glossary: stack · glossary.",
    ].join("\n"),
  },
  stakeholder_update: {
    id: "stakeholder_update",
    label: "Stakeholder update",
    description: "Outcomes, status and risks for managers and non-engineers; little jargon.",
    defaultAudience: "Engineering managers and product stakeholders",
    minutesPerSlide: 1.2,
    density: "balanced",
    suggestedTemplate: "daylight",
    story: "summary (what it does, for whom) → capabilities and their status (implemented / partial / planned) → how it fits together (simple architecture) → what it depends on (services, data) → risks and limits → next steps and decisions needed.",
    recipes: [
      "Summary: split · cards (3-4) + takeaway | stats.",
      "Capabilities: stack · cards (6, 3 columns, with status badges).",
      "How it fits: stack · architecture diagram with at most 8 nodes + callout.",
      "Risks: split · list with statuses | callout (limit).",
      "Next steps: split_even · steps | list.",
    ].join("\n"),
  },
  tech_talk: {
    id: "tech_talk",
    label: "Tech talk",
    description: "A conference or meetup talk: one big idea, explained step by step with diagrams.",
    defaultAudience: "Developers at a meetup",
    minutesPerSlide: 1,
    density: "airy",
    suggestedTemplate: "graphite",
    story: "the hook (a question or problem the audience has) → the idea in one sentence → how it works, one mechanism per page with a diagram → code that shows it (real lines) → lessons and trade-offs → takeaways.",
    recipes: [
      "Hook: split_even · callout (the question) | stats or image.",
      "Mechanism: stack · flow or sequence diagram + one callout.",
      "Code: split · code (real lines) | explain.",
      "Lessons: split_even · list | callout.",
      "Takeaways: stack · cards (3) + takeaway.",
    ].join("\n"),
  },
};

/** Share of the page body that must be used before a page counts as unfinished. */
export const UNDERFILL_BY_DENSITY: Record<Density, number> = { airy: 0.32, balanced: 0.48, dense: 0.6 };

const DENSITY_RULES: Record<Density, string> = {
  airy: `Density: airy. Presentation slides, not handbook pages. One idea per page with 1-2 blocks; at most 3 cards, 4 list items or 5 table rows; short sentences (under 15 words). Big diagrams and images. White space is intended: do not fill the page with extra blocks. Put detail in the speaker notes.`,
  balanced: `Density: balanced. 2-3 blocks per page; at most 4-6 cards, 6 list items or 7 table rows. Each page should look complete but not crowded; a takeaway callout often closes it. Detail that does not fit goes into the speaker notes.`,
  dense: `Density: dense. Handbook-style pages: 2-4 blocks, information-rich, but never more than about 6 cards, 7 list items, 8 table rows or 14 diagram nodes per page. A main column with one short block looks unfinished: add a takeaway, stats or a list.`,
};

export function densityRules(d: Density): string {
  return DENSITY_RULES[d];
}

export function deckTypeDef(id: string | undefined): DeckTypeDef {
  return DECK_TYPE_DEFS[(DECK_TYPES as readonly string[]).includes(id ?? "") ? (id as DeckType) : "engineering_walkthrough"];
}

/** Slides for a talk of `minutes`, within the deck's bounds. */
export function slidesForMinutes(type: DeckType, minutes: number): number {
  return Math.max(4, Math.min(20, Math.round(minutes / DECK_TYPE_DEFS[type].minutesPerSlide) + 1));
}
