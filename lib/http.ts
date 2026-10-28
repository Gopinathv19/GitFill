import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ConfigError } from "@/lib/config/env";
import { GitHubError } from "@/lib/connectors/github/client";
import { InvalidRepositoryUrlError } from "@/lib/connectors/github/url";
import { UnauthorizedError } from "@/lib/auth/current";

export class NotFoundError extends Error {
  override name = "NotFoundError";
}

/** Consistent JSON envelope: { data } on success, { error: { code, message } } on failure. */
export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function fail(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID_RE.test(v);

/** Maps known errors to HTTP responses without leaking internals. */
export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    return fail(400, "invalid_request", "Request validation failed.", err.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  if (err instanceof UnauthorizedError) return fail(401, "unauthorized", err.message);
  if (err instanceof NotFoundError) return fail(404, "not_found", err.message);
  if (err instanceof InvalidRepositoryUrlError) return fail(400, "invalid_repository_url", err.message);
  // GitHub errors carry user-safe messages (rate limits, not found, private repositories).
  // 401 from GitHub is reported as 409 so the browser client does not treat it as a GitFill sign-out.
  if (err instanceof GitHubError) return fail(err.code === "not_found" ? 404 : err.code === "rate_limited" ? 429 : err.code === "unauthorized" ? 409 : 502, `github_${err.code}`, err.message);
  if (err instanceof SyntaxError) return fail(400, "invalid_json", "Request body must be valid JSON.");
  if (err instanceof ConfigError) {
    console.error(err.message);
    return fail(503, "not_configured", "The server is missing required configuration.");
  }
  console.error(err);
  return fail(500, "internal_error", "Something went wrong.");
}
