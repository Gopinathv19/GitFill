import { z } from "zod";
import { MuseClient, type ChatCompletionMessageParam } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { suffixFootnotes } from "@/lib/client/answer-parts";
import { env } from "@/lib/config/env";
import type { Database } from "@/lib/db";
import { THEMES } from "@/lib/presentation/spec";
import { HANDBOOK_AUDIENCES, REUSE_KINDS } from "@/lib/understanding/schemas";
import { ActionError, askRepository, openWorkspaceRepository, revisePresentation, startComparison, startHandbook, startPresentation, startReuseBrief } from "@/lib/workspaces/actions";
import { getWorkspace, listMessages } from "@/lib/workspaces/service";
import { askUserSchema, formatQuestions, type AskUser } from "@/lib/client/questions";
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
Otherwise always finish with reply.

Before a handbook or presentation: agree the intent
A document is only as good as its fit to the reader, and most of that cannot be read from code: who will read it and what they will do with it, what story it should tell (product pitch, onboarding, engineering walkthrough, investor or judge review…), which parts deserve depth, what must be named or shown, and what to leave out. So when the user asks for a handbook or presentation:
1. Scout first. Look at the repository with list_files / grep / read_file (README, top-level directories, manifests, docs, entry points) until you know what is distinctive about it: its apps or modules, its audience-facing features, the external services or sponsors it highlights, its docs and screenshots.
2. Work out which decisions about the document the request and the code leave open, and ask about those, and only those, with ask_user. Write the questions yourself for this repository; ground every option in something you found (name the real modules, features, services). 1-4 questions, one round. Add a short intro saying what you found.
3. When the user answers (or says to just go ahead), write the brief and start the job. The brief is a compact plain-text spec: reader and goal, framing and tone, sections or topics that must be covered (with the paths you found), names to feature, things to skip, depth, anything to show (screenshots, demo path, Q&A). Put the user's own words into it.
Skip asking when the user has already given that intent, says "just go" / "use your judgment", or is asking for a revision. Never ask the same thing twice.

Rules:
- Only start background work when the user clearly asks for it. If the request is ambiguous (several repositories and none named, missing commit refs), ask a short question instead.
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
      return { error: err instanceof ActionError ? err.message : fallback };
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
      description: "Ask the user 1-4 questions you wrote, each with 2-4 options grounded in what you found in the code. The user can also answer in their own words. Ends your turn.",
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
        audience: z.string().max(120).optional(),
        purpose: z.string().max(240).optional(),
        slide_count: z.number().int().min(4).max(16).optional(),
        theme: z.enum(THEMES).optional(),
        instructions: z.string().max(2000).optional(),
        brief: BRIEF,
      }),
      run: async (i) =>
        act(async () => {
          const { job, repo } = await startPresentation(db, userId, workspaceId, i.repository_id, { audience: i.audience, purpose: i.purpose, slideCount: i.slide_count, theme: i.theme, instructions: i.instructions, brief: i.brief });
          jobIds.push(job.id);
          return { jobId: job.id, repository: repo.name, status: "queued" };
        }, "Could not start the presentation."),
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

  const { result } = await runToolLoop<{ message?: string } & Partial<AskUser>>({
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
  });
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
