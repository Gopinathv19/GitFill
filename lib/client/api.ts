/** Browser-side helpers for the GitFill JSON API envelope. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string } };
  if (!res.ok || body.error) throw new ApiError(body.error?.message ?? `Request failed (${res.status})`, body.error?.code ?? "error", res.status);
  return body.data as T;
}

export const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
