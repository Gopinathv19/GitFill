import { MuseClient } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { UNTRUSTED_CONTENT_RULE } from "@/lib/ai/prompts";
import { askUserSchema, type AskUser } from "@/lib/client/questions";
import type { Database } from "@/lib/db";
import { deckTypeDef, type DeckType } from "@/lib/presentation/deck-types";
import { README_TEMPLATES, SECTION_BY_ID, type ReadmeTemplateId } from "@/lib/readme/templates";
import { uploadsByIds } from "@/lib/uploads/service";
import { openWorkspaceRepository } from "@/lib/workspaces/actions";
import { MemoryRecorder } from "./recorder";
import { createSearchTools } from "./search-tools";
import { defineTool, runToolLoop } from "./tool-loop";

const SCOUT_TOOLS = ["list_files", "grep", "read_file", "outline_file"];

const DECK_QUESTIONS_PROMPT = `You prepare a presentation about a code repository, the way a careful engineer asks before writing code: look first, then ask only what you cannot decide yourself.

${UNTRUSTED_CONTENT_RULE}

1. Scout the repository with list_files, grep, read_file and outline_file: README, top-level directories, manifests, entry points, routes, docs and screenshots. Find what is distinctive: its apps or modules, its user-facing features, the main flows, external services, anything that looks like results or numbers.
2. Then call ask_user once with 2-4 questions whose answers change the deck. Write each question for this repository and ground every option in something you found, naming the real modules, flows, features and services (put the path or evidence in the option's detail). Good questions decide:
   - which flows or features to feature in depth (multiple: true) and which to leave out,
   - what to demo or show (and whether the user has screenshots or results to upload),
   - the one message the audience should leave with,
   - framing for this audience (product story vs engineering walkthrough), when the deck type leaves it open.
3. Never ask about what is already decided below (deck type, template, audience, length, must-cover topics, uploaded files). Never ask generic questions that would fit any repository. intro: one or two sentences on what you found.`;

/**
 * Writes the questions GitFill asks before generating a deck, after scouting the repository with
 * read-only tools, like a coding agent asking before it writes code. Returns 2-4 grounded questions.
 */
export async function writeDeckQuestions(
  db: Database,
  userId: string,
  workspaceId: string,
  input: { repositoryId: string; deckType: DeckType; audience?: string; minutes?: number; notes?: string; mustCover?: string[]; assetIds?: string[] },
): Promise<AskUser> {
  const recorder = new MemoryRecorder();
  const source = await openWorkspaceRepository(db, userId, workspaceId, input.repositoryId, recorder);
  const uploads = await uploadsByIds(db, workspaceId, input.assetIds ?? []);
  const def = deckTypeDef(input.deckType);
  const tools = [
    ...createSearchTools(source).filter((t) => SCOUT_TOOLS.includes(t.name)),
    defineTool({ name: "ask_user", description: "Ask the user 2-4 grounded questions about the deck. Ends your work.", input: askUserSchema, terminal: true, run: async () => ({ shown: true }) }),
  ];
  const decided = [
    `Repository: ${source.label}`,
    `Deck type: ${def.label} — ${def.description}`,
    `Audience: ${input.audience || def.defaultAudience}`,
    input.minutes ? `Length: ${input.minutes} minutes` : "",
    input.mustCover?.length ? `Must cover: ${input.mustCover.join("; ")}` : "",
    input.notes ? `The user's own words about the deck: ${input.notes}` : "",
    uploads.length ? `Files the user uploaded:\n${uploads.map((u) => `- ${u.filename} (${u.kind}): ${u.description || "no description"}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const { result } = await runToolLoop<AskUser>({
    client: new MuseClient(recorder.modelObserver()),
    model: modelFor("analyst"),
    purpose: "deck_questions",
    system: DECK_QUESTIONS_PROMPT,
    messages: [{ role: "user", content: `Already decided:\n${decided}` }],
    tools,
    recorder,
    reasoningEffort: "low",
    maxTurns: 8,
    maxToolCalls: 16,
    maxTokens: 8000,
  });
  // Template and upload questions belong to the chat; the wizard has its own steps for them.
  const ask = askUserSchema.parse(result);
  const questions = ask.questions.filter((q) => q.kind === "choice");
  return { intro: ask.intro, questions: questions.length ? questions : ask.questions.slice(0, 1).map((q) => ({ ...q, kind: "choice" as const })) };
}

const README_QUESTIONS_PROMPT = `You prepare a README for a code repository, the way a careful engineer asks before writing: look first, then ask only what you cannot decide yourself.

${UNTRUSTED_CONTENT_RULE}

1. Scout the repository with list_files, grep, read_file and outline_file: the current README, manifests, entry points, routes, docs, screenshots and any .gitfill folder. Find what the project is, who uses it, its main features and flows, how it is run, and what is missing from the current README.
2. Then call ask_user once with 2-4 questions whose answers change the README. Ground every option in something you found (name the real features, apps, services and commands; put the path in the option's detail). Good questions decide:
   - the one-line pitch or tagline (offer 2-3 drafts written from the code),
   - who the README is for (users of the product, developers integrating it, contributors, judges),
   - which features or flows to show first and draw as diagrams (multiple: true),
   - links the header should carry (live app, demo video, docs) when the repository does not show them,
   - what the banner should show (a chat exchange, a terminal session, feature cards) when a banner is planned.
3. Never ask about what is already decided below. Never ask generic questions that would fit any repository. intro: one or two sentences on what you found, including what the current README is missing.`;

/** Grounded questions to ask before writing a README, after scouting the repository. */
export async function writeReadmeQuestions(
  db: Database,
  userId: string,
  workspaceId: string,
  input: { repositoryId: string; template: ReadmeTemplateId; sections?: string[]; notes?: string; hasBanner?: boolean; links?: string[] },
): Promise<AskUser> {
  const recorder = new MemoryRecorder();
  const source = await openWorkspaceRepository(db, userId, workspaceId, input.repositoryId, recorder);
  const template = README_TEMPLATES[input.template];
  const tools = [
    ...createSearchTools(source).filter((t) => SCOUT_TOOLS.includes(t.name)),
    defineTool({ name: "ask_user", description: "Ask the user 2-4 grounded questions about the README. Ends your work.", input: askUserSchema, terminal: true, run: async () => ({ shown: true }) }),
  ];
  const decided = [
    `Repository: ${source.label}`,
    `README template: ${template.name} — ${template.description}`,
    `Sections: ${(input.sections?.length ? input.sections : template.sections).map((id) => SECTION_BY_ID.get(id)?.title ?? id).join(", ")}`,
    `Banner planned: ${input.hasBanner ?? template.style.banner ? "yes" : "no"}`,
    input.links?.length ? `Links already given: ${input.links.join(", ")}` : "",
    input.notes ? `The user's own words: ${input.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const { result } = await runToolLoop<AskUser>({
    client: new MuseClient(recorder.modelObserver()),
    model: modelFor("analyst"),
    purpose: "readme_questions",
    system: README_QUESTIONS_PROMPT,
    messages: [{ role: "user", content: `Already decided:\n${decided}` }],
    tools,
    recorder,
    reasoningEffort: "low",
    maxTurns: 8,
    maxToolCalls: 16,
    maxTokens: 8000,
  });
  const ask = askUserSchema.parse(result);
  const questions = ask.questions.filter((q) => q.kind === "choice");
  return { intro: ask.intro, questions: questions.length ? questions : ask.questions.slice(0, 1).map((q) => ({ ...q, kind: "choice" as const })) };
}

