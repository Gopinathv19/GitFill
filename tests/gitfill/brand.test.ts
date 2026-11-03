import { describe, expect, it } from "vitest";
import { formatQuestions, questionRounds } from "@/lib/client/questions";
import { brandFiles, brandFromFiles, toHex } from "@/lib/gitfill/brand";

describe("repository brand", () => {
  it("converts the colour formats stylesheets use", () => {
    expect(toHex("#0F766E")).toBe("#0f766e");
    expect(toHex("#abc")).toBe("#aabbcc");
    expect(toHex("rgb(13, 148, 136)")).toBe("#0d9488");
    expect(toHex("hsl(0 100% 50%)")).toBe("#ff0000");
    expect(toHex("120 100% 25%")).toBe("#008000");
    expect(toHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(toHex("oklch(0.6 0.2 260)")).toMatch(/^#[0-9a-f]{6}$/);
    expect(toHex("var(--x)")).toBeUndefined();
  });

  it("reads shadcn-style tokens, skips a grey primary and the dark block, and finds next/font fonts", () => {
    const css = `:root { --background: 0 0% 100%; --foreground: 222 47% 11%; --primary: 222 47% 11%; --ring: 262 83% 58%; }
.dark { --background: 222 47% 4%; --ring: 0 0% 50%; }`;
    const layout = `import { Inter, Space_Grotesk } from "next/font/google";`;
    const rb = brandFromFiles([{ path: "app/globals.css", content: css }, { path: "app/layout.tsx", content: layout }]);
    expect(rb.brand).toMatchObject({ background: "#ffffff", text: toHex("222 47% 11%"), accent: toHex("262 83% 58%"), mode: "light", bodyFont: "Inter", headingFont: "Space Grotesk" });
    expect(rb.sources.accent).toBe("app/globals.css (--ring)");
    expect(rb.missing).toEqual([]);
  });

  it("lets the team's brand.json win and reports what is missing", () => {
    const rb = brandFromFiles([
      { path: ".gitfill/assets/brand.json", content: JSON.stringify({ name: "Acme", colors: { primary: "#e11d48" } }) },
      { path: "src/index.css", content: ":root { --primary: #2563eb; }" },
    ]);
    expect(rb.brand).toMatchObject({ name: "Acme", accent: "#e11d48" });
    expect(rb.missing).toEqual(["background colour", "fonts"]);
  });

  it("reads Tailwind config colours", () => {
    const rb = brandFromFiles([{ path: "tailwind.config.ts", content: `colors: { brand: { DEFAULT: "#7c3aed", 50: "#f5f3ff" } }` }]);
    expect(rb.brand.accent).toBe("#7c3aed");
  });

  it("picks the brand files shallowest first and ignores build output", () => {
    const files = brandFiles([
      { path: "node_modules/x/index.css", sizeBytes: 10 },
      { path: "packages/web/src/styles/globals.css", sizeBytes: 10 },
      { path: "app/globals.css", sizeBytes: 10 },
      { path: ".gitfill/assets/brand.json", sizeBytes: 10 },
      { path: "tailwind.config.js", sizeBytes: 10 },
    ]);
    expect(files).toEqual([".gitfill/assets/brand.json", "app/globals.css", "packages/web/src/styles/globals.css", "tailwind.config.js"]);
  });
});

describe("intent rounds", () => {
  const ask = formatQuestions({ intro: "", questions: [{ question: "Who reads it?", options: [{ label: "Judges" }, { label: "Devs" }], multiple: false, kind: "choice" }] });
  it("counts question rounds since work was last started", () => {
    expect(
      questionRounds([
        { role: "assistant", content: ask },
        { role: "assistant", content: "Started.", jobIds: ["j1"] },
        { role: "user", content: "Now a deck" },
        { role: "assistant", content: ask },
        { role: "user", content: "1. Judges" },
        { role: "assistant", content: ask },
        { role: "user", content: "2. ..." },
      ]),
    ).toBe(2);
    expect(questionRounds([{ role: "user", content: "hi" }])).toBe(0);
  });
});
