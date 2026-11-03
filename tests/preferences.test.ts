import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, describePreferences, parsePreferences } from "@/lib/preferences/schema";
import { withPresentationDefaults } from "@/lib/workspaces/actions";

describe("preferences", () => {
  it("fills defaults and keeps valid sections when another is broken", () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    const p = parsePreferences({ reply: { tone: "friendly" }, loop: { intentRounds: 99 } });
    expect(p.reply.tone).toBe("friendly");
    expect(p.loop).toEqual(DEFAULT_PREFERENCES.loop);
  });

  it("describes the loop limits and memory for the agent", () => {
    const text = describePreferences({ ...DEFAULT_PREFERENCES, loop: { intentRounds: 0, askFormat: false, confirmBrief: false }, memory: { enabled: true, notes: [{ id: "a", text: "Presents to judges.", createdAt: "2026-11-03" }] } });
    expect(text).toMatch(/none\. Start the job straight away/);
    expect(text).toContain("- Presents to judges.");
    expect(describePreferences({ ...DEFAULT_PREFERENCES, memory: { enabled: false, notes: [{ id: "a", text: "secret", createdAt: "" }] } })).not.toContain("secret");
  });

  it("applies presentation defaults only where the request is silent", () => {
    const prefs = { ...DEFAULT_PREFERENCES.presentation, template: "paper" as const, slides: 8 };
    expect(withPresentationDefaults({}, prefs)).toMatchObject({ theme: "paper", repoBrand: true, slideCount: 8 });
    expect(withPresentationDefaults({ theme: "midnight" }, prefs)).toMatchObject({ theme: "midnight", repoBrand: false });
    expect(withPresentationDefaults({ minutes: 5 }, prefs).slideCount).toBeUndefined();
    expect(withPresentationDefaults({ slideCount: 12, repoBrand: true, theme: "aurora" }, { ...prefs, useProjectTheme: false })).toMatchObject({ slideCount: 12, repoBrand: true });
  });
});
