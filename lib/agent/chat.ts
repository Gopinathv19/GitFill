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
import { askUserSchema, formatQuestions, type AskUser } from "@/lib/client/questions";
import { AppNotInstalledError } from "@/lib/connectors/github/app";
import { GitHubError } from "@/lib/connectors/github/client";
import { DeliveryError } from "@/lib/gitfill/deliver";
import type { CodeSource } from "@/lib/repo-store";
import { MemoryRecorder, type LiveEvent } from "./recorder";
import { createSearchTools } from "./search-tools";
import { logTimings } from "./timings";
import { defineTool, runToolLoop } from "./tool-loop";

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
- save_brainstorm to write the current brainstorm up as an implementation spec for a coding agent, grounded in the code. Runs in the background.
- open_pull_request to add a finished document to its repository as a pull request: a README becomes README.md, handbooks and other docs go to .gitfill/docs/, brainstorm specs and implementation briefs to .gitfill/brainstorm/. Only when the user asks for it.
- start_video to make an explainer video (1080p MP4 with original music) and its thumbnail from an existing presentation. Runs in the background. A video needs a presentation of that repository; if there is none, offer to make the presentation first.
Otherwise always finish with reply.

Before a handbook, presentation or video: agree the intent
A document is only as good as its fit to the reader, and most of that cannot be read from code: who will read it and what they will do with it, what story it should tell (product pitch, onboarding, engineering walkthrough, investor or judge review…), which parts deserve depth, what must be named or shown, and what to leave out. So when the user asks for a handbook, presentation or video:
1. Scout first. Look at the repository with list_files / grep / read_file (README, top-level directories, manifests, docs, entry points) until you know what is distinctive about it: its apps or modules, its audience-facing features, the external services or sponsors it highlights, its docs and screenshots.
2. Work out which decisions about the document the request and the code leave open, and ask about those, and only those, with ask_user. Write the questions yourself for this repository; ground every option in something you found (name the real modules, features, services). 1-4 questions, one round. Add a short intro saying what you found.
3. When the user answers (or says to just go ahead), write the brief and start the job. The brief is a compact plain-text spec: reader and goal, framing and tone, sections or topics that must be covered (with the paths you found), names to feature, things to skip, depth, anything to show (screenshots, demo path, Q&A). Put the user's own words into it.
Skip asking when the user has already given that intent, says "just go" / "use your judgment", or is asking for a revision. Never ask the same thing twice.

Presentations
- Decide the deck type from the request (${DECK_TYPES.map((t) => `${t}: ${DECK_TYPE_DEFS[t].label}`).join("; ")}); ask only when the request leaves it open.
- Unless the user already chose a look, include one question with kind "template" so they pick from the template gallery; its options are template ids, the one that suits the deck type first. Templates:
${describeTemplates()}
- Unless the user already attached files, include one question with kind "upload" offering to take screenshots, a logo, a .pptx template (its colours and fonts become the deck's brand) or documents (product notes, results, roadmap); options name what would help this deck (e.g. "Screenshots of the dashboard").
- Files the user attached appear in their messages as an \`attachments\` block with upload ids. Pass the ids of images and documents to use as asset_ids; a template's id too (its brand is applied).
- Put must-cover topics and things to skip from the answers into must_cover and avoid, and everything else they told you into brief.

READMEs
- Unless the user already said how they want it, ask (one round, ask_user) which README template fits (options are the templates below, the one that suits the repository first, with the id in the option's detail), which sections to add or drop from it (multiple: true, name real parts of the repository), and offer an upload question (kind "upload") for screenshots or a logo. Templates: ${README_TEMPLATE_IDS.map((id) => `${id}: ${README_TEMPLATES[id].name} — ${README_TEMPLATES[id].description}`).join("; ")}.
- Section ids you can pass: ${SECTIONS.map((x) => x.id).join(", ")}, or "custom" with a title and note. If the user pastes a README they like, pass it as reference.
- Pass the answers to start_readme: template, sections, banner/diagrams/badges, asset_ids from attachments, links, and their words as answers.

Brainstorming
When the user wants to think through a feature or change for a repository, be a sharp engineering partner: look at the relevant code first (list_files, grep, read_file), then discuss options and trade-offs grounded in what the code does today, ask focused questions one round at a time, and keep track of what has been decided. Do not write code. When they are happy with the idea, or ask to save or hand it off, call save_brainstorm with a short title; the spec is written from this conversation, so summarise the decisions in your last reply before saving if they are scattered.

The .gitfill folder
Repositories can have a .gitfill folder: .gitfill/assets (screenshots, logo, brand.json and notes the team adds for GitFill), .gitfill/docs (docs GitFill wrote) and .gitfill/brainstorm (specs GitFill wrote for coding agents). If someone asks how to get better READMEs, decks or videos, suggest adding screenshots and a short product note to .gitfill/assets.

Rules:
- Only start background work when the user clearly asks for it. If the request is ambiguous (several repositories and none named, missing commit refs), ask a short question instead.
- Start only the kind of work the user asked for. If a start_* tool returns an error, tell the user what failed in your reply; never start a different kind of job (e.g. a presentation instead of a video) as a substitute unless they ask.
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
  const sourceFor = (repositoryId: string) => {
    let source = sources.get(repositoryId);
    if (!source) {
      source = openWorkspaceRepository(db, userId, workspaceId, repositoryId, recorder);
      source.catch(() => sources.delete(repositoryId));
      sources.set(repositoryId, source);
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
        input: (t.input as z.ZodObject).extend({ repository_id: z.string().uuid() }),
        run: async ({ repository_id, ...args }: { repository_id: string } & Record<string, unknown>) =>
          act(async () => {
            const source = await sourceFor(repository_id);
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
      name: "ask_codebase",
      description: "Answer a question about one repository's code now, with sources and an optional diagram. The answer goes to the user directly and ends the turn.",
      input: z.object({
        repository_id: z.string().uuid(),
        question: z.string().min(3).max(4000),
        diagram: z.enum(["auto", "flowchart", "sequence", "class", "er", "component", "dependency", "none"]).default("auto"),
      }),
      run: async (i) =>
        act(async () => {
          const result = await askRepository(db, userId, workspaceId, i.repository_id, { question: i.question, diagram: i.diagram }, { save: false, recorder });
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
      }),
      run: async (i) =>
        act(async () => {
          const { job, repo } = await startHandbook(db, userId, workspaceId, i.repository_id, { audience: i.audience, scope: i.scope, focus: i.focus ?? "", instructions: i.instructions ?? "", brief: i.brief ?? "" });
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
        brand_accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Brand colour the user named, as #rrggbb."),
        logo_asset_id: z.string().uuid().optional().describe("Upload id of a logo image."),
        asset_ids: z.array(z.string().uuid()).max(30).optional().describe("Upload ids of screenshots, documents and templates to use."),
        must_cover: z.array(z.string().min(1).max(200)).max(12).optional(),
        avoid: z.array(z.string().min(1).max(200)).max(12).optional(),
        instructions: z.string().max(2000).optional(),
        brief: BRIEF,
      }),
      run: async (i) =>
        act(async () => {
          const brand = i.brand_accent || i.logo_asset_id ? { ...(i.brand_accent ? { accent: i.brand_accent } : {}), ...(i.logo_asset_id ? { logoAssetId: i.logo_asset_id } : {}) } : undefined;
          const { job, repo } = await startPresentation(db, userId, workspaceId, i.repository_id, {
            deckType: i.deck_type,
            audience: i.audience,
            purpose: i.purpose,
            slideCount: i.slide_count,
            minutes: i.minutes,
            theme: i.theme,
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
      }),
      run: async (i) =>
        act(async () => {
          const style = Object.fromEntries(Object.entries({ banner: i.banner, diagrams: i.diagrams, badges: i.badges }).filter(([, v]) => v !== undefined));
          const { job, repo } = await startReadme(db, userId, workspaceId, i.repository_id, {
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
      description: "Write this conversation's brainstorm up as an implementation spec for a coding agent, grounded in the repository's code. Returns a job id.",
      input: z.object({ repository_id: z.string().uuid(), title: z.string().min(3).max(100).describe("Short name of the idea.") }),
      run: async (i) =>
        act(async () => {
          // The spec is written from the conversation itself, so it carries every decision as it was made.
          const transcript = (await listMessages(db, sessionId, 80))
            .map((m) => `${m.role === "user" ? "User" : "GitFill"}: ${m.content}`)
            .join("\n\n")
            .slice(-60_000);
          const { job, repo } = await startBrainstorm(db, userId, workspaceId, i.repository_id, { title: i.title, conversation: transcript });
          jobIds.push(job.id);
          return { jobId: job.id, repository: repo.name, status: "queued" };
        }, "Could not save the brainstorm."),
    }),
    defineTool({
      name: "open_pull_request",
      description: "Open a pull request that adds a document to its repository (README.md, .gitfill/docs or .gitfill/brainstorm). Returns the pull request link.",
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
    system: `${CHAT_SYSTEM_PROMPT}\n\n${describeWorkspace(workspace)}`,
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

/** Workspace contents for the system prompt, so the agent needs no lookup turn before acting. */
function describeWorkspace(ws: Awaited<ReturnType<typeof getWorkspace>>): string {
  const repos = ws.repositories.map((r) => `- ${r.fullName} — id ${r.id}, default branch ${r.defaultBranch ?? "unknown"}, ${r.source}${r.analyzable ? "" : ", not analyzable"}`);
  const docs = ws.documents.map((d) => `- ${d.kind}: ${d.title} — id ${d.id}${d.repository ? `, ${d.repository}` : ""}`);
  const decks = ws.presentations.map((p) => `- ${p.title} — id ${p.id}, version ${p.latestVersion}`);
  return [
    `Workspace: ${ws.name}`,
    `Repositories:\n${repos.join("\n") || "- none"}`,
    `Documents:\n${docs.join("\n") || "- none"}`,
    `Presentations:\n${decks.join("\n") || "- none"}`,
  ].join("\n\n");
}
