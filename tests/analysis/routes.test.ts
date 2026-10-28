import { describe, expect, it } from "vitest";
import { detectRoutes } from "@/lib/analysis/routes";
import type { SourceFile } from "@/lib/connectors/types";

const file = (path: string, content: string): SourceFile => ({ path, content, category: "api", sizeBytes: content.length, lineCount: content.split("\n").length });

describe("detectRoutes", () => {
  it("detects Express, FastAPI, Next.js, Go and Spring routes", () => {
    const routes = detectRoutes([
      file("server.js", "app.get('/users', list);\nrouter.post(\"/users/:id\", update);\n"),
      file("api/main.py", "@app.get('/items')\ndef items(): ...\n@router.post(\"/items/{id}\")\nasync def create(): ...\n"),
      file("app/api/jobs/[id]/route.ts", "export async function GET() {}\nexport const DELETE = handler;\n"),
      file("cmd/server.go", 'r.GET("/health", health)\nhttp.HandleFunc("/metrics", metrics)\n'),
      file("src/Ctl.java", '@GetMapping("/api/orders")\npublic List<Order> orders() {}\n'),
    ]);
    const keys = routes.map((r) => `${r.method} ${r.path}`);
    expect(keys).toEqual(expect.arrayContaining(["GET /users", "POST /users/:id", "GET /items", "POST /items/{id}", "GET /api/jobs/:id", "DELETE /api/jobs/:id", "GET /health", "ANY /metrics", "GET /api/orders"]));
    expect(routes.find((r) => r.path === "/api/jobs/:id")?.framework).toBe("next");
  });
});
