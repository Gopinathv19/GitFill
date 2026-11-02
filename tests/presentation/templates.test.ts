import { describe, expect, it } from "vitest";
import { DECK_TYPE_DEFS, DECK_TYPES, deckTypeDef, slidesForMinutes, UNDERFILL_BY_DENSITY } from "@/lib/presentation/deck-types";
import { contrastRatio, getTheme, isTemplateId, TEMPLATE_IDS, TEMPLATES } from "@/lib/presentation/themes";
import { deckGuide, outlinePrompt } from "@/lib/ai/prompts";

describe("templates", () => {
  it("resolves every template to a complete token set with a readable accent", () => {
    const keys = Object.keys(getTheme("midnight").tokens);
    for (const id of TEMPLATE_IDS) {
      const t = getTheme(id);
      expect(Object.keys(t.tokens).sort()).toEqual([...keys].sort());
      expect(contrastRatio(t.tokens["--accent"]!, t.tokens["--bg"]!)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(t.tokens["--text"]!, t.tokens["--bg"]!)).toBeGreaterThanOrEqual(7);
      expect(t.background).toMatch(/^[0-9A-F]{6}$/);
    }
  });

  it("keeps the two original themes exactly as they were tuned", () => {
    expect(getTheme("midnight").tokens["--accent"]).toBe("#14b8a6");
    expect(getTheme("daylight").tokens["--bg"]).toBe("#ffffff");
  });

  it("applies a brand on top of a template and keeps the accent readable", () => {
    const t = getTheme("daylight", { accent: "#ffee00", headingFont: "Montserrat", bodyFont: "Inter" });
    expect(contrastRatio(t.tokens["--accent"]!, t.tokens["--bg"]!)).toBeGreaterThanOrEqual(3);
    expect(t.fonts.pptx).toEqual({ body: "Inter", heading: "Montserrat", mono: "Consolas" });
    expect(t.tokens["--font-heading"]).toContain('"Montserrat"');
  });

  it("derives dark or light mode from a brand background and ignores unsafe font names", () => {
    const dark = getTheme("daylight", { background: "#101010" });
    expect(contrastRatio(dark.tokens["--text"]!, dark.tokens["--bg"]!)).toBeGreaterThanOrEqual(7);
    expect(dark.tokens["--shadow"]).toContain(".55");
    const t = getTheme("midnight", { headingFont: 'x"; } body { color: red' });
    expect(t.tokens["--font-heading"]).not.toContain("color");
  });

  it("falls back to midnight for an unknown template", () => {
    expect(isTemplateId("nope")).toBe(false);
    expect(getTheme("nope").name).toBe("midnight");
    expect(new Set(TEMPLATE_IDS.map((id) => TEMPLATES[id].cover)).size).toBeGreaterThan(1);
  });
});

describe("deck types", () => {
  it("turns talk length into a bounded slide count", () => {
    expect(slidesForMinutes("hackathon_pitch", 5)).toBe(9);
    expect(slidesForMinutes("architecture_review", 30)).toBe(16);
    expect(slidesForMinutes("tech_talk", 1)).toBe(4);
    expect(slidesForMinutes("onboarding", 90)).toBe(20);
  });

  it("gives airy decks a lower fill bar and no 'fill the page' rule", () => {
    expect(UNDERFILL_BY_DENSITY.airy).toBeLessThan(UNDERFILL_BY_DENSITY.dense);
    expect(deckGuide("hackathon_pitch")).toContain("Density: airy");
    expect(deckGuide("hackathon_pitch")).not.toContain("Handbook-style pages");
    expect(deckGuide("engineering_walkthrough")).toContain("Density: dense");
  });

  it("puts each deck type's own story and recipes into the outline prompt", () => {
    for (const t of DECK_TYPES) {
      const prompt = outlinePrompt(t);
      expect(prompt).toContain(DECK_TYPE_DEFS[t].story);
      expect(prompt).toContain(DECK_TYPE_DEFS[t].recipes.split("\n")[0]!);
    }
    expect(deckTypeDef("unknown").id).toBe("engineering_walkthrough");
  });
});
