import { z } from "zod";
import { DECK_TYPES } from "@/lib/presentation/deck-types";
import { THEMES } from "@/lib/presentation/spec";

/**
 * A user's configuration for GitFill's agent loop: how replies read, how much it asks before it
 * starts work, presentation defaults, and what it remembers about the user. Stored as JSON on the
 * user row; every field has a default, so a missing or older value always parses.
 */
export const memoryNoteSchema = z.object({
  id: z.string().min(1).max(40),
  text: z.string().trim().min(2).max(300),
  createdAt: z.string().max(40),
});

export const preferencesSchema = z.object({
  reply: z
    .object({
      tone: z.enum(["friendly", "concise", "formal", "technical"]).default("concise"),
      length: z.enum(["short", "medium", "detailed"]).default("short"),
      language: z.string().trim().max(40).default("English"),
      /** The user's own standing instructions, e.g. "always show file paths". */
      instructions: z.string().trim().max(1000).default(""),
    })
    .default({ tone: "concise", length: "short", language: "English", instructions: "" }),
  loop: z
    .object({
      /** Rounds of questions before a document or deck starts; 0 starts right away with defaults. */
      intentRounds: z.number().int().min(0).max(5).default(3),
      /** Ask presentation vs document vs README when the request does not say. */
      askFormat: z.boolean().default(true),
      /** Show the brief and wait for a yes before starting a job. */
      confirmBrief: z.boolean().default(true),
    })
    .default({ intentRounds: 3, askFormat: true, confirmBrief: true }),
  presentation: z
    .object({
      /** Style decks in the analyzed project's own colours and fonts. */
      useProjectTheme: z.boolean().default(true),
      /** Template used when the project theme is off (or for layout); unset = the deck type's choice. */
      template: z.enum(THEMES).optional(),
      deckType: z.enum(DECK_TYPES).optional(),
      slides: z.number().int().min(4).max(20).default(10),
      illustrations: z.boolean().default(false),
      pptx: z.enum(["native", "image"]).default("native"),
    })
    .default({ useProjectTheme: true, slides: 10, illustrations: false, pptx: "native" }),
  memory: z
    .object({
      /** When off, notes are kept but not used, and GitFill does not add new ones. */
      enabled: z.boolean().default(true),
      notes: z.array(memoryNoteSchema).max(50).default([]),
    })
    .default({ enabled: true, notes: [] }),
});

export type Preferences = z.infer<typeof preferencesSchema>;
export type MemoryNote = z.infer<typeof memoryNoteSchema>;

export const DEFAULT_PREFERENCES: Preferences = preferencesSchema.parse({});

/** Stored JSON to preferences; anything invalid falls back to defaults section by section. */
export function parsePreferences(raw: unknown): Preferences {
  const full = preferencesSchema.safeParse(raw ?? {});
  if (full.success) return full.data;
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(preferencesSchema.shape) as Array<keyof Preferences>) {
    const part = preferencesSchema.shape[key].safeParse(obj[key]);
    out[key] = part.success ? part.data : DEFAULT_PREFERENCES[key];
  }
  return out as Preferences;
}

/** The configuration as standing instructions for the chat agent's system prompt. */
export function describePreferences(p: Preferences): string {
  const tone = { friendly: "warm and friendly", concise: "concise and plain", formal: "formal and precise", technical: "technical, for an experienced engineer" }[p.reply.tone];
  const length = { short: "a few sentences", medium: "a short paragraph or a compact list", detailed: "thorough, with structure" }[p.reply.length];
  const memory = p.memory.enabled && p.memory.notes.length ? `What you remember about this user (from earlier conversations; follow it unless they say otherwise now):\n${p.memory.notes.map((n) => `- ${n.text}`).join("\n")}` : "";
  return [
    "The user's configuration (set on the Configuration page; it outranks the defaults above, but the user's words in this conversation outrank it):",
    `- Replies: ${tone}; length ${length}; write in ${p.reply.language || "English"}.`,
    p.reply.instructions ? `- Their standing instructions: ${p.reply.instructions}` : "",
    p.loop.intentRounds === 0
      ? "- Questions before work: none. Start the job straight away with sensible defaults and say which you chose."
      : `- Questions before work: at most ${p.loop.intentRounds} round${p.loop.intentRounds === 1 ? "" : "s"}.${p.loop.askFormat ? "" : " Do not ask which format (presentation, document, README) unless the request is truly unclear; pick the obvious one."}${p.loop.confirmBrief ? "" : " Do not ask them to confirm the brief; start once the questions are answered."}`,
    `- Presentations: ${p.presentation.useProjectTheme ? "use the project's own look (app_look) unless they pick a template" : "use a GitFill template, not the project's own look"}${p.presentation.template ? `; preferred template ${p.presentation.template}` : ""}${p.presentation.deckType ? `; usual deck type ${p.presentation.deckType}` : ""}; ${p.presentation.slides} slides unless they say otherwise. Do not ask about anything set here.`,
    p.memory.enabled ? "- Memory is on: when the user tells you a lasting preference or fact about themselves or their work (\"remember…\", \"always…\", \"I'm presenting to…\"), save it with remember." : "- Memory is off: do not save anything with remember.",
    memory,
  ]
    .filter(Boolean)
    .join("\n");
}
