import * as vscode from "vscode";

/** Typed client for the GitFill extension API (/api/ext/*). Authenticates with a personal API token. */
export interface WorkspacePayload {
  name: string;
  files: Array<{ path: string; content: string }>;
  allPaths?: string[];
  branch?: string;
  head?: string;
}

export interface Reference {
  path: string;
  startLine: number;
  endLine: number;
  why: string;
}

export interface ExplainResponse {
  title: string;
  markdown: string;
  answer?: string;
  mermaid: string | null;
  references: Reference[];
  unverified: string[];
  followUps?: string[];
  filesAnalyzed: number;
}

export interface DocCommentsResponse {
  comments: Array<{ insertBeforeLine: number; symbol?: string; kind: "doc" | "inline"; text: string; rationale?: string }>;
  skipped: string[];
  language: string;
  preview: string;
}

export interface DriftResponse {
  findings: Array<{ original: string; issue: string; proposed: string; confidence: "high" | "medium" | "low" }>;
  missing: string[];
}

export class GitFillClient {
  constructor(
    private readonly serverUrl: string,
    private readonly token: string,
  ) {}

  static async fromContext(context: vscode.ExtensionContext): Promise<GitFillClient | null> {
    const token = await context.secrets.get("gitfill.token");
    const serverUrl = vscode.workspace.getConfiguration("gitfill").get<string>("serverUrl") ?? "http://localhost:3000";
    return token ? new GitFillClient(serverUrl, token) : null;
  }

  me() {
    return this.post<{ user: { login: string }; modelConfigured: boolean }>("/api/ext/me", undefined, "GET");
  }

  explain(body: { question: string; diagram?: string; workspace: WorkspacePayload; focus?: { path: string; startLine?: number; endLine?: number; selection?: string } }) {
    return this.post<ExplainResponse>("/api/ext/explain", body);
  }

  document(body: { path: string; content: string; selection?: { startLine: number; endLine: number } }) {
    return this.post<DocCommentsResponse>("/api/ext/document", body);
  }

  changes(body: { workspace: WorkspacePayload; diff: string; scope: string; question?: string }) {
    return this.post<ExplainResponse>("/api/ext/changes", body);
  }

  drift(body: { documentName: string; document: string; changes: string }) {
    return this.post<DriftResponse>("/api/ext/drift", body);
  }

  private async post<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300_000);
    let res: Response;
    try {
      res = await fetch(`${this.serverUrl.replace(/\/+$/, "")}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(err instanceof Error && err.name === "AbortError" ? "GitFill request timed out." : `Could not reach the GitFill server at ${this.serverUrl}.`);
    } finally {
      clearTimeout(timer);
    }
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string } };
    if (!res.ok || json.error) {
      if (res.status === 401) throw new Error("GitFill rejected the API token. Run “GitFill: Sign in” again.");
      throw new Error(json.error?.message ?? `GitFill request failed (${res.status}).`);
    }
    return json.data as T;
  }
}
