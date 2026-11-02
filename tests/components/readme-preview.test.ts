import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadmeMarkdown } from "@/components/shared/markdown";

const README = [
  '<p align="center">',
  '  <img src="docs/readme/banner.svg" alt="pingie banner" width="100%">',
  "</p>",
  "",
  '<div align="center">',
  "",
  "![python](https://img.shields.io/badge/python-3.12-3776AB) ![next.js](https://img.shields.io/badge/next.js-16-000000)",
  "",
  "</div>",
  "",
  "> [!TIP]",
  "> **Pingie answers only from your files.**",
  "",
  "## 🏗️ Architecture",
  "",
  '<p align="center"><img src="docs/readme/architecture.svg" alt="Architecture" width="100%"></p>',
  "",
  "| Part | Job |",
  "|---|---|",
  "| Chat widget | Shadow DOM script |",
  "",
  "![shot](ping-frontend/public/shot.png)",
  "",
  "<script>alert(1)</script>",
].join("\n");

describe("README preview", () => {
  const resolve = (src: string) => (src.startsWith("http") ? src : src.startsWith("docs/readme/") ? `/api/documents/d1/files/${src}` : `https://raw.githubusercontent.com/o/r/sha/${src}`);
  // ReadmeMarkdown's children are a required string prop, which createElement's third argument cannot satisfy in TypeScript.
  // eslint-disable-next-line react/no-children-prop
  const html = renderToStaticMarkup(createElement(ReadmeMarkdown, { resolveImage: resolve, children: README }));

  it("renders banner, badges, diagrams and repository images with resolved sources", () => {
    expect(html).toContain('src="/api/documents/d1/files/docs/readme/banner.svg"');
    expect(html).toContain('src="/api/documents/d1/files/docs/readme/architecture.svg"');
    expect(html).toContain('src="https://img.shields.io/badge/python-3.12-3776AB"');
    expect(html).toContain('src="https://raw.githubusercontent.com/o/r/sha/ping-frontend/public/shot.png"');
    expect(html).toMatch(/<div class="my-3 text-center[^"]*"><p><img/);
  });

  it("shows GitHub alerts as callouts and tables as tables", () => {
    expect(html).toContain(">Tip</p>");
    expect(html).toContain("<strong>Pingie answers only from your files.</strong>");
    expect(html).toContain("<table>");
  });

  it("never renders raw HTML", () => {
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
