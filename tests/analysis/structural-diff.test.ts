import { describe, expect, it } from "vitest";
import { computeStructuralDiff, packagesOf, renderStructuralDiff } from "@/lib/analysis/structural-diff";

describe("computeStructuralDiff", () => {
  it("detects moved symbols, new dependencies, packages and routes", () => {
    const before = new Map([
      ["src/api/users.ts", "export function listUsers() {\n  return db.query('select');\n}\napp.get('/users', listUsers);\n"],
      ["package.json", JSON.stringify({ dependencies: { express: "^4" } })],
    ]);
    const after = new Map([
      ["src/api/users.ts", "import { listUsers } from '../services/users';\napp.get('/users', listUsers);\napp.delete('/users/:id', remove);\n"],
      ["src/services/users.ts", "export function listUsers() {\n  return repo.all();\n}\n"],
      ["package.json", JSON.stringify({ dependencies: { express: "^4", zod: "^3" } })],
    ]);
    const diff = computeStructuralDiff(
      [
        { path: "src/api/users.ts", status: "modified", additions: 2, deletions: 3 },
        { path: "src/services/users.ts", status: "added", additions: 3, deletions: 0 },
        { path: "package.json", status: "modified", additions: 1, deletions: 0 },
      ],
      { files: before, allPaths: new Set(before.keys()) },
      { files: after, allPaths: new Set(after.keys()) },
    );
    expect(diff.symbols.moved).toEqual([{ name: "listUsers", kind: "function", from: "src/api/users.ts", to: "src/services/users.ts" }]);
    expect(diff.symbols.added).toEqual([]);
    expect(diff.dependencies.added).toEqual([{ from: "src/api/users.ts", to: "src/services/users.ts" }]);
    expect(diff.packages.added).toEqual(["npm:zod"]);
    expect(diff.routes.added.map((r) => `${r.method} ${r.path}`)).toEqual(["DELETE /users/:id"]);
    expect(diff.directories.added).toEqual(["src/services"]);
    expect(diff.summary).toEqual({ filesChanged: 3, additions: 6, deletions: 3 });
    const text = renderStructuralDiff(diff);
    expect(text).toContain("↪ function listUsers: src/api/users.ts → src/services/users.ts");
  });

  it("reads packages from several manifests", () => {
    const pk = packagesOf(
      new Map([
        ["requirements.txt", "fastapi==0.1\n# comment\nSQLAlchemy>=2\n"],
        ["go.mod", "module x\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n)\n"],
        ["Cargo.toml", "[dependencies]\nserde = \"1\"\n\n[dev-dependencies]\ntokio = \"1\"\n"],
      ]),
    );
    expect([...pk].sort()).toEqual(["crate:serde", "go:github.com/gin-gonic/gin", "pypi:fastapi", "pypi:sqlalchemy"]);
  });
});
