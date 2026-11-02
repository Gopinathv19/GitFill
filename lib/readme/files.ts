import { z } from "zod";

/** A file a README ships with (generated image, screenshot, logo), as stored on the document. */
export const readmeFileSchema = z.object({
  /** Repository path, e.g. docs/readme/architecture.svg. */
  path: z.string(),
  mime: z.string(),
  alt: z.string(),
  kind: z.enum(["banner", "architecture", "flow", "screenshot", "logo"]),
  /** Storage key of the bytes. */
  key: z.string(),
  sizeBytes: z.number(),
});
export type StoredReadmeFile = z.infer<typeof readmeFileSchema>;

/** The files recorded on a document's metadata; anything malformed is ignored. */
export function documentFiles(metadata: unknown): StoredReadmeFile[] {
  const parsed = readmeFileSchema.array().safeParse((metadata as { files?: unknown } | null)?.files ?? []);
  return parsed.success ? parsed.data : [];
}
