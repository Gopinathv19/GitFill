import { execFile } from "node:child_process";

/**
 * Runs git with settings that keep untrusted repository data inert: no hooks, no fsmonitor, no
 * user/system config (credential helpers, aliases), objects validated on receipt, no prompts, only
 * the allowed transport protocols, a hard timeout and an output cap. Arguments are passed as an
 * array (never through a shell).
 */
export interface GitOptions {
  cwd?: string;
  timeoutMs?: number;
  maxBuffer?: number;
  /** Extra config passed through the environment, so values (e.g. auth headers) never appear in argv. */
  config?: Record<string, string>;
  /** Comma-separated transports, default "https". Tests use "file". */
  allowProtocols?: string;
}

export interface GitResult {
  stdout: string;
  code: number;
}

const HARDENING = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "transfer.fsckObjects=true", "-c", "fetch.fsckObjects=true", "-c", "credential.helper=", "-c", "protocol.version=2", "-c", "core.quotePath=false"];

export class GitError extends Error {
  override name = "GitError";
  constructor(
    message: string,
    readonly code: number,
    readonly stderr: string,
    readonly timedOut = false,
  ) {
    super(message);
  }
}

/** Resolves for exit codes in `okCodes` (default [0]); rejects with GitError otherwise. */
export function git(args: string[], opts: GitOptions & { okCodes?: number[] } = {}): Promise<GitResult> {
  const config = Object.entries(opts.config ?? {});
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    LANG: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ALLOW_PROTOCOL: opts.allowProtocols ?? "https",
    GIT_CONFIG_COUNT: String(config.length),
    ...Object.fromEntries(config.flatMap(([k, v], i) => [[`GIT_CONFIG_KEY_${i}`, k], [`GIT_CONFIG_VALUE_${i}`, v]])),
  };
  const okCodes = opts.okCodes ?? [0];
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...HARDENING, ...args],
      { cwd: opts.cwd, env: env as NodeJS.ProcessEnv, timeout: opts.timeoutMs ?? 30_000, maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024, encoding: "utf8", killSignal: "SIGKILL" },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : -1) : 0;
        if (!err || okCodes.includes(code)) return resolve({ stdout, code });
        const timedOut = (err as { killed?: boolean }).killed === true;
        reject(new GitError(timedOut ? `git ${args[0]} timed out` : `git ${args[0]} failed: ${stderr.trim().split("\n").at(-1) ?? err.message}`, code, stderr, timedOut));
      },
    );
  });
}

/** Authorization header for fetching from GitHub with a user or app token. */
export function githubAuthConfig(token?: string): Record<string, string> {
  return token ? { "http.extraHeader": `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` } : {};
}
