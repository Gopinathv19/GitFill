import { z } from "zod";
import { MuseClient, type ChatCompletionMessageParam } from "@/lib/ai/client";
import { modelFor } from "@/lib/ai/models";
import { env } from "@/lib/config/env";
import type { Database } from "@/lib/db";
import { THEMES } from "@/lib/presentation/spec";
import { HANDBOOK_AUDIENCES, REUSE_KINDS } from "@/lib/understanding/schemas";
import { ActionError, askRepository, revisePresentation, startComparison, startHandbook, startPresentation, startReuseBrief } from "@/lib/workspaces/actions";
import { getWorkspace, listMessages } from "@/lib/workspaces/service";
import { MemoryRecorder, type LiveEvent } from "./recorder";
import { logTimings } from "./timings";
import { defineTool, runToolLoop } from "./tool-loop";

const CHAT_SYSTEM_PROMPT = `You are GitFill, an assistant inside a user's workspace. GitFill helps developers understand, explain, reuse and evolve codebases. The workspace holds GitHub repositories and the documents and presentations generated from them.

The repositories, documents and presentations in this workspace are listed at the end of this message.

You can act through tools:
- ask_codebase to answer a question about the code of one repository right now (how something works, what happens when…, why X calls Y, relationships, a diagram). The answer with sources is sent to the user directly and ends your turn, so call it without a reply.
- start_handbook to generate a repository, module or feature handbook (technical handbook, hackathon pitch guide, new-developer guide, backend/frontend deep dive). Runs in the background.
- start_commit_comparison to explain the architectural and structural changes between two commits, branches or tags. Runs in the background.
- start_reuse_brief to write an implementation brief that transfers patterns from a reference repository into a target repository. Runs in the background.
- start_presentation to generate a validated PowerPoint deck; revise_presentation to change one. Runs in the background.
Otherwise always finish with reply.

Rules:
- Only start background work when the user clearly asks for it. If the request is ambiguous (several repositories and none named, missing commit refs), ask a short question via reply instead.
- Use the exact ids from the workspace listing. Never invent ids, repositories, commits or results.
- Background jobs show progress below your message; do not claim they are finished.
- For questions about the code, prefer ask_codebase over guessing. Never answer code questions from memory.
- Keep replies short and plain.`;

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

  const tools = [
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
      }),
      run: async (i) =>
        act(async () => {
          const { job, repo } = await startHandbook(db, userId, workspaceId, i.repository_id, { audience: i.audience, scope: i.scope, focus: i.focus ?? "", instructions: i.instructions ?? "" });
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
      }),
      run: async (i) =>
        act(async () => {
          const { job, repo } = await startPresentation(db, userId, workspaceId, i.repository_id, { audience: i.audience, purpose: i.purpose, slideCount: i.slide_count, theme: i.theme, instructions: i.instructions });
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

  const { result } = await runToolLoop<{ message?: string }>({
    client: new MuseClient(recorder.modelObserver()),
    model: modelFor("analyst"),
    purpose: "workspace_chat",
    system: `${CHAT_SYSTEM_PROMPT}\n\n${describeWorkspace(workspace)}`,
    messages,
    tools,
    recorder,
    // The chat agent only routes to tools; deep reasoning happens inside them.
    reasoningEffort: "minimal",
    maxTurns: 6,
    maxToolCalls: 8,
    maxTokens: 2000,
  });
  logTimings(recorder, `chat turn (${jobIds.length} jobs started, ${attachments.length} answers attached)`);
  const reply = [result.message, attachments.join("\n\n---\n\n")].filter(Boolean).join("\n\n");
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
