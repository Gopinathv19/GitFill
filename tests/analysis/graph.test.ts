import { describe, expect, it } from "vitest";
import { buildCodeGraph, findReferences, moduleGraph, packageName } from "@/lib/analysis/graph";
import type { SourceFile } from "@/lib/connectors/types";

const file = (path: string, content: string): SourceFile => ({ path, content, category: "source", sizeBytes: content.length, lineCount: content.split("\n").length });

describe("buildCodeGraph", () => {
  const files = [
    file("src/api/users.ts", "import { UserService } from '../services/user';\nimport { z } from 'zod';\nexport function route() { return new UserService().list(); }\n"),
    file("src/services/user.ts", "import { db } from '@/db';\nexport class UserService {\n  list() { return db.select(); }\n}\n"),
    file("src/db/index.ts", "import postgres from 'postgres';\nexport const db = postgres();\n"),
    file("app/main.py", "from app.services.billing import charge\nimport os\n\ndef run():\n    charge()\n"),
    file("app/services/billing.py", "def charge():\n    return 1\n"),
  ];
  const inventory = files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes, selected: true }));
  const graph = buildCodeGraph({ files, inventory });

  it("resolves relative, alias and python imports and tracks externals", () => {
    expect([...graph.dependencies.get("src/api/users.ts")!]).toEqual(["src/services/user.ts"]);
    expect([...graph.dependencies.get("src/services/user.ts")!]).toEqual(["src/db/index.ts"]);
    expect([...graph.dependencies.get("app/main.py")!]).toEqual(["app/services/billing.py"]);
    expect([...graph.dependents.get("src/services/user.ts")!]).toEqual(["src/api/users.ts"]);
    expect(graph.externalPackages.get("zod")).toBe(1);
    expect(graph.externalPackages.get("postgres")).toBe(1);
    expect(graph.externalPackages.get("os")).toBe(1);
  });

  it("indexes symbols by name and path", () => {
    expect(graph.byName.get("UserService")?.[0]?.path).toBe("src/services/user.ts");
    expect(graph.byPath.get("app/services/billing.py")?.map((s) => s.name)).toEqual(["charge"]);
  });

  it("collapses the module graph to directories when needed", () => {
    const view = moduleGraph(graph, { maxNodes: 2 });
    expect(view.nodes.length).toBeLessThanOrEqual(2);
    expect(view.collapsed).toBe(true);
    const full = moduleGraph(graph, { maxNodes: 50 });
    expect(full.edges).toContainEqual({ from: "src/api/users.ts", to: "src/services/user.ts", weight: 1 });
  });

  it("finds whole-word references only", () => {
    const refs = findReferences(files, "db");
    expect(refs.map((r) => r.path)).toEqual(expect.arrayContaining(["src/services/user.ts", "src/db/index.ts"]));
    expect(findReferences(files, "charge", { excludePath: "app/services/billing.py" }).map((r) => r.path)).toEqual(["app/main.py", "app/main.py"]);
  });

  it("normalizes package names", () => {
    expect(packageName("@scope/pkg/sub")).toBe("@scope/pkg");
    expect(packageName("lodash/fp")).toBe("lodash");
    expect(packageName("github.com/gin-gonic/gin/binding")).toBe("github.com/gin-gonic/gin");
    expect(packageName("./local")).toBeNull();
    expect(packageName("node:fs")).toBeNull();
  });
});
