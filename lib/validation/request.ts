import { z } from "zod";
import { THEMES } from "@/lib/presentation/spec";

export const generateRequestSchema = z.object({
  repositoryUrl: z.string().trim().min(3).max(500),
  branch: z.string().trim().max(200).optional(),
  audience: z.string().trim().min(2).max(120).default("Engineering team"),
  purpose: z.string().trim().max(240).default("Explain the repository's architecture, components, data flow, technology stack and deployment."),
  slideCount: z.number().int().min(4).max(16).default(10),
  theme: z.enum(THEMES).default("midnight"),
  instructions: z.string().trim().max(2000).default(""),
  /** The reader brief agreed with the user in chat: who reads it, why, framing, must-cover and skip. */
  brief: z.string().trim().max(4000).default(""),
  outputs: z
    .object({
      pdf: z.boolean().default(true),
      readme: z.boolean().default(true),
      illustrations: z.boolean().default(true),
    })
    .default({ pdf: true, readme: true, illustrations: true }),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;

export const reviseRequestSchema = z.object({
  instruction: z.string().trim().min(3).max(2000),
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

export const readmeRequestSchema = z.object({
  /** What the team wants from the README, in their words. */
  instructions: z.string().trim().max(2000).default(""),
  branch: z.string().trim().max(200).optional(),
});

export type ReadmeRequest = z.infer<typeof readmeRequestSchema>;

export const brainstormRequestSchema = z.object({
  title: z.string().trim().min(3).max(100),
  /** The brainstorm as it happened in chat, captured when the spec was requested. */
  conversation: z.string().trim().min(20).max(60_000),
  branch: z.string().trim().max(200).optional(),
});

export type BrainstormRequest = z.infer<typeof brainstormRequestSchema>;
