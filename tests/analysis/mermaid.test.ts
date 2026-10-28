import { describe, expect, it } from "vitest";
import { checkMermaidSyntax, dependencyDiagram, normalizeDiagram, renderMermaid, type DiagramSpec } from "@/lib/analysis/mermaid";

describe("mermaid rendering", () => {
  const spec: DiagramSpec = {
    kind: "flowchart",
    title: "Login flow",
    nodes: [
      { id: "client", label: 'Browser "UI"', kind: "actor" },
      { id: "api", label: "API <router>", kind: "service", path: "src/api.ts", line: 10 },
      { id: "db", label: "Postgres", kind: "store", inferred: true },
    ],
    edges: [
      { from: "client", to: "api", label: "POST /login" },
      { from: "api", to: "db", kind: "data", inferred: true },
      { from: "api", to: "ghost" },
    ],
  };

  it("drops edges to unknown nodes and reports them", () => {
    const { spec: clean, issues } = normalizeDiagram(spec);
    expect(clean.edges).toHaveLength(2);
    expect(issues[0]?.message).toContain("ghost");
  });

  it("renders a flowchart with escaped labels, inferred styling and valid syntax", () => {
    const text = renderMermaid(normalizeDiagram(spec).spec);
    expect(text.startsWith("flowchart TB")).toBe(true);
    expect(text).toContain('n1(["Browser #quot;UI#quot;"])');
    expect(text).toContain('n2["API #lt;router#gt;"]');
    expect(text).toContain("n3[(\"Postgres\")]");
    expect(text).toContain("n2 -.-> n3");
    expect(text).toContain("class n3 inferred");
    expect(checkMermaidSyntax(text)).toEqual([]);
  });

  it("renders sequence, class and er diagrams", () => {
    const seq = renderMermaid({ kind: "sequence", title: "t", nodes: [{ id: "a", label: "A", kind: "actor" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b", label: "call: x", order: 1 }, { from: "b", to: "a", kind: "returns", label: "ok", order: 2 }] });
    expect(seq).toContain("sequenceDiagram");
    expect(seq).toContain("actor n1 as A");
    expect(seq).toContain("n1->>n2: call  x");
    expect(seq).toContain("n2-->>n1: ok");

    const cls = renderMermaid({ kind: "class", title: "t", nodes: [{ id: "base", label: "Base", members: ["+run(): void"] }, { id: "child", label: "Child" }], edges: [{ from: "child", to: "base", kind: "inherits" }] });
    expect(cls).toContain("classDiagram");
    expect(cls).toContain("+run(): void");
    expect(cls).toContain("n1 <|-- n2");

    const er = renderMermaid({ kind: "er", title: "t", nodes: [{ id: "u", label: "users", members: ["id: uuid PK", "email: text"] }, { id: "p", label: "posts" }], edges: [{ from: "u", to: "p", kind: "one_to_many", label: "writes" }] });
    expect(er).toContain("erDiagram");
    expect(er).toContain("uuid id PK");
    expect(er).toContain('n1 ||--o{ n2 : "writes"');
    for (const t of [seq, cls, er]) expect(checkMermaidSyntax(t)).toEqual([]);
  });

  it("builds a dependency diagram from the module graph", () => {
    const d = dependencyDiagram({ nodes: [{ id: "src/api", label: "src/api", files: 3 }, { id: "src/db", label: "src/db", files: 1 }], edges: [{ from: "src/api", to: "src/db", weight: 2 }] }, "deps");
    expect(d.nodes[0]?.label).toBe("src/api (3 files)");
    expect(d.edges[0]?.label).toBe("2 imports");
    expect(checkMermaidSyntax(renderMermaid(d))).toEqual([]);
  });

  it("flags unbalanced brackets", () => {
    expect(checkMermaidSyntax("flowchart TB\n  a[\"x\"\n")).not.toEqual([]);
  });
});
