import { InvalidPatternError, RepoStoreError, validateOpen, type CodeSource, type FileRead, type GrepHit, type GrepOptions, type ListOptions, type OpenRequest, type OpenResult, type RepoStore } from "./types";

/**
 * Client for the repo service (lib/repo-store/service.ts). Same interface as LocalGitStore, so the
 * agent cannot tell whether repositories live in-process or on another machine. When the service is
 * an https URL (Cloud Run), requests also carry a Google ID token from the metadata server, which
 * Cloud Run's IAM checks before the request reaches the service.
 */
export class RemoteRepoStore implements RepoStore {
  readonly kind = "remote";

  private idToken: { value: string; expires: number } | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  private async iamHeader(): Promise<Record<string, string>> {
    if (!this.baseUrl.startsWith("https://")) return {};
    if (!this.idToken || this.idToken.expires < Date.now() + 60_000) {
      const audience = new URL(this.baseUrl).origin;
      const res = await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5_000) }).catch(() => null);
      // Outside Google Cloud there is no metadata server: rely on the service token alone.
      if (!res?.ok) return {};
      this.idToken = { value: await res.text(), expires: Date.now() + 50 * 60_000 };
    }
    return { Authorization: `Bearer ${this.idToken.value}` };
  }

  async open(req: OpenRequest): Promise<OpenResult> {
    validateOpen(req);
    const out = await this.call<{ origin: OpenResult["origin"]; ms: number; label: string; version: string }>("/v1/open", req, 200_000);
    return { origin: out.origin, ms: out.ms, source: new RemoteCodeSource(this, req, out.label, out.version) };
  }

  /** @internal */
  async call<T>(endpoint: string, body: unknown, timeoutMs = 30_000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/+$/, "")}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.token ? { "X-Repo-Service-Token": this.token } : {}), ...(await this.iamHeader()) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new RepoStoreError(`Repository service unreachable: ${err instanceof Error ? err.message : err}`, "unavailable");
    }
    const data = (await res.json().catch(() => null)) as (T & { code?: string; message?: string }) | null;
    if (res.ok) return data as T;
    if (data?.code === "invalid_pattern") throw new InvalidPatternError(data.message ?? "invalid pattern");
    const code = (["too_large", "fetch_failed", "invalid_request", "timeout"] as const).find((c) => c === data?.code) ?? "unavailable";
    throw new RepoStoreError(data?.message ?? `Repository service error (${res.status})`, code);
  }
}

class RemoteCodeSource implements CodeSource {
  constructor(
    private readonly store: RemoteRepoStore,
    private readonly ref: OpenRequest,
    readonly label: string,
    readonly version: string,
  ) {}

  listFiles(opts: ListOptions = {}) {
    return this.store.call<{ paths: string[]; total: number }>("/v1/list", { source: this.ref, ...opts });
  }

  grep(pattern: string, opts: GrepOptions = {}) {
    return this.store.call<{ hits: GrepHit[]; truncated: boolean }>("/v1/grep", { source: this.ref, pattern, ...opts });
  }

  read(path: string, range: { start?: number; end?: number } = {}) {
    return this.store.call<FileRead | null>("/v1/read", { source: this.ref, path, ...range });
  }
}
