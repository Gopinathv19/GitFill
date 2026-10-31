import { describe, expect, it } from "vitest";
import type { SourceFile } from "@/lib/connectors/types";
import { parseAnswer, replaceCitations, verifyCitations } from "@/lib/evidence/citations";

const file = (path: string, content: string): SourceFile => ({ path, category: "source", sizeBytes: content.length, content, lineCount: content.split("\n").length });
const files = new Map([
  ["lib/evidence/evidence.ts", file("lib/evidence/evidence.ts", "import x;\nexport function verifyClaim(ref) {\n  return extractIdentifiers(ref);\n}\n")],
  ["app/api/[id]/route.ts", file("app/api/[id]/route.ts", "export async function GET() {}\n")],
]);
const opts = { refPrefix: "C", firstIndex: 1, max: 40 };

describe("parseAnswer", () => {
  it("splits title, diagram and trailing sections from the body", () => {
    const parsed = parseAnswer(
      [
        "# How verification works",
        "",
        "`verifyClaim` checks lines `lib/evidence/evidence.ts:2-3`.",
        "",
        "```diagram",
        '{"kind":"flowchart","title":"Flow","nodes":[{"id":"a","label":"A"}],"edges":[]}',
        "```",
        "",
        "## Not verified",
        "- Whether callers retry.",
        "",
        "## Ask next",
        "- Where are claims stored?",
        "- None",
      ].join("\n"),
    );
    expect(parsed.title).toBe("How verification works");
    expect(parsed.body).toBe("`verifyClaim` checks lines `lib/evidence/evidence.ts:2-3`.");
    expect(parsed.diagram?.title).toBe("Flow");
    expect(parsed.unverified).toEqual(["Whether callers retry."]);
    expect(parsed.followUps).toEqual(["Where are claims stored?"]);
  });

  it("drops an invalid diagram and reports why", () => {
    const parsed = parseAnswer("Answer.\n\n```diagram\n{not json}\n```");
    expect(parsed.diagram).toBeUndefined();
    expect(parsed.diagramError).toMatch(/not valid JSON/);
    expect(parsed.body).toBe("Answer.");
  });
});

describe("verifyCitations", () => {
  it("verifies a sentence whose identifiers appear in the cited lines", () => {
    const { claims, refs } = verifyCitations("The `verifyClaim` function calls `extractIdentifiers` `lib/evidence/evidence.ts:2-3`.", files, opts);
    expect(refs).toEqual(["C1"]);
    expect(claims[0]).toMatchObject({ status: "verified", filePath: "lib/evidence/evidence.ts", startLine: 2, endLine: 3 });
    expect(claims[0]!.claim).toBe("The `verifyClaim` function calls `extractIdentifiers`");
  });

  it("marks a sentence without identifiers as inferred, not verified", () => {
    const { claims } = verifyCitations("Claims are checked here `lib/evidence/evidence.ts:2`.", files, opts);
    expect(claims[0]!.status).toBe("inferred");
  });

  it("flags identifiers missing from the cited lines and unknown files", () => {
    const { claims } = verifyCitations("It calls `saveClaim` `lib/evidence/evidence.ts:1`. Then `x` runs `lib/missing.ts:4`.", files, opts);
    expect(claims.map((c) => c.status)).toEqual(["unverified", "unverified"]);
  });

  it("splits sentences on one line and ignores non-path tokens like hosts", () => {
    const { claims, refs } = verifyCitations("The server listens on `localhost:3000`. The `GET` handler lives in `app/api/[id]/route.ts:1`.", files, opts);
    expect(refs).toEqual([null, "C1"]);
    expect(claims[0]).toMatchObject({ status: "verified", claim: "The `GET` handler lives in" });
  });

  it("gives each of two citations in one sentence its own clause", () => {
    const { claims } = verifyCitations("It defines `verifyClaim` `lib/evidence/evidence.ts:2`, then calls `extractIdentifiers` `lib/evidence/evidence.ts:3`.", files, opts);
    expect(claims.map((c) => c.claim)).toEqual(["It defines `verifyClaim`", "then calls `extractIdentifiers`"]);
    expect(claims.map((c) => c.status)).toEqual(["verified", "verified"]);
  });

  it("uses the whole sentence when the citation leads it", () => {
    const { claims } = verifyCitations("In `lib/evidence/evidence.ts:2-3` the `verifyClaim` function calls `extractIdentifiers`.", files, opts);
    expect(claims[0]!.claim).toBe("In the `verifyClaim` function calls `extractIdentifiers`.");
  });

  it("does not treat a backticked file path as a code identifier", () => {
    const { claims } = verifyCitations("`lib/evidence/evidence.ts` exports `verifyClaim` `lib/evidence/evidence.ts:2`.", files, opts);
    expect(claims[0]!.status).toBe("verified");
  });

  it("reuses the ref for a repeated citation and links them in order", () => {
    const body = "A `verifyClaim` `lib/evidence/evidence.ts:2`. B `localhost:80`. A `verifyClaim` `lib/evidence/evidence.ts:2`.";
    const { claims, refs } = verifyCitations(body, files, opts);
    expect(claims).toHaveLength(1);
    expect(refs).toEqual(["C1", null, "C1"]);
    expect(replaceCitations(body, refs, (ref, c) => `<${c}>[^${ref}]`)).toBe(
      "A `verifyClaim` <lib/evidence/evidence.ts:2>[^C1]. B `localhost:80`. A `verifyClaim` <lib/evidence/evidence.ts:2>[^C1].",
    );
  });
});
