import { describe, expect, it } from "vitest";
import { formatAttachments, parseAttachments } from "@/lib/client/attachments";
import { formatAnswers, type AskUser } from "@/lib/client/questions";

const shot = { id: "6f1c2a7e-1b2c-4d5e-8f90-123456789abc", filename: "dashboard.png", kind: "image" as const, description: "The analytics dashboard" };

describe("chat attachments", () => {
  it("round-trips through the message text", () => {
    const message = `Use this screenshot.${formatAttachments([shot])}`;
    expect(parseAttachments(message)).toEqual({ text: "Use this screenshot.", attachments: [shot] });
    expect(formatAttachments([])).toBe("");
  });

  it("leaves messages without a valid block untouched", () => {
    expect(parseAttachments("plain")).toEqual({ text: "plain", attachments: [] });
    expect(parseAttachments("x\n\n```attachments\nnot json\n```").attachments).toEqual([]);
  });

  it("lists files uploaded while answering a question", () => {
    const ask: AskUser = { intro: "", questions: [{ question: "Any screenshots?", options: [{ label: "Dashboard" }, { label: "Widget" }], multiple: false, kind: "upload" }] };
    const text = formatAnswers(ask, [{ chosen: [], other: "", uploads: [shot] }]);
    expect(text).toContain("uploaded dashboard.png");
    expect(parseAttachments(text).attachments).toEqual([shot]);
  });
});
