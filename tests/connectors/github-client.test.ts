import { describe, expect, it, vi } from "vitest";
import { GitHubClient } from "@/lib/connectors/github/client";

const sha = "0123456789abcdef0123456789abcdef01234567";

describe("GitHubClient with a user token", () => {
  it("sends the token to both api.github.com and raw.githubusercontent.com and reports private repos", async () => {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
      if (url.includes("/repos/acme/secret") && !url.includes("/commits")) {
        return new Response(JSON.stringify({ full_name: "acme/secret", private: true, default_branch: "main", stargazers_count: 0, topics: [], license: null, html_url: "https://github.com/acme/secret" }), { status: 200 });
      }
      return new Response("const x = 1;", { status: 200 });
    }) as unknown as typeof fetch;
    const client = new GitHubClient("gho_user_token", fetchImpl);
    const repo = await client.getRepo("acme", "secret");
    expect(repo.private).toBe(true);
    await client.getFileText("acme", "secret", sha, "src/x.ts", 10_000);
    expect(calls.map((c) => c.auth)).toEqual(["Bearer gho_user_token", "Bearer gho_user_token"]);
    expect(calls[1]!.url.startsWith("https://raw.githubusercontent.com/")).toBe(true);
  });

  it("clears a revoked token via onUnauthorized", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const client = new GitHubClient("gho_revoked", fetchImpl);
    const onUnauthorized = vi.fn();
    client.onUnauthorized = onUnauthorized;
    await expect(client.getRepo("acme", "x")).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
