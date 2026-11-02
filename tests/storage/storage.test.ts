import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactMissingError, LocalStorage } from "@/lib/storage";

describe("local artifact storage", () => {
  let root: string;
  let storage: LocalStorage;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "gitfill-storage-"));
    storage = new LocalStorage(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores and reads bytes back", async () => {
    const { sizeBytes } = await storage.put("decks/abc/v1/slide-01.png", Buffer.from("png"));
    expect(sizeBytes).toBe(3);
    expect((await storage.get("decks/abc/v1/slide-01.png")).toString()).toBe("png");
    expect(await storage.exists("decks/abc/v1/slide-01.png")).toBe(true);
  });

  it("reports a key whose file is gone as missing, not as a crash", async () => {
    await expect(storage.get("decks/gone/v1/slide-01.png")).rejects.toBeInstanceOf(ArtifactMissingError);
    expect(await storage.exists("decks/gone/v1/slide-01.png")).toBe(false);
  });

  it("refuses keys that escape the storage root", () => {
    expect(() => storage.localPath("../secrets.txt")).toThrow();
    expect(() => storage.localPath("/etc/passwd")).toThrow();
  });
});
