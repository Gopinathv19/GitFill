import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const jobStatus = pgEnum("job_status", [
  "pending",
  "analyzing_repository",
  "planning_presentation",
  "generating_presentation",
  "rendering_slides",
  "validating_presentation",
  "repairing_presentation",
  "generating_documents",
  "comparing_commits",
  "composing_document",
  "completed",
  "failed",
]);

/** generate/revise produce decks; handbook, compare and reuse produce documents. */
export const jobKind = pgEnum("job_kind", ["generate", "revise", "handbook", "compare", "reuse"]);

export const documentKind = pgEnum("document_kind", ["handbook", "commit_report", "implementation_brief", "explanation"]);

export const artifactType = pgEnum("artifact_type", [
  "pptx",
  "pdf",
  "readme",
  "slide_preview",
  "evidence_report",
  "illustration",
]);

export const claimStatus = pgEnum("claim_status", ["verified", "inferred", "unverified"]);

export const runStatus = pgEnum("run_status", ["running", "completed", "failed"]);

export const eventStatus = pgEnum("event_status", ["started", "succeeded", "failed"]);

export const repoSource = pgEnum("repo_source", ["imported", "created"]);

export const chatRole = pgEnum("chat_role", ["user", "assistant"]);

/**
 * GitHub-authenticated users (or the dev stub user). The user's GitHub OAuth token is kept
 * encrypted (AES-256-GCM) so every repository read happens as that user, with their own
 * rate limit and access to their private repositories.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    githubId: text("github_id").notNull(),
    login: text("login").notNull(),
    name: text("name"),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    /** Encrypted OAuth access token (see lib/auth/github-token.ts); null until GitHub is connected. */
    githubTokenEncrypted: text("github_token_encrypted"),
    /** Scopes GitHub granted, comma-separated, e.g. "read:user,repo". */
    githubTokenScopes: text("github_token_scopes"),
    /** GitHub login of the connected account (may differ from `login` for the stub user). */
    githubTokenLogin: text("github_token_login"),
    githubConnectedAt: timestamp("github_connected_at", { withTimezone: true }),
    createdAt: createdAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_github_id_uq").on(t.githubId)],
);

/** A user's workspace: a set of repositories, a chat with the agent, and the outputs made there. */
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workspaces_owner_idx").on(t.ownerId)],
);

/**
 * Repositories attached to a workspace: imported from GitHub, or created inside the
 * workspace (a planned repo with no GitHub URL until it is published).
 */
export const workspaceRepositories = pgTable(
  "workspace_repositories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    source: repoSource("source").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    owner: text("owner"),
    repositoryUrl: text("repository_url"),
    defaultBranch: text("default_branch"),
    /** Private on GitHub: readable only through the owner's connected GitHub account. */
    isPrivate: boolean("is_private").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("workspace_repositories_ws_idx").on(t.workspaceId)],
);

/** One conversation with the agent inside a workspace; a workspace can hold many. */
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New session"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_sessions_ws_idx").on(t.workspaceId, t.updatedAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: chatRole("role").notNull(),
    content: text("content").notNull(),
    /** Jobs started by this message (shown as live job cards in the chat). */
    jobIds: jsonb("job_ids").notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_ws_idx").on(t.workspaceId, t.createdAt), index("chat_messages_session_idx").on(t.sessionId, t.createdAt)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repositoryId: uuid("repository_id").references(() => workspaceRepositories.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_workspace_idx").on(t.workspaceId)],
);

/** One row per (repository, commit) that was analyzed, so every output can be traced to exact source. */
export const repositorySnapshots = pgTable(
  "repository_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    repositoryUrl: text("repository_url").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    branch: text("branch").notNull(),
    commitSha: text("commit_sha").notNull(),
    /** Ingestion output: file inventory, manifests, detected stack. Repo content itself is not stored. */
    summary: jsonb("summary"),
    createdAt: createdAt(),
  },
  (t) => [index("repository_snapshots_project_idx").on(t.projectId), index("repository_snapshots_sha_idx").on(t.owner, t.name, t.commitSha)],
);

export const generationJobs = pgTable(
  "generation_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: jobKind("kind").notNull().default("generate"),
    repositoryUrl: text("repository_url").notNull(),
    branch: text("branch"),
    commitSha: text("commit_sha"),
    snapshotId: uuid("snapshot_id").references(() => repositorySnapshots.id, { onDelete: "set null" }),
    /** For revisions: the deck being revised. Set on completion for generations. */
    deckId: uuid("deck_id"),
    /** The deck version this job produced. */
    resultVersionId: uuid("result_version_id"),
    /** The document (handbook, commit report, implementation brief) this job produced. */
    documentId: uuid("document_id"),
    userPrompt: text("user_prompt").notNull(),
    /** Audience, slide count, theme and other validated request options. */
    options: jsonb("options").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    errorMessage: text("error_message"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("generation_jobs_status_idx").on(t.status, t.createdAt), index("generation_jobs_project_idx").on(t.projectId)],
);

export const decks = pgTable(
  "decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => repositorySnapshots.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    latestVersion: integer("latest_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("decks_project_idx").on(t.projectId)],
);

/** Immutable versions of a deck. The spec (not the .pptx) is the editable source of truth. */
export const deckVersions = pgTable(
  "deck_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deckId: uuid("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    spec: jsonb("spec").notNull(),
    /** Final validation report: issues found, repairs applied, unresolved issues. */
    validation: jsonb("validation"),
    /** Storage keys of reusable generated assets, e.g. illustrations by slide id. */
    assets: jsonb("assets").notNull().default({}),
    changeSummary: text("change_summary"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("deck_versions_deck_version_uq").on(t.deckId, t.version)],
);

export const evidenceClaims = pgTable(
  "evidence_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => repositorySnapshots.id, { onDelete: "cascade" }),
    /** Short stable id the model uses to cite this claim (e.g. "C12"). */
    ref: text("ref").notNull(),
    claim: text("claim").notNull(),
    claimType: text("claim_type").notNull(),
    filePath: text("file_path"),
    startLine: integer("start_line"),
    endLine: integer("end_line"),
    excerpt: text("excerpt"),
    status: claimStatus("status").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("evidence_claims_snapshot_ref_uq").on(t.snapshotId, t.ref)],
);

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    deckVersionId: uuid("deck_version_id").references(() => deckVersions.id, { onDelete: "cascade" }),
    artifactType: artifactType("artifact_type").notNull(),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    slideIndex: integer("slide_index"),
    createdAt: createdAt(),
  },
  (t) => [index("artifacts_version_idx").on(t.deckVersionId), index("artifacts_job_idx").on(t.jobId)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => generationJobs.id, { onDelete: "cascade" }),
    status: runStatus("status").notNull().default("running"),
    modelIdentifier: text("model_identifier").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (t) => [index("agent_runs_job_idx").on(t.jobId)],
);

/**
 * Every real operation the agent performed: tool calls, model calls and stage changes.
 * The UI activity feed reads only from this table, so nothing shown is fabricated.
 */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    name: text("name").notNull(),
    status: eventStatus("status").notNull(),
    model: text("model"),
    /** Short, secret-free summaries of input and output for display and audit. */
    inputSummary: jsonb("input_summary"),
    outputSummary: jsonb("output_summary"),
    errorSummary: text("error_summary"),
    durationMs: integer("duration_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("agent_events_run_idx").on(t.runId, t.startedAt)],
);

/**
 * Generated documents: handbooks, commit reports, implementation briefs and saved explanations.
 * `spec` is the validated structured output the Markdown was rendered from; `markdown` is what users read.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: documentKind("kind").notNull(),
    title: text("title").notNull(),
    markdown: text("markdown").notNull(),
    spec: jsonb("spec").notNull(),
    /** Request options and computed facts (scope, audience, base/head commits, reuse kinds, ...). */
    metadata: jsonb("metadata").notNull().default({}),
    snapshotId: uuid("snapshot_id").references(() => repositorySnapshots.id, { onDelete: "set null" }),
    /** Second repository for cross-repository documents (the target of an implementation brief). */
    secondarySnapshotId: uuid("secondary_snapshot_id").references(() => repositorySnapshots.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => generationJobs.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("documents_project_idx").on(t.projectId), index("documents_kind_idx").on(t.kind, t.createdAt)],
);

/** Personal API tokens for the VS Code extension. Only a SHA-256 hash is stored. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** First characters of the token, shown so users can tell tokens apart. */
    prefix: text("prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_tokens_hash_uq").on(t.tokenHash), index("api_tokens_user_idx").on(t.userId)],
);

export type JobStatus = (typeof jobStatus.enumValues)[number];
export type JobKind = (typeof jobKind.enumValues)[number];
export type DocumentKind = (typeof documentKind.enumValues)[number];
export type ArtifactType = (typeof artifactType.enumValues)[number];
export type ClaimStatus = (typeof claimStatus.enumValues)[number];
