import { z } from "zod";
import { formatAttachments, type Attachment } from "./attachments";

/**
 * Questions the chat agent writes for the user before a handbook or presentation. They are stored
 * in the reply's text as a fenced `questions` JSON block, so the model sees what it asked in the
 * history and the UI can render them as a card; no separate storage is needed.
 */
export const askUserSchema = z.object({
  intro: z.string().max(1200).default("").describe("One or two sentences on what you found in the code that the questions build on; in the confirm round, the brief you will use."),
  questions: z
    .array(
      z.object({
        question: z.string().min(3).max(240),
        why: z.string().max(200).optional().describe("What the answer changes in the document."),
        options: z
          .array(z.object({ label: z.string().min(1).max(80), detail: z.string().max(160).optional().describe("The repository evidence behind this option.") }))
          .min(2)
          .max(4),
        multiple: z.boolean().default(false).describe("True when several options can apply together."),
        kind: z
          .enum(["choice", "template", "upload"])
          .default("choice")
          .describe('choice = pick options; template = the user picks a deck template from the gallery (options: template ids); upload = ask the user for screenshots, a logo or documents (options: what kinds of files would help).'),
      }),
    )
    .min(1)
    .max(4),
});

export type AskUser = z.infer<typeof askUserSchema>;

const FENCE = "```questions";
const BLOCK = /```questions\n([\s\S]*?)\n```/;

export function formatQuestions(ask: AskUser): string {
  return [ask.intro.trim(), `${FENCE}\n${JSON.stringify({ questions: ask.questions })}\n\`\`\``].filter(Boolean).join("\n\n");
}

/**
 * How many rounds of questions the agent has asked since work was last started (an assistant
 * message with jobs), so the chat's intent loop has a real limit.
 */
export function questionRounds(history: Array<{ role: string; content: string; jobIds?: string[] }>): number {
  let rounds = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role !== "assistant") continue;
    // Only the rounds in a row count: a plain reply or an answer ends the intent loop.
    if (m.jobIds?.length || !BLOCK.test(m.content)) break;
    rounds++;
  }
  return rounds;
}

/** Splits a reply into its text and its questions block, if it has a valid one. */
export function parseQuestions(content: string): { text: string; ask: AskUser | null } {
  const match = BLOCK.exec(content);
  if (!match) return { text: content, ask: null };
  let json: unknown;
  try {
    json = JSON.parse(match[1]!);
  } catch {
    return { text: content, ask: null };
  }
  const parsed = askUserSchema.safeParse(json);
  if (!parsed.success) return { text: content, ask: null };
  return { text: content.replace(match[0], "").trim(), ask: parsed.data };
}

/**
 * The user's answers as a chat message: one line per question, chosen options plus their own words.
 * Uploads answered in the card are listed by id so the agent can pass them to the job.
 */
export function formatAnswers(ask: AskUser, answers: Array<{ chosen: string[]; other: string; uploads?: Attachment[] }>): string {
  const files: Attachment[] = [];
  const lines = ask.questions
    .map((q, i) => {
      const a = answers[i] ?? { chosen: [], other: "" };
      files.push(...(a.uploads ?? []));
      const parts = [...a.chosen, a.other.trim(), ...(a.uploads ?? []).map((u) => `uploaded ${u.filename}`)].filter(Boolean);
      return `${i + 1}. ${q.question} — ${parts.length ? parts.join("; ") : "no preference, use your judgment"}`;
    })
    .join("\n");
  return lines + formatAttachments(files);
}
