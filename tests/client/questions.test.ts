import { describe, expect, it } from "vitest";
import { formatAnswers, formatQuestions, parseQuestions, type AskUser } from "@/lib/client/questions";

const ask: AskUser = {
  intro: "Pingie has a widget, a dashboard, an admin console and a docs site.",
  questions: [
    { question: "Who reads it?", options: [{ label: "Hackathon judges" }, { label: "New engineers", detail: "ping-backend/tests" }], multiple: false, kind: "choice" },
    { question: "What to feature?", options: [{ label: "Nebius and NVIDIA" }, { label: "Memora" }], multiple: true, kind: "choice" },
  ],
};

describe("chat questions", () => {
  it("round-trips through the reply text", () => {
    const { text, ask: parsed } = parseQuestions(formatQuestions(ask));
    expect(text).toBe(ask.intro);
    expect(parsed?.questions).toEqual(ask.questions);
  });

  it("leaves ordinary replies and broken blocks alone", () => {
    expect(parseQuestions("Started the handbook.").ask).toBeNull();
    const broken = "Hi\n\n```questions\n{not json}\n```";
    expect(parseQuestions(broken)).toEqual({ text: broken, ask: null });
  });

  it("formats answers with chosen options, own words and defaults", () => {
    expect(formatAnswers(ask, [{ chosen: ["Hackathon judges"], other: "" }, { chosen: ["Nebius and NVIDIA", "Memora"], other: "  show screenshots " }])).toBe(
      "1. Who reads it? — Hackathon judges\n2. What to feature? — Nebius and NVIDIA; Memora; show screenshots",
    );
    expect(formatAnswers(ask, [])).toContain("no preference, use your judgment");
  });
});
