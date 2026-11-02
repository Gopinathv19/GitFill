import { z } from "zod";

/**
 * Files attached to a chat message. They travel inside the message text as a fenced
 * `attachments` JSON block, so the agent sees them in the history (with the upload ids it passes
 * to jobs) and the UI renders them as chips; no extra storage is needed.
 */
export const attachmentSchema = z.object({
  id: z.string().uuid(),
  filename: z.string().max(200),
  kind: z.enum(["image", "document", "template"]),
  description: z.string().max(600).default(""),
});
export type Attachment = z.infer<typeof attachmentSchema>;

const BLOCK = /\n*```attachments\n([\s\S]*?)\n```/;

export function formatAttachments(list: Attachment[]): string {
  if (!list.length) return "";
  return `\n\n\`\`\`attachments\n${JSON.stringify(list.map((a) => ({ id: a.id, filename: a.filename, kind: a.kind, description: a.description.slice(0, 300) })))}\n\`\`\``;
}

/** Splits a message into its text and its attachments, if it has a valid block. */
export function parseAttachments(content: string): { text: string; attachments: Attachment[] } {
  const match = BLOCK.exec(content);
  if (!match) return { text: content, attachments: [] };
  try {
    const parsed = z.array(attachmentSchema).max(30).safeParse(JSON.parse(match[1]!));
    if (!parsed.success) return { text: content, attachments: [] };
    return { text: content.replace(match[0], "").trim(), attachments: parsed.data };
  } catch {
    return { text: content, attachments: [] };
  }
}
