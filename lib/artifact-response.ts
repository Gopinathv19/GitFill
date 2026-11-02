import type { artifacts } from "@/lib/db/schema";
import { getStorage } from "@/lib/storage";

/**
 * Streams a stored artifact with safe headers. Storage keys come from the DB, never the request.
 * Honors a single byte range (`Range: bytes=a-b`) so browsers can seek in videos.
 */
export async function artifactResponse(artifact: typeof artifacts.$inferSelect, download: boolean, range?: string | null): Promise<Response> {
  const data = await getStorage().get(artifact.storageKey);
  const inline = !download && (artifact.mimeType.startsWith("image/") || artifact.mimeType.startsWith("video/") || artifact.mimeType === "application/pdf");
  const filename = artifact.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const headers: Record<string, string> = {
    "Content-Type": artifact.mimeType,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  };
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (match && (match[1] || match[2])) {
    const size = data.byteLength;
    // "bytes=-N" is the last N bytes.
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    return new Response(new Uint8Array(data.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "Content-Length": String(data.byteLength) } });
}
