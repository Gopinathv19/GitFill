import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { chromium } from "playwright-core";
import { afterAll, describe, expect, it } from "vitest";
import { uncitedShare } from "@/lib/presentation/content-review";
import { renderDeckHtml } from "@/lib/presentation/html/render";
import { imageBox, toTextProps, writePptx } from "@/lib/presentation/pptx";
import { checkFigurePaths, deckSpecSchema, normalizeDeckSpec, pathExists, type DeckSpec, type PageSlide } from "@/lib/presentation/spec";
import { getTheme } from "@/lib/presentation/themes";
import { closeBrowser, renderDeckHtml as renderPages } from "@/lib/render/browser";
import { checkRender } from "@/lib/validation/checks";
import { sampleDeck } from "@/tests/fixtures/sample-deck";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const ASSET = "6f1c2a7e-1b2c-4d5e-8f90-123456789abc";
const ctx = { repoLabel: "acme/app · main", evidence: "evidence: acme/app @ abc1234" };

/** The sample deck plus a page showing an uploaded screenshot. */
function withImage(theme: DeckSpec["theme"] = "midnight"): DeckSpec {
  const image: PageSlide = {
    id: "s11",
    layout: "page",
    section: "Demo",
    title: "The dashboard shows grounded answers",
    style: "atlas",
    arrangement: "split",
    density: "normal",
    notes: "",
    claimRefs: [],
    main: [{ type: "image", assetId: ASSET, caption: "The answers view cites every passage.", frame: "browser", fit: "contain", claimRefs: ["U1"] }],
    side: [{ type: "callout", tone: "takeaway", text: "Every answer links to its source.", claimRefs: [] }],
  };
  return deckSpecSchema.parse({ ...sampleDeck, theme, materials: [{ id: ASSET, ref: "U1", kind: "image", name: "dashboard.png", description: "Answers view" }], slides: [...sampleDeck.slides, image] });
}

describe("deck spec checks", () => {
  it("keeps images and U refs for known uploads and drops the rest", () => {
    const spec = withImage();
    const stray = structuredClone(spec);
    (stray.slides.at(-1) as PageSlide).main.unshift({ type: "image", assetId: "00000000-0000-4000-8000-000000000000", frame: "plain", fit: "contain", claimRefs: [] });
    const { spec: out, issues } = normalizeDeckSpec(stray, new Set());
    const page = out.slides.at(-1) as PageSlide;
    expect(page.main.map((b) => b.type)).toEqual(["image"]);
    expect(page.main[0]!.type === "image" && page.main[0]!.claimRefs).toEqual(["U1"]);
    expect(issues.some((i) => i.message.includes("unknown asset"))).toBe(true);
  });

  it("marks diagram nodes whose repository path does not exist as inferred", () => {
    const paths = new Set(["app/api/routes.py", "app/services/ingest.py"]);
    expect(pathExists("app/services", paths)).toBe(true);
    expect(pathExists("./app/api/routes.py:12-30", paths)).toBe(true);
    expect(pathExists("app/workers", paths)).toBe(false);
    const fig = { kind: "architecture" as const, lanes: [{ id: "a", zone: false }], nodes: [{ id: "x", lane: "a", title: "Workers", path: "app/workers", tone: "default" as const }, { id: "y", lane: "a", title: "Ingest", path: "app/services", tone: "default" as const }], edges: [] };
    const report: string[] = [];
    checkFigurePaths(fig, paths, (m) => report.push(m));
    expect(fig.nodes[0]).toMatchObject({ tone: "external" });
    expect(fig.nodes[0]!.path).toBeUndefined();
    expect(fig.nodes[1]!.path).toBe("app/services");
    expect(report).toHaveLength(1);
  });

  it("counts factual items that cite nothing", () => {
    const { items, uncited } = uncitedShare(sampleDeck);
    expect(items).toBeGreaterThan(10);
    expect(uncited).toBeLessThanOrEqual(items);
  });

  it("asks less of an airy deck's pages before calling them empty", () => {
    const measure = { overflow: [], fill: 0.4, diagramFontPx: null, clipped: [], hasDiagram: false };
    const rendered = sampleDeck.slides.map((s, index) => ({ index, slideId: s.id, pngPath: "", measure }));
    const dense = checkRender(sampleDeck, rendered).filter((i) => i.code === "underfilled").length;
    const airy = checkRender({ ...sampleDeck, deckType: "hackathon_pitch" }, rendered).filter((i) => i.code === "underfilled").length;
    expect(dense).toBeGreaterThan(0);
    expect(airy).toBe(0);
  });
});

describe("pptx helpers", () => {
  it("fits a contained image inside its box without stretching", () => {
    const box = imageBox({ t: "image", x: 0, y: 0, w: 400, h: 200, src: PNG, fit: "contain", nw: 100, nh: 100 });
    expect(box.w).toBeCloseTo(box.h);
    expect(box.x).toBeGreaterThan(0);
  });

  it("turns preformatted newlines into line breaks", () => {
    const fonts = getTheme("midnight").fonts;
    const props = toTextProps([{ text: "a\nb", size: 12, color: "ffffff", bold: false, italic: false, font: "mono", spacing: 0 }], fonts, true);
    expect(props.map((p) => p.text)).toEqual(["a", "b"]);
    expect(props[0]!.options?.breakLine).toBe(true);
    expect(props[0]!.options?.fontFace).toBe("Consolas");
  });
});

const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath()) || Boolean(process.env.CHROMIUM_PATH);
  } catch {
    return false;
  }
})();

describe.skipIf(!hasChromium)("native export", () => {
  afterAll(() => closeBrowser());

  it("writes real, editable text and shapes, not one picture per slide", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gitfill-native-"));
    try {
      const spec = withImage("paper");
      const html = renderDeckHtml(spec, { ...ctx, images: new Map([[ASSET, PNG]]) });
      const render = await renderPages(html, dir, { native: true, pdf: false });
      expect(render.slides.every((s) => s.native && s.backgroundPath)).toBe(true);
      const page = render.slides[3]!.native!;
      expect(page.items.some((i) => i.t === "text" && i.runs.some((r) => r.text.includes("System map")))).toBe(true);
      expect(page.items.some((i) => i.t === "line" && i.arrow)).toBe(true);
      expect(render.slides.at(-1)!.native!.items.some((i) => i.t === "image" && i.src.startsWith("data:image/png"))).toBe(true);

      const zip = await JSZip.loadAsync(await writePptx(spec, render.slides, "native"));
      const slide4 = await zip.file("ppt/slides/slide4.xml")!.async("string");
      expect(slide4).toContain("System map");
      expect(slide4).toContain('typeface="Georgia"');
      expect((slide4.match(/<p:sp>/g) ?? []).length).toBeGreaterThan(20);

      const pictures = await JSZip.loadAsync(await writePptx(spec, render.slides, "image"));
      // Picture mode carries the title only as alt text: no text runs on the slide.
      expect(await pictures.file("ppt/slides/slide4.xml")!.async("string")).not.toContain("<a:t>");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("renders every template with a different look and no overflow in the sample deck", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "gitfill-tpl-"));
    try {
      for (const theme of ["aurora", "blueprint", "contrast"] as const) {
        const spec = withImage(theme);
        const html = renderDeckHtml(spec, { ...ctx, images: new Map([[ASSET, PNG]]) });
        expect(html).toContain(`tpl-${theme}`);
        const render = await renderPages(html, path.join(dir, theme), { pdf: false });
        const issues = checkRender(spec, render.slides).filter((i) => i.code === "overflow" || i.code === "diagram_text_clipped");
        expect(issues).toEqual([]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
