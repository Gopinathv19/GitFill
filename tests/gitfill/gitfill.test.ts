import { describe, expect, it } from "vitest";
import { GitHubClient, GitHubError } from "@/lib/connectors/github/client";
import { selectFiles } from "@/lib/connectors/github/filter";
import { dropMissingImages } from "@/lib/documents/readme";
import { renderSpec, type BrainstormSpec } from "@/lib/gitfill/brainstorm";
import { destinationOf, planFiles } from "@/lib/gitfill/deliver";
import { readFrontMatter, slugify, withFrontMatter } from "@/lib/gitfill/layout";
import { assetKind, describeGitfill } from "@/lib/gitfill/read";

const now = new Date("2026-11-02T10:00:00Z");
const doc = (kind: Parameters<typeof destinationOf>[0], title = "Architecture overview") => ({ kind, title, markdown: "# Body\n\nText.", sourceCommit: "abc1234def" });

describe("planFiles", () => {
  it("puts a README at the root and adds the folder README the first time", () => {
    const plan = planFiles({ doc: doc("readme"), now, hasGitfillReadme: false, existingDocs: [] });
    expect(plan.path).toBe("README.md");
    expect(plan.files.map((f) => f.path)).toEqual(["README.md", ".gitfill/README.md"]);
  });

  it("writes docs with front matter and an index that keeps the existing docs", () => {
    const plan = planFiles({ doc: doc("handbook"), now, hasGitfillReadme: true, existingDocs: [{ path: ".gitfill/docs/data-model.md", title: "Data model", sourceCommit: "1111111aaa" }] });
    expect(plan.path).toBe(".gitfill/docs/architecture-overview.md");
    const [file, index] = plan.files;
    expect(readFrontMatter(file!.content)).toMatchObject({ gitfill: "docs", title: "Architecture overview", source_commit: "abc1234def", generated: "2026-11-02" });
    expect(index!.path).toBe(".gitfill/docs/index.md");
    expect(index!.content).toContain("| [Architecture overview](architecture-overview.md) | `abc1234` |");
    expect(index!.content).toContain("| [Data model](data-model.md) | `1111111` |");
    expect(plan.files).toHaveLength(2);
  });

  it("writes brainstorms and implementation briefs as dated, ready specs", () => {
    for (const kind of ["brainstorm", "implementation_brief"] as const) {
      const plan = planFiles({ doc: doc(kind, "Group booking!"), now, hasGitfillReadme: true, existingDocs: [] });
      expect(plan.path).toBe(".gitfill/brainstorm/2026-11-02-group-booking.md");
      expect(readFrontMatter(plan.files[0]!.content)).toMatchObject({ gitfill: "brainstorm", status: "ready" });
    }
  });
});

describe("layout", () => {
  it("round-trips front matter and tolerates hand-written values", () => {
    expect(readFrontMatter(withFrontMatter({ gitfill: "docs", title: 'A "quoted": title', source_commit: "x", generated: "2026-11-02" }, "body"))).toMatchObject({ title: 'A "quoted": title' });
    expect(readFrontMatter("---\ntitle: Plain words\nstatus: 'done'\n---\nbody")).toEqual({ title: "Plain words", status: "done" });
    expect(slugify("  Héllo, Wörld!  ")).toBe("hello-world");
    expect(slugify("!!!")).toBe("untitled");
  });

  it("classifies assets and describes them for writers", () => {
    expect(["shot.PNG", "demo.mp4", "notes.md", "brand.json", "x.bin"].map(assetKind)).toEqual(["image", "video", "notes", "brand", "other"]);
    const text = describeGitfill({ present: true, hasReadme: true, assets: [{ path: ".gitfill/assets/shot.png", kind: "image", sizeBytes: 20480 }], notes: [{ path: ".gitfill/assets/product.md", content: "We help travel agents." }], docs: [], brainstorms: [] });
    expect(text).toContain(".gitfill/assets/shot.png (20 KB)");
    expect(text).toContain('<team_note path=".gitfill/assets/product.md">');
    expect(describeGitfill({ present: false, hasReadme: false, assets: [], notes: [], docs: [], brainstorms: [] })).toMatch(/no \.gitfill folder/);
  });
});

describe("README images", () => {
  it("keeps images that exist and external ones, removes the rest", () => {
    const inventory = [{ path: ".gitfill/assets/hero.png", sizeBytes: 1, selected: false }];
    const md = "# App\n\n![Hero](.gitfill/assets/hero.png)\n\n![Missing](.gitfill/assets/nope.png)\n\n<img src=\"./.gitfill/assets/gone.gif\" width=400>\n\n![Badge](https://img.shields.io/x.svg)\n";
    const { markdown, removed } = dropMissingImages(md, { inventory });
    expect(markdown).toContain("![Hero](.gitfill/assets/hero.png)");
    expect(markdown).toContain("https://img.shields.io/x.svg");
    expect(removed).toEqual([".gitfill/assets/nope.png", "./.gitfill/assets/gone.gif"]);
    expect(markdown).not.toMatch(/nope|gone/);
  });
});

describe("analysis selection", () => {
  it("never selects .gitfill files as code evidence but keeps them in the inventory", () => {
    const { selected, inventory } = selectFiles([
      { path: "README.md", type: "blob", size: 100 },
      { path: ".gitfill/docs/architecture.md", type: "blob", size: 100 },
      { path: ".gitfill/assets/notes.md", type: "blob", size: 100 },
    ]);
    expect(selected.map((s) => s.path)).toEqual(["README.md"]);
    expect(inventory.filter((i) => i.skipReason === "gitfill_folder").map((i) => i.path).sort()).toEqual([".gitfill/assets/notes.md", ".gitfill/docs/architecture.md"]);
  });
});

describe("brainstorm specs", () => {
  it("renders tasks, checkable criteria and evidence for code references", () => {
    const spec: BrainstormSpec = {
      title: "Group booking",
      summary: "Let one user book seats for a group in a single run.",
      decisions: [{ decision: "Cap groups at 10", why: "keeps validation simple" }],
      openQuestions: ["Should groups get a discount?"],
      codeContext: [{ path: "main.go", today: "Books one ticket per loop", change: "Ask for a group size", claimRefs: ["C1", "C9"] }],
      approach: "Extend the existing loop and reuse the validation helper.",
      tasks: [{ title: "Ask for group size", detail: "Prompt after the name.", files: ["main.go"] }],
      acceptance: ["go build ./... passes"],
      outOfScope: [],
      risks: [],
    };
    const md = renderSpec(spec, [{ ref: "C1", claim: "x", claimType: "behavior" as never, filePath: "main.go", startLine: 10, endLine: 22, excerpt: null, status: "verified", note: "" }], { displayName: "o/GoApp", version: "cfc0167abc" });
    expect(md).toContain("| `main.go` | Books one ticket per loop | Ask for a group size | `main.go:10-22` |");
    expect(md).toContain("1. **Ask for group size** — Prompt after the name.\n   Files: `main.go`");
    expect(md).toContain("- [ ] go build ./... passes");
    expect(md).toContain("## Open questions");
    expect(md).not.toContain("## Risks");
  });
});

describe("GitHubClient.openPullRequest", () => {
  it("commits the files on a new branch from the base head and opens the pull request", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fake = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/git/ref/heads/main")) return reply(200, { object: { sha: "base" } });
      if (url.endsWith("/git/commits/base")) return reply(200, { tree: { sha: "basetree" } });
      if (url.endsWith("/git/trees")) return reply(201, { sha: "newtree" });
      if (url.endsWith("/git/commits")) return reply(201, { sha: "newcommit" });
      if (url.endsWith("/git/refs")) return reply(201, {});
      if (url.endsWith("/pulls")) return reply(201, { number: 7, html_url: "https://github.com/o/r/pull/7" });
      return reply(404, {});
    }) as typeof fetch;
    const pr = await new GitHubClient("t", fake).openPullRequest("o", "r", { base: "main", branch: "gitfill/docs-x", title: "T", body: "B", message: "M", files: [{ path: ".gitfill/docs/x.md", content: "hi" }] });
    expect(pr).toEqual({ number: 7, url: "https://github.com/o/r/pull/7", branch: "gitfill/docs-x", commitSha: "newcommit" });
    expect(calls.map((c) => `${c.method} ${c.url.replace("https://api.github.com/repos/o/r", "")}`)).toEqual(["GET /git/ref/heads/main", "GET /git/commits/base", "POST /git/trees", "POST /git/commits", "POST /git/refs", "POST /pulls"]);
    expect(calls[2]!.body).toEqual({ base_tree: "basetree", tree: [{ path: ".gitfill/docs/x.md", mode: "100644", type: "blob", content: "hi" }] });
    expect(calls[3]!.body).toEqual({ message: "M", tree: "newtree", parents: ["base"] });
    expect(calls[4]!.body).toEqual({ ref: "refs/heads/gitfill/docs-x", sha: "newcommit" });
  });

  it("explains a refused write", async () => {
    const fake = (async (url: string, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") return new Response(JSON.stringify(url.includes("/git/ref/") ? { object: { sha: "b" } } : { tree: { sha: "t" } }), { status: 200 });
      return new Response(JSON.stringify({ message: "Resource not accessible by integration" }), { status: 403 });
    }) as typeof fetch;
    const err = await new GitHubClient("t", fake).openPullRequest("o", "r", { base: "main", branch: "gitfill/x", title: "T", body: "B", message: "M", files: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as Error).message).toMatch(/did not allow GitFill to write.*Resource not accessible/);
  });
});
