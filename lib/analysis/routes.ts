import type { SourceFile } from "@/lib/connectors/types";

/** An HTTP route found by scanning source for framework conventions. */
export interface RouteInfo {
  method: string;
  path: string;
  file: string;
  line: number;
  framework: string;
}

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Detects routes for common web frameworks. Conservative: only explicit literal paths are reported. */
export function detectRoutes(files: SourceFile[]): RouteInfo[] {
  const out: RouteInfo[] = [];
  for (const f of files) {
    const p = f.path;
    // Next.js app router: app/**/route.ts exports HTTP method handlers.
    const nextRoute = /^(?:src\/)?app\/(.*)\/route\.(ts|js|tsx|jsx)$/.exec(p);
    if (nextRoute) {
      const route = `/${nextRoute[1]!.split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/")}`.replace(/\[\.\.\.(\w+)\]/g, ":$1*").replace(/\[(\w+)\]/g, ":$1");
      f.content.split("\n").forEach((line, i) => {
        const m = /^export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.exec(line) ?? /^export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.exec(line);
        if (m) out.push({ method: m[1]!, path: route, file: p, line: i + 1, framework: "next" });
      });
      continue;
    }
    const nextPagesApi = /^(?:src\/)?pages\/api\/(.*)\.(ts|js|tsx|jsx)$/.exec(p);
    if (nextPagesApi) {
      const route = `/api/${nextPagesApi[1]!.replace(/\/index$/, "")}`.replace(/\[\.\.\.(\w+)\]/g, ":$1*").replace(/\[(\w+)\]/g, ":$1");
      out.push({ method: "ANY", path: route, file: p, line: 1, framework: "next" });
      continue;
    }
    const lines = f.content.split("\n");
    lines.forEach((line, i) => {
      let m: RegExpExecArray | null;
      // Express, Fastify, Koa-router, Hono, itty-router…
      if ((m = /\b(?:app|router|server|fastify|hono|api|r)\.(get|post|put|patch|delete|all|options|head)\(\s*["'`]([^"'`]+)["'`]/.exec(line))) {
        out.push({ method: m[1]!.toUpperCase(), path: m[2]!, file: p, line: i + 1, framework: "node" });
      }
      // FastAPI / Flask / Sanic decorators.
      else if ((m = /^\s*@(?:app|router|api|bp|blueprint|\w+_router|\w+_bp)\.(get|post|put|patch|delete|route|api_route|websocket)\(\s*["']([^"']+)["']/.exec(line))) {
        const methods = /methods\s*=\s*\[([^\]]+)\]/.exec(line)?.[1]?.replace(/["'\s]/g, "");
        const method = m[1] === "route" || m[1] === "api_route" ? (methods ?? "GET") : m[1] === "websocket" ? "WS" : m[1]!.toUpperCase();
        out.push({ method, path: m[2]!, file: p, line: i + 1, framework: "python" });
      }
      // Django urls.py.
      else if (/urls\.py$/.test(p) && (m = /\b(?:path|re_path|url)\(\s*r?["']([^"']*)["']/.exec(line))) {
        out.push({ method: "ANY", path: `/${m[1]!.replace(/^\^/, "").replace(/\$$/, "")}`, file: p, line: i + 1, framework: "django" });
      }
      // Go: net/http, gorilla/mux, chi, gin, echo, fiber.
      else if ((m = /\.(?:HandleFunc|Handle)\(\s*"([^"]+)"/.exec(line))) {
        out.push({ method: "ANY", path: m[1]!, file: p, line: i + 1, framework: "go" });
      } else if ((m = /\b\w+\.(GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"/.exec(line)) && /\.go$/.test(p)) {
        out.push({ method: m[1]!.toUpperCase(), path: m[2]!, file: p, line: i + 1, framework: "go" });
      }
      // Spring.
      else if ((m = /@(Get|Post|Put|Delete|Patch|Request)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]+)"/.exec(line))) {
        out.push({ method: m[1] === "Request" ? "ANY" : m[1]!.toUpperCase(), path: m[2]!, file: p, line: i + 1, framework: "spring" });
      }
      // Rails routes.rb.
      else if (/routes\.rb$/.test(p) && (m = /^\s*(get|post|put|patch|delete|resources|resource|namespace)\s+["':]([\w/:_-]+)/.exec(line))) {
        out.push({ method: m[1] === "resources" || m[1] === "resource" ? "REST" : m[1] === "namespace" ? "NS" : m[1]!.toUpperCase(), path: `/${m[2]!.replace(/^\//, "")}`, file: p, line: i + 1, framework: "rails" });
      }
      // ASP.NET minimal APIs / attribute routing.
      else if ((m = /\bapp\.Map(Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"/.exec(line))) {
        out.push({ method: m[1]!.toUpperCase(), path: m[2]!, file: p, line: i + 1, framework: "aspnet" });
      } else if ((m = /\[Http(Get|Post|Put|Patch|Delete)\(\s*"([^"]+)"\)\]/.exec(line))) {
        out.push({ method: m[1]!.toUpperCase(), path: m[2]!, file: p, line: i + 1, framework: "aspnet" });
      }
    });
  }
  return out.filter((r) => r.path.length < 200).slice(0, 300);
}

export function isHttpMethod(s: string): boolean {
  return HTTP_METHODS.includes(s.toUpperCase());
}
