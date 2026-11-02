import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataView, hasData, humanizeKey } from "@/components/shared/data-view";

const html = (value: unknown) => renderToStaticMarkup(createElement(DataView, { value }));
const text = (value: unknown) => html(value).replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("DataView", () => {
  it("turns keys into labels", () => {
    expect(humanizeKey("end_line")).toBe("End line");
    expect(humanizeKey("totalLines")).toBe("Total lines");
    expect(humanizeKey("repository_url")).toBe("Repository URL");
  });

  it("shows a tool call without JSON syntax, with line ranges folded and file content as code", () => {
    const out = text({ path: "ping-backend/app/clients/llm.py", start_line: 1, end_line: 60, content: "   1| import uuid\n   2| from x import y", totalLines: 211, cached: false, matches: ["a.py", "b.py"] });
    expect(out).not.toMatch(/[{}"]/);
    expect(out).toContain("Lines 1–60");
    expect(out).toContain("Total lines 211");
    expect(out).toContain("Cached No");
    expect(html({ content: "a\nb" })).toContain("<pre");
  });

  it("shows lists of records as a table", () => {
    const out = html([{ ref: "C1", status: "verified" }, { ref: "C2", status: "inferred" }]);
    expect(out).toContain("<table");
    expect(out).toContain("Status");
  });

  it("knows when there is nothing to show", () => {
    expect([hasData({}), hasData([]), hasData(""), hasData(null), hasData({ a: 1 })]).toEqual([false, false, false, false, true]);
  });
});

describe("DataView with trimmed lists", () => {
  it("shows the kept records as a table and how many were left out", () => {
    const out = html([{ ref: "C1", status: "verified" }, { ref: "C2", status: "verified" }, "…3 more"]);
    expect(out).toContain("<table");
    expect(text([{ ref: "C1" }, "…3 more"])).toContain("and 3 more");
  });
});

describe("DataView tables", () => {
  it("folds line ranges into one column", () => {
    const out = text([{ path: "a.py", start_line: 47, end_line: 53, claim: "x" }]);
    expect(out).toContain("Lines");
    expect(out).toContain("47–53");
    expect(out).not.toContain("End line");
  });
});
