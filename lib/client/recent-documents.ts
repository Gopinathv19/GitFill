/**
 * Recently opened documents, kept in this browser only (a per-viewer convenience, not data).
 * Storage can be unavailable (private windows, blocked site data), so every access is guarded.
 */
const KEY = "gitfill:recent-documents";
const MAX = 6;

export function recentDocumentIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberDocument(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...recentDocumentIds().filter((x) => x !== id)].slice(0, MAX)));
  } catch {
    // Not remembering is fine.
  }
}
