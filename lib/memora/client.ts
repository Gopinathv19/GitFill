import { env, requireEnv } from "@/lib/config/env";

/**
 * Minimal client for the Memora API (/api/v1). Memora is the RAG pipeline GitFill
 * delegates retrieval to: sources → extraction → chunks → embeddings → hybrid query with
 * MMR and reranking. GitFill only registers Markdown bundles and asks questions; it never
 * reads Memora's database directly.
 */
export class MemoraError extends Error {
  override name = "MemoraError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface MemoraSubject {
  id: string;
  external_id: string;
  application_id: string;
  source_count?: number;
}

export interface MemoraSource {
  id: string;
  subject_id: string;
  filename: string | null;
  status: "pending" | "processing" | "completed" | "failed";
}

export interface MemoraChunk {
  chunk_id: string;
  source_id: string;
  subject_id: string;
  content: string;
  content_type: string;
  section_path: string[];
  token_count: number;
  similarity: number;
  rerank_score: number | null;
}

export interface MemoraQueryResponse {
  query: string;
  answer: string;
  strategy_name: string;
  chunks: MemoraChunk[];
  retrieval: { final_chunks: number; reranker_used: boolean; timings_ms?: Record<string, number> };
  usage: { prompt_tokens: number; completion_tokens: number; latency_ms: number };
}

export interface MemoraEmbeddingStatus {
  source_id: string;
  total_chunks: number;
  embedded: number;
  pending: number;
  processing: number;
  failed: number;
  stale: number;
  coverage_percent: number;
}

const TIMEOUT_MS = 60_000;

export class MemoraClient {
  private readonly base: string;
  private readonly token: string;

  constructor(baseUrl = requireEnv("MEMORA_BASE_URL"), token = requireEnv("MEMORA_API_TOKEN"), private readonly fetchImpl: typeof fetch = fetch) {
    this.base = `${baseUrl.replace(/\/+$/, "")}/api/v1`;
    this.token = token;
  }

  static fromEnv(): MemoraClient | null {
    const e = env();
    return e.MEMORA_BASE_URL && e.MEMORA_API_TOKEN ? new MemoraClient(e.MEMORA_BASE_URL, e.MEMORA_API_TOKEN) : null;
  }

  whoami() {
    return this.json<{ application_id: string; application_name: string; tenant_id: string }>("GET", "/whoami");
  }

  async listSubjects(): Promise<MemoraSubject[]> {
    return this.json<MemoraSubject[]>("GET", "/subjects?roots_only=true");
  }

  createSubject(applicationId: string, externalId: string) {
    return this.json<MemoraSubject>("POST", `/applications/${encodeURIComponent(applicationId)}/subjects`, { external_id: externalId });
  }

  deleteSubject(subjectId: string) {
    return this.json<void>("DELETE", `/subjects/${encodeURIComponent(subjectId)}`);
  }

  listSources(subjectId: string) {
    return this.json<MemoraSource[]>("GET", `/subjects/${encodeURIComponent(subjectId)}/sources`);
  }

  /** Uploads a Markdown document and starts extraction (text route: local, no model calls). */
  async uploadMarkdown(subjectId: string, filename: string, markdown: string): Promise<MemoraSource> {
    const form = new FormData();
    form.set("file", new Blob([markdown], { type: "text/markdown" }), filename);
    form.set("extract", "true");
    return this.json<MemoraSource>("POST", `/subjects/${encodeURIComponent(subjectId)}/sources/upload`, form);
  }

  embeddingStatus(sourceId: string) {
    return this.json<MemoraEmbeddingStatus>("GET", `/embedding/sources/${encodeURIComponent(sourceId)}/status`);
  }

  embedSubject(subjectId: string) {
    return this.json<{ enqueued: number }>("POST", `/embedding/subjects/${encodeURIComponent(subjectId)}/embed`, {});
  }

  query(query: string, subjectId: string, mode: "hybrid" | "dense" = "hybrid") {
    return this.json<MemoraQueryResponse>("POST", "/query", { query, subject_id: subjectId, retrieval_mode: mode });
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}`, Accept: "application/json" };
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { method, headers, body: payload, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw new MemoraError(err instanceof Error && err.name === "TimeoutError" ? "Memora request timed out." : "Could not reach Memora.", 502);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        detail = String((JSON.parse(text) as { detail?: unknown }).detail ?? detail);
      } catch {
        // keep raw text
      }
      throw new MemoraError(`Memora ${res.status}: ${detail}`, res.status);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
