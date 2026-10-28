import type { artifacts } from "@/lib/db/schema";
import { getStorage } from "@/lib/storage";

/** Streams a stored artifact with safe headers. Storage keys come from the DB, never the request. */
export async function artifactResponse(artifact: typeof artifacts.$inferSelect, download: boolean): Promise<Response> {
  const data = await getStorage().get(artifact.storageKey);
  const inline = !download && (artifact.mimeType.startsWith("image/") || artifact.mimeType === "application/pdf");
  const filename = artifact.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": artifact.mimeType,
      "Content-Length": String(data.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
