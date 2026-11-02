import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("githubAppStatus", () => {
  const load = async (vars: Record<string, string>) => {
    vi.resetModules();
    for (const k of ["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_PRIVATE_KEY_PATH", "GITHUB_APP_SLUG"]) vi.stubEnv(k, vars[k] ?? "");
    return (await import("@/lib/connectors/github/app")).githubAppStatus();
  };
  afterEach(() => vi.unstubAllEnvs());

  it("says pull requests use the user's token when no app is set up", async () => {
    expect(await load({})).toEqual({ state: "not_configured" });
  });

  it("reads the key from a .pem file and names the bot", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const dir = mkdtempSync(path.join(tmpdir(), "gf-app-"));
    const pem = path.join(dir, "app.pem");
    writeFileSync(pem, privateKey.export({ type: "pkcs1", format: "pem" }));
    expect(await load({ GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY_PATH: pem, GITHUB_APP_SLUG: "gitfill" })).toEqual({ state: "configured", slug: "gitfill", botName: "gitfill[bot]", installUrl: "https://github.com/apps/gitfill/installations/new" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a key that cannot sign", async () => {
    const status = await load({ GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: `-----BEGIN RSA PRIVATE KEY-----\\n${"A".repeat(120)}\\n-----END RSA PRIVATE KEY-----` });
    expect(status.state).toBe("invalid_key");
  });
});
