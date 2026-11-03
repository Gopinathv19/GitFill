import { z } from "zod";
import { MuseClient, type ChatCompletionMessageParam } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { suffixFootnotes } from "@/lib/client/answer-parts";
import { env } from "@/lib/config/env";
import type { Database } from "@/lib/db";
import { DECK_TYPES, DECK_TYPE_DEFS } from "@/lib/presentation/deck-types";
import { THEMES } from "@/lib/presentation/spec";
import { describeTemplates } from "@/lib/presentation/themes";
import { README_TEMPLATE_IDS, README_TEMPLATES, SECTIONS } from "@/lib/readme/templates";
import { HANDBOOK_AUDIENCES, REUSE_KINDS } from "@/lib/understanding/schemas";
import { ActionError, askRepository, openPullRequest, openWorkspaceRepository, revisePresentation, startBrainstorm, startReadme, startVideo, startComparison, startHandbook, startPresentation, startReuseBrief } from "@/lib/workspaces/actions";
import { getWorkspace, listMessages } from "@/lib/workspaces/service";
import { askUserSchema, formatQuestions, questionRounds, type AskUser } from "@/lib/client/questions";
import { AppNotInstalledError } from "@/lib/connectors/github/app";
import { GitHubError } from "@/lib/connectors/github/client";
import { describeRepoBrand, readRepoBrandFromSource } from "@/lib/gitfill/brand";
import { DeliveryError } from "@/lib/gitfill/deliver";
import type { CodeSource } from "@/lib/repo-store";
import { MemoryRecorder, type LiveEvent } from "./recorder";
import { createSearchTools } from "./search-tools";
import { logTimings } from "./timings";
import { defineTool, runToolLoop } from "./tool-loop";

/** Rounds of ask_user the agent may spend agreeing a document's intent before it must start. */
export const INTENT_MAX_ROUNDS = 3;

const CHAT_SYSTEM_PROMPT = `You are GitFill, an assistant inside a user's workspace. GitFill helps developers understand, explain, reuse and evolve codebases. The workspace holds GitHub repositories and the documents and presentations generated from them.

The repositories, documents and presentations in this workspace are listed at the end of this message.

You can act through tools:
- list_files, grep, read_file and outline_file to look at a repository's code yourself (read-only, quick). Use them to scout before asking the user anything about a document.
- ask_user to ask the user questions you wrote, each with options drawn from what you found in the code. It ends your turn; their answers arrive as the next message.
- ask_codebase to answer a question about the code of one repository right now (how something works, what happens when…, why X calls Y, relationships, a diagram). The answer with sources is sent to the user directly and ends your turn, so call it without a reply.
- start_handbook to generate a repository, module or feature handbook. Runs in the background.
- start_commit_comparison to explain the architectural and structural changes between two commits, branches or tags. Runs in the background.
- start_reuse_brief to write an implementation brief that transfers patterns from a reference repository into a target repository. Runs in the background.
- start_presentation to generate a validated presentation deck; revise_presentation to change one. Runs in the background.
- start_readme to write or update a repository's README.md from the code and the team's .gitfill/assets (screenshots, logo, brand and notes). Runs in the background.
- app_look to read the repository's own look (brand colours, background, fonts and where they come from, plus what is missing), for the look question before a presentation or README.
- save_brainstorm to write the current brainstorm up as an implementation spec for a coding agent, grounded in the code, and (with pull_request) add it to the repository's .gitfill/knowledge folder. Runs in the background.
- open_pull_request to add a finished document to its repository as a pull request: a README becomes README.md, handbooks and other docs go to .gitfill/docs/, brainstorm specs and implementation briefs to .gitfill/knowledge/ (with its index for coding agents). Only when the user asks for it.
- start_video to make an explainer video (1080p MP4 with original music) and its thumbnail from an existing presentation. Runs in the background. A video needs a presentation of that repository; if there is none, offer to make the presentation first.
Otherwise always finish with reply.

Before a handbook, presentation, README or video: agree the intent, in rounds
A document is only as good as its fit to the reader, and most of that cannot be read from code: who will read it and what they will do with it, what story it should tell (product pitch, onboarding, engineering walkthrough, investor or judge review…), which parts deserve depth, what must be named or shown, and what to leave out. So before you start any of these jobs, run an intent loop of up to ${INTENT_MAX_ROUNDS} rounds of ask_user (the current round count is given at the end of this message):
1. Scout first. Look at the repository with list_files / grep / read_file (README, top-level directories, manifests, docs, entry points, .gitfill/assets) until you know what is distinctive about it: its apps or modules, its audience-facing features, the external services or sponsors it highlights, its docs and screenshots.
2. Round 1 — what and for whom. If the user has not said which format they want, ask it first, never pick it yourself: a presentation (slides to present), a document (a handbook to read: technical handbook, onboarding guide, deep dive…), a README, a video (made from a presentation) or a combination; say in each option what it is good for given what they asked. In the same round ask who the reader or audience is and the one thing they should leave with, and what scope (whole repository, one module, one feature, naming the real ones).
3. Round 2 — content and look. Ask which flows or features to feature in depth (multiple: true) and what to skip; for a presentation its length (default 10 pages; speaker notes are always included); and the look: call app_look first and offer "the app's own look" (name the colours and fonts it found and where) against a GitFill template (a kind "template" question only when they want a template). Offer an upload question (kind "upload") for screenshots, a logo or documents unless they already attached some or .gitfill/assets has them.
4. Last round — confirm. Write the brief you will use back to the user in a few lines (format, reader and goal, scope, must-cover with paths, skip, length, look, assets) as the intro of one ask_user question: "Generate it like this?" with options such as "Yes, generate" and "Change something". Start the job only after they confirm.
Every round: 1-4 questions, each grounded in something you found (name the real modules, features, services; put the path in the option's detail), and a short intro saying what you learned from their last answers. Skip a round when its decisions are already made, and skip straight to the job when the user says "just go" / "use your judgment", asks for a revision, or the round limit is reached (then go with sensible defaults and say which you chose). Never ask the same thing twice.
When you start the job, the brief is a compact plain-text spec: reader and goal, framing and tone, sections or topics that must be covered (with the paths you found), names to feature, things to skip, depth, anything to show (screenshots, demo path, Q&A). Put the user's own words into it.

Presentations
- Decide the deck type from the request (${DECK_TYPES.map((t) => `${t}: ${DECK_TYPE_DEFS[t].label}`).join("; ")}); ask only when the request leaves it open.
- The deck uses the app's own look (colours and fonts read from its stylesheets, Tailwind config and .gitfill/assets/brand.json) by default. When the user picks a gallery template instead, pass theme and app_look: false; when they want the template's layout with their app's colours, pass both theme and app_look: true. For a template, ask with kind "template"; its options are template ids, the one that suits the deck type first. Templates:
${describeTemplates()}
- Unless the user already attached files, include one question with kind "upload" offering to take screenshots, a logo, a .pptx template (its colours and fonts become the deck's brand) or documents (product notes, results, roadmap); options name what would help this deck (e.g. "Screenshots of the dashboard").
- Files the user attached appear in their messages as an \`attachments\` block with upload ids. Pass the ids of images and documents to use as asset_ids; a template's id too (its brand is applied).
- Put must-cover topics and things to skip from the answers into must_cover and avoid, and everything else they told you into brief.
- For a stakeholder update or a "what's new / since the last release" deck, ask (in a round you already run) which tag, branch or commit to report changes since, offering the real recent tags or branches you found, and pass it as changes_since. Without it, a stakeholder update shows the latest commits.

READMEs
- Unless the user already said how they want it, ask (one round, ask_user) which README template fits (options are the templates below, the one that suits the repository first, with the id in the option's detail), which sections to add or drop from it (multiple: true, name real parts of the repository), and offer an upload question (kind "upload") for screenshots or a logo. Templates: ${README_TEMPLATE_IDS.map((id) => `${id}: ${README_TEMPLATES[id].name} — ${README_TEMPLATES[id].description}`).join("; ")}.
- Section ids you can pass: ${SECTIONS.map((x) => x.id).join(", ")}, or "custom" with a title and note. If the user pastes a README they like, pass it as reference.
- Pass the answers to start_readme: template, sections, banner/diagrams/badges, asset_ids from attachments, links, and their words as answers.

Brainstorming
When the user wants to think through a feature or change for a repository, be a sharp engineering partner: look at the relevant code first (list_files, grep, read_file, and earlier specs in .gitfill/knowledge), then discuss options and trade-offs grounded in what the code does today, ask focused questions one round at a time (ask_user works here too), and keep track of what has been decided. Do not write code. When they are happy with the idea, or ask to save or hand it off, summarise the decisions and what is still open in one reply and ask whether to save it to the repository's .gitfill/knowledge folder as a pull request (so coding agents can build it) or only in GitFill. Then call save_brainstorm with a short title and pull_request set to their choice; the spec is written from this conversation, so the summary must be in it.

The .gitfill folder
Repositories can have a .gitfill folder: .gitfill/assets (screenshots, logo, brand.json and notes the team adds for GitFill; presentations, READMEs and specs all read it), .gitfill/docs (docs GitFill wrote) and .gitfill/knowledge (brainstorm specs GitFill wrote for coding agents, listed in .gitfill/knowledge/index.md; older repositories may have .gitfill/brainstorm). If someone asks how to get better READMEs, decks or videos, suggest adding screenshots, a brand.json and a short product note to .gitfill/assets. When app_look reports missing colours or fonts, tell the user they can add them in .gitfill/assets/brand.json.

Rules:
- Only start background work when the user clearly asks for it. If the request is ambiguous (several repositories and none named, missing commit refs), ask a short question instead.
- Start only the kind of work the user asked for. If a start_* tool returns an error, tell the user what failed in your reply; never start a different kind of job (e.g. a presentation instead of a video) as a substitute unless they ask.
- Each repository is read at its working branch (in the workspace listing; the user switches it from the branch menu next to the repository). When the user names another branch, tag or commit for a request ("on the dev branch", "at v2.1"), pass it as branch to the scouting tools and to the job; never switch to a branch they did not name.
- Use the exact ids from the workspace listing. Never invent ids, repositories, commits or results.
- Background jobs show progress below your message; do not claim they are finished.
- For questions about the code, prefer ask_codebase over guessing. Never answer code questions from memory.
- Keep replies short and plain.`;

const SCOUT_TOOLS = ["list_files", "grep", "read_file", "outline_file"];

/** Placeholder source used only to read the search tools' names, descriptions and input schemas. */
const EMPTY_SOURCE: CodeSource = {
  label: "",
  version: "",
  listFiles: async () => ({ paths: [], total: 0 }),
  grep: async () => ({ hits: [], truncated: false }),
  read: async () => null,
};

const BRANCH = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .describe("Only when the user named a branch, tag or commit for this request; otherwise the repository's working branch from the workspace listing is used.");

const BRIEF = z
  .string()
  .max(4000)
  .optional()
  .describe("The reader brief agreed with the user: reader and goal, framing and tone, must-cover topics (with paths), names to feature, things to skip, depth, what to show.");

export interface ChatTurnResult {
  reply: string;
  jobIds: string[];
}

/**
 * One chat turn: Muse Spark reads the recent conversation and acts through
 * workspace-scoped tools. Every job it starts is real and shown as a live card.
 */
export async function runChatTurn(db: Database, userId: string, workspaceId: string, sessionId: string, opts: { live?: (event: LiveEvent) => void } = {}): Promise<ChatTurnResult> {
  if (!env().MODEL_API_KEY) {
    return {
      reply: "The Muse model isn't configured yet (MODEL_API_KEY is missing), so I can't act on chat messages. You can still start handbooks, comparisons and presentations from the buttons on each repository.",
      jobIds: [],
    };
  }
  const jobIds: string[] = [];
  const attachments: string[] = [];
  const recorder = new MemoryRecorder(opts.live);
  const [history, workspace] = await Promise.all([listMessages(db, sessionId, 16), getWorkspace(db, userId, workspaceId)]);
  const messages: ChatCompletionMessageParam[] = history.map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }));
  const act = async <T>(fn: () => Promise<T>, fallback: string) => {
    try {
      return await fn();
    } catch (err) {
      // Errors written for users (no access, nothing to deliver, GitHub refused) go to the model as they are.
      if (err instanceof ActionError || err instanceof DeliveryError || err instanceof GitHubError || err instanceof AppNotInstalledError) return { error: err.message };
      // Unexpected failures (database, network) are logged for the operator; the model gets a plain message.
      console.error(`chat tool failed: ${fallback}`, err);
      return { error: `${fallback} This is a server-side problem, not something to work around: tell the user it failed and do not start other work instead.` };
    }
  };

  // Repositories opened for scouting in this turn, by id; opened lazily on first use.
  const sources = new Map<string, Promise<CodeSource>>();
  const sourceFor = (repositoryId: string, branch?: string) => {
    const key = `${repositoryId}@${branch ?? ""}`;
    let source = sources.get(key);
    if (!source) {
      source = openWorkspaceRepository(db, userId, workspaceId, repositoryId, recorder, branch);
      source.catch(() => sources.delete(key));
      sources.set(key, source);
    }
    return source;
  };
  // The search agent's primitives, each taking the repository to look in.
  const scoutTools = createSearchTools(EMPTY_SOURCE)
    .filter((t) => SCOUT_TOOLS.includes(t.name))
    .map((t) =>
      defineTool({
        name: t.name,
        description: `${t.description} Read-only; for scouting a repository before asking the user about a document.`,
        input: (t.input as z.ZodObject).extend({ repository_id: z.string().uuid(), branch: BRANCH }),
        run: async ({ repository_id, branch, ...args }: { repository_id: string; branch?: string } & Record<string, unknown>) =>
          act(async () => {
            const source = await sourceFor(repository_id, branch);
            const tool = createSearchTools(source).find((x) => x.name === t.name)!;
            return tool.run(tool.input.parse(args));
          }, "Could not read the repository."),
      }),
    );

  const tools = [
    ...scoutTools,
    defineTool({
      name: "ask_user",
      description: "Ask the user 1-4 questions you wrote, each with 2-4 options grounded in what you found in the code (kind \"template\" shows the template gallery, kind \"upload\" an upload box). The user can also answer in their own words. Ends your turn.",
      input: askUserSchema,
      terminal: true,
      run: async () => ({ shown: true }),
    }),
    defineTool({
      name: "app_look",
      description: "Read the repository's own look: brand colours, background, text colour and fonts from .gitfill/assets/brand.json, its stylesheets' CSS variables, its Tailwind config and the fonts it loads, with where each came from and what is missing.",
      input: z.object({ repository_id: z.string().uuid(), branch: BRANCH }),
      run: async (i) =>
        act(async () => {
          const found = await readRepoBrandFromSource(await sourceFor(i.repository_id, i.branch));
          return { ...found, summary: describeRepoBrand(found) };
        }, "Could not read the repository's look."),
    }),
    defineTool({
      name: "ask_codebase",
      description: "Answer a question about one repository's code now, with sources and an optional diagram. The answer goes to the user directly and ends the turn.",
      input: z.object({
        repository_id: z.string().uuid(),
        question: z.string().min(3).max(4000),
        branch: BRANCH,
        diagram: z.enum(["auto", "flowchart", "sequence", "class", "er", "component", "dependency", "none"]).default("auto"),
      }),
      run: async (i) =>
        act(async () => {
          const result = await askRepository(db, userId, workspaceId, i.repository_id, { question: i.question, diagram: i.diagram, ...(i.branch ? { branch: i.branch } : {}) }, { save: false, recorder });
          attachments.push(result.markdown);
          return { attached: true, title: result.title, repository: result.repository, commit: result.commitSha.slice(0, 7), unverified: result.unverified.length };
        }, "Could not answer the question."),
      // The answer is the reply: skip the extra model turn that would only introduce it.
      terminal: (r) => (r as { attached?: boolean }).attached === true,
    }),
    defineTool({
      name: "start_handbook",
      description: "Generate a handbook for a repository, a module (directory path) or a feature. Returns a job id.",
      input: z.object({
        repository_id: z.string().uuid(),
        audience: z.enum(HANDBOOK_AUDIENCES).default("technical_handbook"),
        scope: z.enum(["repository", "module", "feature"]).default("repository"),
        focus: z.string().max(400).optional().describe("Directory path for module scope, or a feature description."),
        instructions: z.string().max(2000).optional(),
        brief: BRIEF,
        branch: BRANCH,
      }),
      run: async (i) =>
        act(async () => {
          const { job, repo } = await startHandbook(db, userId, workspaceId, i.repository_id, { branch: i.branch, audience: i.audience, scope: i.scope, focus: i.focus ?? "", instructions: i.instructions ?? "", brief: i.brief ?? "" });
          jobIds.push(job.id);
          return { jobId: job.id, repository: repo.name, status: "queued" };
        }, "Could not start the handbook."),
    }),
    defineTool({
      name: "start_commit_comparison",
      description: "Explain architectural and structural changes between two commits, branches or tags of a repository. Returns a job id.",
      input: z.object({ repository_id: z.string().uuid(), base: z.string().min(1).max(200), head: z.string().min(1).max(200), focus: z.string().max(2000).optional() }),
      run: async (i) =>
        act(async () => {
          const { job, repo } = await startComparison(db, userId, workspaceId, i.repository_id, { base: i.base, head: i.head, ...(i.focus ? { focus: i.focus } : {}) });
          jobIds.push(job.id);
          return { jobId: job.id, repository: repo.name, status: "queued" };
        }, "Could not start the comparison."),
    }),
    defineTool({
      name: "start_reuse_brief",
      description: "Write an implementation brief that reuses patterns from a reference repository in a target repository. Returns a job id.",
      input: z.object({
        reference_repository_id: z.string().uuid(),
        target_repository_id: z.string().uuid(),
        request: z.string().min(10).max(4000).describe("What to reuse and what to keep, in the user's words."),
        reuse_kinds: z.array(z.enum(REUSE_KINDS)).min(1).default(["architectural"]),
      }),
      run: async (i) =>
        act(async () => {
          const { job, reference, target } = await startReuseBrief(db, userId, workspaceId, { referenceRepositoryId: i.reference_repository_id, targetRepositoryId: i.target_repository_id, request: i.request, reuseKinds: i.reuse_kinds });
          jobIds.push(job.id);
          return { jobId: job.id, reference: reference.name, target: target.name, status: "queued" };
        }, "Could not start the implementation brief."),
    }),
    defineTool({
      name: "start_presentation",
      description: "Start analyzing a repository and generating a presentation. Returns a job id.",
      input: z.object({
        repository_id: z.string().uuid(),
        deck_type: z.enum(DECK_TYPES).optional(),
        audience: z.string().max(120).optional(),
        purpose: z.string().max(240).optional(),
        slide_count: z.number().int().min(4).max(20).optional(),
        minutes: z.number().int().min(1).max(90).optional().describe("Talk length, when the user gave one; sets the slide count."),
        theme: z.enum(THEMES).optional().describe("Template id the user picked."),
        app_look: z.boolean().optional().describe("Use the app's own colours and fonts. Default: yes unless a template was picked."),
        changes_since: z.string().min(1).max(200).optional().describe("Tag, branch or commit to report changes since (e.g. v1.2, last release), for stakeholder updates and what's-new decks."),
        brand_accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Brand colour the user named, as #rrggbb."),
        logo_asset_id: z.string().uuid().optional().describe("Upload id of a logo image."),
        asset_ids: z.array(z.string().uuid()).max(30).optional().describe("Upload ids of screenshots, documents and templates to use."),
        must_cover: z.array(z.string().min(1).max(200)).max(12).optional(),
        avoid: z.array(z.string().min(1).max(200)).max(12).optional(),
        instructions: z.string().max(2000).optional(),
        brief: BRIEF,
        branch: BRANCH,
      }),
      run: async (i) =>
        act(async () => {
          const brand = i.brand_accent || i.logo_asset_id ? { ...(i.brand_accent ? { accent: i.brand_accent } : {}), ...(i.logo_asset_id ? { logoAssetId: i.logo_asset_id } : {}) } : undefined;
          const { job, repo } = await startPresentation(db, userId, workspaceId, i.repository_id, {
            branch: i.branch,
            deckType: i.deck_type,
            audience: i.audience,
            purpose: i.purpose,
            slideCount: i.slide_count,
            minutes: i.minutes,
            theme: i.theme,
            repoBrand: i.app_look,
            changesSince: i.changes_since,
            brand,
            assetIds: i.asset_ids,
            mustCover: i.must_cover,
            avoid: i.avoid,
            instructions: i.instructions,
            brief: i.brief,
          });
          jobIds.push(job.id);
          return { jobId: job.id, repository: repo.name, status: "queued" };
        }, "Could not start the presentation."),
    }),
    defineTool({
      name: "start_readme",
      description: "Write or update README.md for a repository from its code, the user's choices and uploads, with generated banner, architecture and flow images. Returns a job id.",
      input: z.object({
        repository_id: z.string().uuid(),
        template: z.enum(README_TEMPLATE_IDS).optional(),
        sections: z
          .array(z.object({ id: z.string().regex(/^[a-z_]{2,30}$/).describe('A section id from the catalogue, or "custom".'), title: z.string().max(60).optional(), note: z.string().max(400).optional() }))
          .max(30)
          .optional()
          .describe("The contents in order, when the user changed the template's."),
        banner: z.boolean().optional(),
        diagrams: z.boolean().optional(),
        badges: z.boolean().optional(),
        image_theme: z.enum(THEMES).optional().describe("Deck template whose colours the images use."),
        asset_ids: z.array(z.string().uuid()).max(12).optional().describe("Upload ids of screenshots to show."),
        logo_asset_id: z.string().uuid().optional(),
        links: z.array(z.object({ label: z.string().min(1).max(30), url: z.string().url().max(300) })).max(6).optional(),
        reference: z.string().max(20_000).optional().describe("A README the user pasted to follow for structure and style."),
        answers: z.string().max(4000).optional().describe("The user's answers to your questions, in their words."),
        instructions: z.string().max(2000).optional().describe("What the user wants from the README, in their words."),
        branch: BRANCH,
      }),
      run: async (i) =>
        act(async () => {
          const style = Object.fromEntries(Object.entries({ banner: i.banner, diagrams: i.diagrams, badges: i.badges }).filter(([, v]) => v !== undefined));
          const { job, repo } = await startReadme(db, userId, workspaceId, i.repository_id, {
            branch: i.branch,
            instructions: i.instructions ?? "",
            template: i.template,
            sections: i.sections,
            style,
            imageTheme: i.image_theme,
            assetIds: i.asset_ids,
            brand: i.logo_asset_id ? { logoAssetId: i.logo_asset_id } : undefined,
            links: i.links,
            reference: i.reference,
            answers: i.answers,
          });
          jobIds.push(job.id);
          return { jobId: job.id, repository: repo.name, status: "queued" };
        }, "Could not start the README."),
    }),
    defineTool({
      name: "save_brainstorm",
      description: "Write this conversation's brainstorm up as an implementation spec for a coding agent, grounded in the repository's code. With pull_request, also open a pull request adding it to .gitfill/knowledge. Returns a job id.",
      input: z.object({
        repository_id: z.string().uuid(),
        title: z.string().min(3).max(100).describe("Short name of the idea."),
        pull_request: z.boolean().default(false).describe("True when the user wants the spec in the repository's .gitfill/knowledge folder."),
        branch: BRANCH,
      }),
      run: async (i) =>
        act(async () => {
          // The spec is written from the conversation itself, so it carries every decision as it was made.
          const transcript = (await listMessages(db, sessionId, 80))
            .map((m) => `${m.role === "user" ? "User" : "GitFill"}: ${m.content}`)
            .join("\n\n")
            .slice(-60_000);
          const { job, repo } = await startBrainstorm(db, userId, workspaceId, i.repository_id, { title: i.title, conversation: transcript, pullRequest: i.pull_request, branch: i.branch });
          jobIds.push(job.id);
          return { jobId: job.id, repository: repo.name, status: "queued" };
        }, "Could not save the brainstorm."),
    }),
    defineTool({
      name: "open_pull_request",
      description: "Open a pull request that adds a document to its repository (README.md, .gitfill/docs or .gitfill/knowledge). Returns the pull request link.",
      input: z.object({ document_id: z.string().uuid() }),
      run: async (i) =>
        act(async () => {
          const pr = await openPullRequest(db, userId, i.document_id);
          return { pullRequest: pr.url, number: pr.number, file: pr.path, alreadyOpen: pr.existing === true };
        }, "Could not open the pull request."),
    }),
    defineTool({
      name: "start_video",
      description: "Make an explainer video and thumbnail from an existing presentation. Returns a job id.",
      input: z.object({
        presentation_id: z.string().uuid(),
        seconds: z.number().int().min(20).max(150).optional(),
        instructions: z.string().max(2000).optional().describe("What the video should be, in the user's words."),
        brief: BRIEF,
      }),
      run: async (i) =>
        act(async () => {
          const { job } = await startVideo(db, userId, i.presentation_id, { seconds: i.seconds, instructions: i.instructions, brief: i.brief });
          jobIds.push(job.id);
          return { jobId: job.id, status: "queued" };
        }, "Could not start the video."),
    }),
    defineTool({
      name: "revise_presentation",
      description: "Request a natural-language revision of an existing presentation. Returns a job id.",
      input: z.object({ presentation_id: z.string().uuid(), instruction: z.string().min(3).max(2000) }),
      run: async (i) =>
        act(async () => {
          const { job } = await revisePresentation(db, userId, i.presentation_id, i.instruction);
          jobIds.push(job.id);
          return { jobId: job.id, status: "queued" };
        }, "Could not start the revision."),
    }),
    defineTool({
      name: "reply",
      description: "Send the final reply to the user.",
      input: z.object({ message: z.string().min(1).max(2000) }),
      terminal: true,
      run: async () => ({ sent: true }),
    }),
  ];

  const loop = await runToolLoop<string | ({ message?: string } & Partial<AskUser>)>({
    client: new MuseClient(recorder.modelObserver()),
    model: modelFor("analyst"),
    purpose: "workspace_chat",
    system: `${CHAT_SYSTEM_PROMPT}\n\n${describeWorkspace(workspace)}\n\n${describeIntentRounds(history)}`,
    messages,
    tools,
    recorder,
    // Routing is light, but scouting a repository and writing grounded questions needs some reasoning;
    // hidden reasoning counts against maxTokens, so leave room for it.
    reasoningEffort: "low",
    maxTurns: 10,
    maxToolCalls: 24,
    maxTokens: 8000,
    trimHistory: { keepTurns: 3, maxChars: 120_000 },
    // A plain-text answer is a reply too; without this, two in a row failed the whole turn.
    finishOnText: true,
  }).catch((err) => {
    // Jobs already started must still reach the user as cards, so the turn ends with what happened.
    console.error("chat turn stopped early:", err);
    if (!jobIds.length && !attachments.length) throw err;
    return { result: { message: "I started the work below, but stopped before I could finish my reply." }, turns: 0, toolCalls: 0 };
  });
  const result: { message?: string } & Partial<AskUser> = typeof loop.result === "string" ? { message: loop.result } : loop.result;
  logTimings(recorder, `chat turn (${jobIds.length} jobs started, ${attachments.length} answers attached)`);
  // Each answer numbers its evidence from C1; keep refs unique when several are attached.
  const answers = attachments.map((a, i) => (i ? suffixFootnotes(a, String(i + 1)) : a));
  const questions = result.questions ? formatQuestions({ intro: result.intro ?? "", questions: result.questions }) : "";
  const reply = [result.message, questions, answers.join("\n\n---\n\n")].filter(Boolean).join("\n\n");
  return { reply, jobIds };
}

function describeIntentRounds(history: Array<{ role: string; content: string; jobIds?: string[] }>): string {
  const rounds = questionRounds(history);
  return rounds >= INTENT_MAX_ROUNDS
    ? `Intent rounds asked so far: ${rounds} of ${INTENT_MAX_ROUNDS}. The limit is reached: do not ask about the document again; start the job the user asked for with what you know and say which defaults you chose (a brainstorm may continue as plain discussion).`
    : `Intent rounds asked so far: ${rounds} of ${INTENT_MAX_ROUNDS}.`;
}

/** Workspace contents for the system prompt, so the agent needs no lookup turn before acting. */
function describeWorkspace(ws: Awaited<ReturnType<typeof getWorkspace>>): string {
  const repos = ws.repositories.map((r) => `- ${r.fullName} — id ${r.id}, working branch ${r.defaultBranch ?? "unknown"}, ${r.source}${r.analyzable ? "" : ", not analyzable"}`);
  const docs = ws.documents.map((d) => `- ${d.kind}: ${d.title} — id ${d.id}${d.repository ? `, ${d.repository}` : ""}`);
  const decks = ws.presentations.map((p) => `- ${p.title} — id ${p.id}, version ${p.latestVersion}`);
  return [
    `Workspace: ${ws.name}`,
    `Repositories:\n${repos.join("\n") || "- none"}`,
    `Documents:\n${docs.join("\n") || "- none"}`,
    `Presentations:\n${decks.join("\n") || "- none"}`,
  ].join("\n\n");
}
