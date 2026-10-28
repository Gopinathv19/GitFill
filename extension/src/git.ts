import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Thin wrapper over the git CLI for the open workspace folder. Read-only commands only. */
export class Git {
  constructor(private readonly cwd: string) {}

  private async git(args: string[], maxBuffer = 20 * 1024 * 1024): Promise<string> {
    const { stdout } = await run("git", args, { cwd: this.cwd, maxBuffer });
    return stdout;
  }

  async isRepo(): Promise<boolean> {
    try {
      return (await this.git(["rev-parse", "--is-inside-work-tree"])).trim() === "true";
    } catch {
      return false;
    }
  }

  async head(): Promise<string | undefined> {
    return (await this.git(["rev-parse", "HEAD"]).catch(() => "")).trim() || undefined;
  }

  async branch(): Promise<string | undefined> {
    return (await this.git(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim() || undefined;
  }

  /** Working tree vs HEAD, including untracked files as additions. */
  async workingTreeDiff(): Promise<string> {
    const tracked = await this.git(["diff", "HEAD", "--no-color", "--no-ext-diff"]);
    const untracked = (await this.git(["ls-files", "--others", "--exclude-standard"])).split("\n").filter(Boolean);
    const parts = [tracked];
    for (const path of untracked.slice(0, 40)) {
      const diff = await this.git(["diff", "--no-color", "--no-index", "--", "/dev/null", path]).catch((e: { stdout?: string }) => e.stdout ?? "");
      if (diff) parts.push(diff);
    }
    return parts.filter(Boolean).join("\n");
  }

  stagedDiff(): Promise<string> {
    return this.git(["diff", "--cached", "--no-color", "--no-ext-diff"]);
  }

  rangeDiff(base: string, head: string): Promise<string> {
    return this.git(["diff", "--no-color", "--no-ext-diff", `${base}..${head}`]);
  }

  async changedPaths(diff: string): Promise<string[]> {
    const out = new Set<string>();
    for (const m of diff.matchAll(/^\+\+\+ b\/(.+)$/gm)) out.add(m[1]!);
    return [...out];
  }

  async log(limit = 40): Promise<Array<{ sha: string; subject: string; author: string; date: string }>> {
    const out = await this.git(["log", `-n${limit}`, "--pretty=format:%H%x1f%s%x1f%an%x1f%ad", "--date=short"]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha = "", subject = "", author = "", date = ""] = line.split("\x1f");
        return { sha, subject, author, date };
      });
  }

  async branches(): Promise<string[]> {
    const out = await this.git(["branch", "--all", "--format=%(refname:short)"]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  }
}
