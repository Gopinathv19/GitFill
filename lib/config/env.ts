import { z } from "zod";

/**
 * Server-side configuration. Parsed lazily so that modules which never touch
 * a given setting (e.g. unit tests for URL parsing) do not require it.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().optional(),
  MODEL_API_KEY: z.string().min(1).optional(),
  MODEL_API_BASE_URL: z.string().url().default("https://api.meta.ai/v1"),
  /** When "true", loop-heavy calls use the cheaper contributor tier (Meta may train on inputs). Dev only. */
  MUSE_USE_CONTRIBUTOR: z.enum(["true", "false"]).default("false"),
  GITHUB_TOKEN: z.string().min(1).optional(),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  ARTIFACT_STORAGE_PATH: z.string().default("./storage"),
  SOFFICE_PATH: z.string().default("soffice"),
  /** "stub" enables one-click demo sign-in for local testing; "github" requires a GitHub OAuth app. */
  AUTH_MODE: z.enum(["stub", "github"]).optional(),
  /** HMAC key for session cookies. Required in production. */
  AUTH_SECRET: z.string().min(32).optional(),
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  /** OAuth scopes requested at sign-in. "repo" is what grants read access to the user's private repositories. */
  GITHUB_OAUTH_SCOPES: z.string().default("read:user user:email repo"),
  /** Key that encrypts users' GitHub tokens at rest (32+ chars, e.g. `openssl rand -hex 32`). Required in production. */
  TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),
  /** "true" runs queued jobs inside the web process (no separate worker). Automatic for pglite: databases. */
  INLINE_WORKER: z.enum(["true", "false"]).optional(),
  /** Memora (https://github.com/…/Memora) retrieval service: the RAG pipeline behind code questions. Optional. */
  MEMORA_BASE_URL: z.string().url().optional(),
  /** Memora application credential ("memora_…"). Scopes every index to that application. */
  MEMORA_API_TOKEN: z.string().min(1).optional(),
  /** How long jobs wait for a fresh Memora index before continuing without it. */
  MEMORA_INDEX_TIMEOUT_MS: z.coerce.number().int().min(0).default(150_000),
  /** "true" prints a per-step timing breakdown of chat turns and code questions to the server log. */
  GITFILL_TIMINGS: z.enum(["true", "false"]).default("false"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    // `KEY=` lines in .env arrive as empty strings; treat them as unset.
    const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
    const parsed = envSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new ConfigError(`Invalid configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Returns a required setting or throws a ConfigError naming the missing variable. */
export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === "") {
    throw new ConfigError(`Missing required environment variable ${String(key)}. See .env.example.`);
  }
  return value as NonNullable<Env[K]>;
}

/** Stub sign-in is on by default in development and only on in production when explicitly requested. */
export function authMode(): "stub" | "github" {
  const e = env();
  return e.AUTH_MODE ?? (e.NODE_ENV === "production" ? "github" : "stub");
}

/** Jobs run in the web process when asked for, or when the embedded PGlite database makes a separate worker impossible. */
export function inlineWorkerEnabled(): boolean {
  const e = env();
  if (e.INLINE_WORKER) return e.INLINE_WORKER === "true";
  return e.DATABASE_URL?.startsWith("pglite:") ?? false;
}

/** Memora is used for retrieval whenever both its URL and a token are configured. */
export function memoraConfigured(): boolean {
  const e = env();
  return Boolean(e.MEMORA_BASE_URL && e.MEMORA_API_TOKEN);
}

/** Test helper: forget the parsed environment so changes to process.env take effect. */
export function resetEnvCache(): void {
  cached = undefined;
}
