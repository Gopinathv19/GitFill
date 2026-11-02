import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { readmeSystemPrompt } from "@/lib/ai/prompts";
import { readmeSegments } from "@/components/shared/markdown";
import { GitHubClient } from "@/lib/connectors/github/client";
import { dropMissingImages, findUnknownPaths } from "@/lib/documents/readme";
import { planFiles } from "@/lib/gitfill/deliver";
import { pageBlocks } from "@/lib/presentation/spec";
import { closeBrowser, checkSvgText } from "@/lib/render/browser";
import { documentFiles } from "@/lib/readme/files";
import { assetFileName } from "@/lib/readme/plan";
import { README_TEMPLATE_IDS, README_TEMPLATES, SECTION_BY_ID, sectionBriefs } from "@/lib/readme/templates";
import { badgeMarkdown, readmeTheme, renderBanner, renderDiagramImage, type Banner } from "@/lib/readme/visuals";
import { sampleDeck } from "@/tests/fixtures/sample-deck";

const banner: Banner = {
  kicker: "AI customer support",
  title: "Answers only from what you train it on.",
  accent: "what you train it on",
  tagline: "Cited answers · honest I don't know · live human handoff",
  panel: { type: "chat", title: "Acme Help", messages: [{ from: "user", text: "Can I get a refund?" }, { from: "app", text: "Yes, within 30 days.", chip: "refund-policy.docx" }] },
};

describe("README templates", () => {
  it("only use sections from the catalogue", () => {
    for (const id of README_TEMPLATE_IDS) for (const s of README_TEMPLATES[id].sections) expect(SECTION_BY_ID.has(s), `${id}: ${s}`).toBe(true);
  });

  it("brief each section in the user's order, with renamed titles, notes and custom sections", () => {
    const text = sectionBriefs([{ id: "architecture" }, { id: "features", title: "What it does", note: "Lead with live chat." }, { id: "custom", title: "Team", note: "Four people from Chennai." }], { emoji: true });
    expect(text.split("\n")).toEqual([
      expect.stringMatching(/^1\. "## 🏗️ Architecture" — The generated architecture image/),
      expect.stringMatching(/^2\. "## 🧩 What it does" — .*The team asks: Lead with live chat\.$/),
      '3. "## Team" — The team asks: Four people from Chennai.',
    ]);
  });

  it("turn style switches into writing rules", () => {
    const showcase = readmeSystemPrompt(README_TEMPLATES.showcase.style, "Bold.");
    expect(showcase).toContain('<p align="center">');
    expect(showcase).toContain("[!TIP]");
    expect(showcase).toContain("starts with its emoji");
    const minimal = readmeSystemPrompt(README_TEMPLATES.minimal.style);
    expect(minimal).toContain("No badges.");
    expect(minimal).toContain("No emoji in headings.");
    expect(minimal).not.toContain("[!TIP]");
  });
});

describe("README images", () => {
  it("draw a banner with the accent phrase coloured and text limits for checking", () => {
    const svg = renderBanner(banner, { name: "Pingie", theme: readmeTheme("aurora") });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1280" height="400"/);
    const accent = readmeTheme("aurora").tokens["--accent-soft"]!;
    expect(svg).toContain(`<tspan fill="${accent}"> what</tspan>`);
    expect(svg).toContain('data-max-x="750"');
    expect(svg).toContain("refund-policy.docx");
    expect(svg).not.toMatch(/<script|href="http/);
  });

  it("leave out chat messages that would spill out of the panel", () => {
    const many: Banner = { ...banner, panel: { type: "chat", title: "Help", messages: Array.from({ length: 4 }, (_, i) => ({ from: i % 2 ? "app" : "user", text: "A fairly long message that wraps onto a second line here", chip: "source.md" }) as const) } };
    const svg = renderBanner(many, { name: "X", theme: readmeTheme("aurora") });
    const ys = [...svg.matchAll(/<text x="\d+(?:\.\d+)?" y="([\d.]+)" font-size="1[0-2](?:\.5)?"/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(60 + 280);
  });

  it("draw a diagram on a card with the deck's diagram styles", () => {
    const fig = sampleDeck.slides.flatMap((s) => pageBlocks(s)).find((b) => b.type === "diagram" && b.figure.kind === "architecture");
    if (!fig || fig.type !== "diagram") throw new Error("fixture changed");
    const svg = renderDiagramImage(fig.figure, { title: "Architecture", caption: "How it fits together.", theme: readmeTheme("midnight") });
    expect(svg).toContain(".d-box { fill: var(--surface-2)");
    expect(svg).toContain("ARCHITECTURE");
    expect(svg).toMatch(/<svg x="[\d.]+" y="76" width="[\d.]+" height="[\d.]+" viewBox=/);
  });

  it("write shields.io badges with escaped dashes", () => {
    expect(badgeMarkdown([{ label: "Next.js", message: "16-canary", color: "000000", logo: "nextdotjs" }])).toBe("![Next.js](https://img.shields.io/badge/Next.js-16--canary-000000?logo=nextdotjs&logoColor=white)");
  });

  it("name uploaded images safely and uniquely", () => {
    const used = new Set<string>();
    expect(assetFileName("Dashboard Screenshot.PNG", used)).toBe("dashboard-screenshot.png");
    expect(assetFileName("dashboard screenshot.png", used)).toBe("dashboard-screenshot-2.png");
    expect(assetFileName("../../etc/passwd", used)).toBe("etc-passwd.png");
  });
});

describe("README path check", () => {
  it("flags missing paths but not MIME types, elisions or files that exist in a subfolder", () => {
    const inventory = [{ path: "ping-backend/app/prompts.py" }, { path: "ping-widget/src/index.ts" }] as Array<{ path: string; sizeBytes: number; selected: boolean }>;
    const md = "Uses `text/javascript`, `.../skip`, `prompts.py`, `ping-widget/src/index.ts` and `ping-backend/app/missing.py`.";
    expect(findUnknownPaths(md, { inventory })).toEqual(["ping-backend/app/missing.py"]);
  });
});

describe("README delivery", () => {
  it("keeps images that ship with the README and drops links to missing files", () => {
    const md = '<p align="center"><img src="docs/readme/banner.svg" alt="b"></p>\n\n![x](docs/readme/missing.png)';
    const { markdown, removed } = dropMissingImages(md, { inventory: [] }, ["docs/readme/banner.svg"]);
    expect(markdown).toContain("docs/readme/banner.svg");
    expect(removed).toEqual(["docs/readme/missing.png"]);
  });

  it("commits README images next to README.md, and nothing outside docs/readme", () => {
    const plan = planFiles({
      doc: { kind: "readme", title: "README", markdown: "# X", sourceCommit: "abc" },
      now: new Date(),
      hasGitfillReadme: true,
      existingDocs: [],
      assets: [
        { path: "docs/readme/banner.svg", content: "<svg/>" },
        { path: "docs/readme/shot.png", content: "iVBO", encoding: "base64" },
        { path: ".github/workflows/x.yml", content: "evil" },
      ],
    });
    expect(plan.files.map((f) => f.path)).toEqual(["README.md", "docs/readme/banner.svg", "docs/readme/shot.png"]);
  });

  it("uploads binary files as blobs before building the tree", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/git/ref/heads/main")) return reply(200, { object: { sha: "base" } });
      if (url.endsWith("/git/commits/base")) return reply(200, { tree: { sha: "bt" } });
      if (url.endsWith("/git/blobs")) return reply(201, { sha: "blob1" });
      if (url.endsWith("/git/trees")) return reply(201, { sha: "t" });
      if (url.endsWith("/git/commits")) return reply(201, { sha: "c" });
      if (url.endsWith("/git/refs")) return reply(201, {});
      return reply(201, { number: 1, html_url: "https://github.com/o/r/pull/1" });
    }) as typeof fetch;
    await new GitHubClient("t", fake).openPullRequest("o", "r", { base: "main", branch: "gitfill/readme-x", title: "T", body: "B", message: "M", files: [{ path: "README.md", content: "# X" }, { path: "docs/readme/shot.png", content: "iVBO", encoding: "base64" }] });
    expect(calls.find((c) => c.url.endsWith("/git/blobs"))!.body).toEqual({ content: "iVBO", encoding: "base64" });
    expect(calls.find((c) => c.url.endsWith("/git/trees"))!.body!.tree).toEqual([
      { path: "README.md", mode: "100644", type: "blob", content: "# X" },
      { path: "docs/readme/shot.png", mode: "100644", type: "blob", sha: "blob1" },
    ]);
  });

  it("reads only well-formed file records from document metadata", () => {
    expect(documentFiles({ files: [{ path: "docs/readme/a.svg", mime: "image/svg+xml", alt: "", kind: "banner", key: "k", sizeBytes: 3 }] })).toHaveLength(1);
    expect(documentFiles({ files: [{ path: 1 }] })).toEqual([]);
    expect(documentFiles(null)).toEqual([]);
  });
});

describe("README preview", () => {
  it("splits centered header blocks and GitHub alerts, turning tags into Markdown", () => {
    const md = [
      '<p align="center">',
      '  <img src="docs/readme/banner.svg" alt="Pingie banner" width="100%">',
      "</p>",
      "",
      '<div align="center">',
      "",
      "![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688)",
      "",
      "[Live app](#) · [Demo](#)",
      "",
      "</div>",
      "",
      "> [!TIP]",
      "> **Hackathon build:** answers by Nemotron.",
      "",
      "## Contents<br/>",
      '<script>alert(1)</script><a href="https://x.dev">X</a>',
    ].join("\n");
    const segs = readmeSegments(md);
    expect(segs.map((s) => s.kind)).toEqual(["center", "center", "alert", "md"]);
    expect(segs[0]!.md).toBe("![Pingie banner](docs/readme/banner.svg)");
    expect(segs[2]).toEqual({ kind: "alert", type: "TIP", md: "**Hackathon build:** answers by Nemotron." });
    expect(segs[3]!.md).toContain("## Contents  \n");
    expect(segs[3]!.md).toContain("[X](https://x.dev)");
    // Tags GitFill does not understand are not turned into anything that renders.
    expect(segs[3]!.md).toContain("<script>");
  });
});

const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath()) || Boolean(process.env.CHROMIUM_PATH);
  } catch {
    return false;
  }
})();

describe.skipIf(!hasChromium)("README image checks", () => {
  afterAll(() => closeBrowser());
  it("finds banner text that runs into the panel, and passes text that fits", async () => {
    const ok = renderBanner(banner, { name: "Pingie", theme: readmeTheme("aurora") });
    const long = renderBanner({ ...banner, tagline: "Wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww" }, { name: "Pingie", theme: readmeTheme("aurora") });
    const [a, b] = await checkSvgText([ok, long]);
    expect(a).toEqual([]);
    expect(b!.length).toBeGreaterThan(0);
  }, 60_000);
});
