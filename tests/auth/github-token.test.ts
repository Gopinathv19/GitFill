import { beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/config/env";
import { decryptSecret, encryptSecret } from "@/lib/auth/github-token";

describe("GitHub token encryption", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = "test-encryption-key-that-is-long-enough-32+";
    resetEnvCache();
  });

  it("round-trips and never stores the plaintext", () => {
    const token = "gho_" + "a".repeat(36);
    const stored = encryptSecret(token);
    expect(stored.startsWith("v1.")).toBe(true);
    expect(stored).not.toContain(token);
    expect(decryptSecret(stored)).toBe(token);
    expect(encryptSecret(token)).not.toBe(stored); // random IV
  });

  it("rejects tampered ciphertext and another key", () => {
    const stored = encryptSecret("secret");
    const [v, iv, tag, data] = stored.split(".");
    const flipped = `${v}.${iv}.${tag}.${data!.slice(0, -2)}AA`;
    expect(() => decryptSecret(flipped)).toThrow();
    process.env.TOKEN_ENCRYPTION_KEY = "a-completely-different-encryption-key-32+chars";
    resetEnvCache();
    expect(() => decryptSecret(stored)).toThrow();
  });
});
