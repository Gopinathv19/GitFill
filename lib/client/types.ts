export interface RepoView {
  id: string;
  source: "imported" | "created";
  name: string;
  owner: string | null;
  fullName: string;
  description: string | null;
  repositoryUrl: string | null;
  defaultBranch: string | null;
  isPrivate: boolean;
  analyzable: boolean;
  createdAt: string;
}

export interface GitHubConnection {
  connected: boolean;
  login: string | null;
  scopes: string[];
  privateAccess: boolean;
  connectedAt: string | null;
}

export interface UserRepoView {
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  pushedAt: string | null;
  language: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  repositories: RepoView[];
  presentationCount: number;
  documentCount: number;
}

export type DocumentKind = "handbook" | "commit_report" | "implementation_brief" | "explanation";

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  title: string;
  createdAt: string;
  workspaceId: string;
  workspaceName: string;
  repository: string | null;
  commitSha: string | null;
  claims: { total?: number; verified?: number; inferred?: number; unverified?: number } | null;
}

export interface DocumentView extends Omit<DocumentSummary, "claims"> {
  claimCounts: DocumentSummary["claims"];
  repositoryId: string | null;
  markdown: string;
  spec: unknown;
  metadata: Record<string, unknown>;
  job: { id: string; status: string } | null;
  snapshots: Array<{ id: string; repositoryUrl: string; owner: string; name: string; branch: string; commitSha: string; role: "primary" | "secondary" }>;
  claims: Array<{ ref: string; claim: string; type: string; status: "verified" | "inferred" | "unverified"; filePath: string | null; startLine: number | null; endLine: number | null; snapshotId: string }>;
}

export interface AskResult {
  title: string;
  markdown: string;
  mermaid: string | null;
  references: Array<{ path: string; startLine: number; endLine: number; why: string }>;
  unverified: string[];
  followUps: string[];
  repository: string;
  commitSha: string;
  branch: string;
  documentId: string | null;
}

export interface CommitLite {
  sha: string;
  message: string;
  authoredAt: string | null;
  author?: string | null;
}

export interface ApiTokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface WorkspaceDetail {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  repositories: RepoView[];
  presentations: Array<{ id: string; title: string; latestVersion: number; updatedAt: string; repositoryId: string | null; previewArtifactId: string | null }>;
  documents: Array<{ id: string; kind: DocumentKind; title: string; createdAt: string; repositoryId: string | null; repository: string | null }>;
  jobs: Array<{ id: string; kind: string; status: string; prompt: string; deckId: string | null; documentId: string | null; createdAt: string }>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  jobIds: string[];
  createdAt: string;
}

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}
