import { z } from "zod";
import { DECK_TYPES } from "@/lib/presentation/deck-types";
import { brandSchema, THEMES } from "@/lib/presentation/spec";
import { README_TEMPLATE_IDS } from "@/lib/readme/templates";

export const generateRequestSchema = z.object({
  repositoryUrl: z.string().trim().min(3).max(500),
  branch: z.string().trim().max(200).optional(),
  /** What kind of deck: decides the story, density and page recipes. */
  deckType: z.enum(DECK_TYPES).default("engineering_walkthrough"),
  /** Empty means the deck type's default audience. */
  audience: z.string().trim().max(120).default(""),
  /** Empty means the deck type's own goal. */
  purpose: z.string().trim().max(240).default(""),
  slideCount: z.number().int().min(4).max(20).default(10),
  /** Talk length; when set, the slide count follows from it and the deck type. */
  minutes: z.number().int().min(1).max(90).optional(),
  /** Template id; empty means the deck type's suggested template. */
  theme: z.enum(THEMES).optional(),
  brand: brandSchema.optional(),
  instructions: z.string().trim().max(2000).default(""),
  /** The reader brief agreed with the user in chat: who reads it, why, framing, must-cover and skip. */
  brief: z.string().trim().max(4000).default(""),
  /** The user's answers to GitFill's questions about this deck, as question — answer lines. */
  answers: z.string().trim().max(4000).default(""),
  mustCover: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  avoid: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
  /** Uploaded images and documents to use (ids from /api/workspaces/:id/uploads). */
  assetIds: z.array(z.string().uuid()).max(30).default([]),
  outputs: z
    .object({
      pdf: z.boolean().default(true),
      readme: z.boolean().default(false),
      illustrations: z.boolean().default(false),
      /** native = editable PowerPoint shapes and text; image = one picture per slide. */
      pptx: z.enum(["native", "image"]).default("native"),
    })
    .default({ pdf: true, readme: false, illustrations: false, pptx: "native" }),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const reviseRequestSchema = z.object({
  instruction: z.string().trim().min(3).max(2000),
  /** Switch template (and brand) without a model call; the instruction is then only the change summary. */
  theme: z.enum(THEMES).optional(),
  brand: brandSchema.nullable().optional(),
});

export type ReviseRequest = z.infer<typeof reviseRequestSchema>;

export const videoRequestSchema = z.object({
  /** What the user asked the video to be, in their words. */
  instructions: z.string().trim().max(2000).default(""),
  /** The reader brief agreed with the user in chat. */
  brief: z.string().trim().max(4000).default(""),
  seconds: z.number().int().min(20).max(150).default(60),
});

export type VideoRequest = z.infer<typeof videoRequestSchema>;

export const readmeSectionSchema = z.object({
  /** A catalogue section id (lib/readme/templates.ts) or "custom". */
  id: z.string().regex(/^[a-z_]{2,30}$/),
  title: z.string().trim().max(60).optional(),
  /** What the team wants in this section, in their words. */
  note: z.string().trim().max(400).optional(),
});

export const readmeRequestSchema = z.object({
  /** What the team wants from the README, in their words. */
  instructions: z.string().trim().max(2000).default(""),
  branch: z.string().trim().max(200).optional(),
  template: z.enum(README_TEMPLATE_IDS).default("showcase"),
  /** The contents, in order; empty means the template's own sections. */
  sections: z.array(readmeSectionSchema).max(30).default([]),
  /** A README the team likes, to follow for structure and style (its facts are never copied). */
  reference: z.string().max(40_000).default(""),
  /** Overrides of the template's style switches. */
  style: z
    .object({ banner: z.boolean(), badges: z.boolean(), emoji: z.boolean(), contents: z.boolean(), centered: z.boolean(), rules: z.boolean(), callout: z.boolean(), diagrams: z.boolean() })
    .partial()
    .default({}),
  /** Deck template whose colours the generated images use; empty means the README template's. */
  imageTheme: z.enum(THEMES).optional(),
  brand: brandSchema.optional(),
  /** Uploaded screenshots and a logo to add under docs/readme/. */
  assetIds: z.array(z.string().uuid()).max(12).default([]),
  /** Links for the header row, e.g. Live app, Demo video. */
  links: z.array(z.object({ label: z.string().trim().min(1).max(30), url: z.string().trim().url().max(300).refine((u) => /^https?:\/\//.test(u), "Use an http(s) link.") })).max(6).default([]),
  /** The team's answers to GitFill's questions about the README. */
  answers: z.string().trim().max(4000).default(""),
});

export type ReadmeRequest = z.infer<typeof readmeRequestSchema>;

export const brainstormRequestSchema = z.object({
  title: z.string().trim().min(3).max(100),
  /** The brainstorm as it happened in chat, captured when the spec was requested. */
  conversation: z.string().trim().min(20).max(60_000),
  branch: z.string().trim().max(200).optional(),
});

export type BrainstormRequest = z.infer<typeof brainstormRequestSchema>;
