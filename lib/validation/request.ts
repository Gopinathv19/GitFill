import { z } from "zod";
import { THEMES } from "@/lib/presentation/spec";

export const generateRequestSchema = z.object({
  repositoryUrl: z.string().trim().min(3).max(500),
  branch: z.string().trim().max(200).optional(),
  audience: z.string().trim().min(2).max(120).default("Engineering team"),
  purpose: z.string().trim().max(240).default("Explain the repository's architecture, components, data flow, technology stack and deployment."),
  slideCount: z.number().int().min(4).max(16).default(8),
  theme: z.enum(THEMES).default("midnight"),
  instructions: z.string().trim().max(2000).default(""),
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
