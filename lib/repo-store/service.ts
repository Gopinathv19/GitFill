import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { InvalidPatternError, RepoStoreError, type RepoStore } from "./types";

/**
 * The repo service: repository storage as its own process. In the cloud it runs as a separate
 * service (scripts/repo-service.ts) with its own disk and the shared archive cache, so git fetches,
 * greps and file reads never load the web app. It holds no user data beyond the repositories and
 * receives GitHub tokens only per request (never stored). Repository code is never executed.
 * Callers authenticate with the `X-Repo-Service-Token` header (the Authorization header is left
 * for Cloud Run's own IAM check when the service is deployed with --no-allow-unauthenticated).
 *
 *   POST /v1/open  { owner, repo, sha, token?, sizeKb? }           → { origin, ms, label, version }
 *   POST /v1/list  { source, dir?, glob?, limit? }                 → { paths, total }
 *   POST /v1/grep  { source, pattern, path?, glob?, ignoreCase?, fixed?, maxResults? } → { hits, truncated }
 *   POST /v1/read  { source, path, start?, end? }                  → FileRead | null
 *   GET  /healthz
 */
const sourceSchema = z.object({ owner: z.string().max(100), repo: z.string().max(100), sha: z.string().length(40), token: z.string().max(400).optional(), sizeKb: z.number().int().nonnegative().optional() });
const listSchema = z.object({ source: sourceSchema, dir: z.string().max(400).optional(), glob: z.string().max(200).optional(), limit: z.number().int().min(1).max(5000).optional() });
const grepSchema = z.object({ source: sourceSchema, pattern: z.string().min(1).max(300), path: z.string().max(400).optional(), glob: z.string().max(200).optional(), ignoreCase: z.boolean().optional(), fixed: z.boolean().optional(), maxResults: z.number().int().min(1).max(500).optional() });
const readSchema = z.object({ source: sourceSchema, path: z.string().max(400), start: z.number().int().min(1).optional(), end: z.number().int().min(1).optional() });

const MAX_BODY = 1024 * 1024;

export function createRepoService(store: RepoStore, opts: { token?: string } = {}): Server {
  const expected = opts.token ? Buffer.from(opts.token) : null;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === "GET" && req.url === "/healthz") return send(res, 200, { ok: true, store: store.kind });
    if (expected) {
      const header = req.headers["x-repo-service-token"];
      const got = Buffer.from(typeof header === "string" ? header : "");
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) return send(res, 401, { code: "unauthorized", message: "Missing or invalid service token." });
    }
    if (req.method !== "POST") return send(res, 405, { code: "method_not_allowed", message: "POST only." });
    const body = await readJson(req);
    switch (req.url) {
      case "/v1/open": {
        const input = sourceSchema.parse(body);
        const { origin, ms, source } = await store.open(input);
        return send(res, 200, { origin, ms, label: source.label, version: source.version });
      }
      case "/v1/list": {
        const { source, ...rest } = listSchema.parse(body);
        return send(res, 200, await (await store.open(source)).source.listFiles(rest));
      }
      case "/v1/grep": {
        const { source, pattern, ...rest } = grepSchema.parse(body);
        return send(res, 200, await (await store.open(source)).source.grep(pattern, rest));
      }
      case "/v1/read": {
        const { source, path, start, end } = readSchema.parse(body);
        return send(res, 200, await (await store.open(source)).source.read(path, { start, end }));
      }
      default:
        return send(res, 404, { code: "not_found", message: "Unknown endpoint." });
    }
  }

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof z.ZodError) return send(res, 400, { code: "invalid_request", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      if (err instanceof InvalidPatternError) return send(res, 400, { code: "invalid_pattern", message: err.message });
      if (err instanceof RepoStoreError) return send(res, 422, { code: err.code, message: err.message });
      console.error("repo service error:", err);
      send(res, 500, { code: "internal", message: "Repository service error." });
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new RepoStoreError("Request body too large.", "invalid_request");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
