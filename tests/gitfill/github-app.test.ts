import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { appClientFor, AppNotInstalledError, appJwt } from "@/lib/connectors/github/app";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const cfg = { id: "12345", privateKey, slug: "gitfill-test" };

describe("GitHub App", () => {
  it("signs a short-lived RS256 JWT issued by the app", () => {
    const jwt = appJwt(cfg, 1_000_000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(p!, "base64url").toString())).toEqual({ iat: 999_940, exp: 1_000_540, iss: "12345" });
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s!, "base64url"))).toBe(true);
  });

  it("mints a repository-scoped installation token once and reuses it", async () => {
    const calls: Array<{ method: string; url: string; auth: string; body?: unknown }> = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      calls.push({ method: init?.method ?? "GET", url, auth: headers.Authorization!, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/repos/acme/app/installation")) return new Response(JSON.stringify({ id: 77 }), { status: 200 });
      if (url.endsWith("/app/installations/77/access_tokens")) return new Response(JSON.stringify({ token: "ghs_inst", expires_at: new Date(Date.now() + 3600_000).toISOString() }), { status: 201 });
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
    const client = await appClientFor("acme", "app", cfg, fake);
    expect(client.gitFetchToken()).toBe("ghs_inst");
    expect(calls[0]!.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(calls[1]!.body).toEqual({ repositories: ["app"], permissions: { contents: "write", pull_requests: "write", metadata: "read" } });
    await appClientFor("Acme", "App", cfg, fake);
    expect(calls).toHaveLength(2);
  });

  it("says where to install the app when it is not installed", async () => {
    const fake = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    const err = await appClientFor("acme", "other", cfg, fake).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppNotInstalledError);
    expect((err as Error).message).toContain("https://github.com/apps/gitfill-test/installations/new");
  });
});
