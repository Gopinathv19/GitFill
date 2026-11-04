import { describe, expect, it } from "vitest";
import type { SourceFile } from "@/lib/connectors/types";
import { runFacts } from "@/lib/presentation/facts/run";

function file(path: string, content: string): SourceFile {
  return { path, category: "manifest", sizeBytes: content.length, content, lineCount: content.split("\n").length };
}

const lines = (text: string) => text.split("\n");

describe("runFacts", () => {
  it("returns an empty string when nothing says how to run the project", () => {
    expect(runFacts([])).toBe("");
    expect(runFacts([file("src/index.ts", "export const x = 1;"), file("package.json", '{"name": "bare"}')])).toBe("");
  });

  it("orders package.json scripts dev, start, build, test, lint, db, worker, then the rest, using pnpm when declared", () => {
    const pkg = {
      name: "gitfill",
      packageManager: "pnpm@9.12.0+sha512.abcdef",
      engines: { node: ">=20" },
      scripts: {
        typecheck: "tsc --noEmit",
        "lint:fix": "eslint . --fix",
        worker: "tsx worker.ts",
        "db:migrate": "drizzle-kit migrate",
        lint: "eslint .",
        test: "vitest run",
        build: "next build",
        "dev:debug": "NODE_OPTIONS=--inspect next dev",
        start: "next start",
        dev: "next dev --turbopack",
        empty: "",
      },
    };
    const out = runFacts([file("package.json", JSON.stringify(pkg))]);
    expect(out).toContain('- package.json: package "gitfill", package manager pnpm 9.12.0, Node >=20');
    expect(out).not.toContain("sha512");
    expect(out).toContain("- pnpm run dev → next dev --turbopack (package.json)");
    const scripts = lines(out)
      .filter((l) => l.startsWith("- pnpm run "))
      .map((l) => l.split(" ")[3]);
    expect(scripts).toEqual(["dev", "dev:debug", "start", "build", "test", "lint", "lint:fix", "db:migrate", "worker", "typecheck"]);
    expect(lines(out).some((l) => l.startsWith("- npm run"))).toBe(false);
    expect(out).not.toContain("empty");
  });

  it("uses npm run without a packageManager field and caps long script lists", () => {
    const scripts = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`task${i}`, `node task${i}.js`]));
    const out = runFacts([file("package.json", JSON.stringify({ scripts }))]);
    expect(out).toContain("- npm run task0 → node task0.js (package.json)");
    expect(lines(out).filter((l) => l.startsWith("- npm run "))).toHaveLength(12);
    expect(out).toContain("- …and 8 more scripts in package.json");
  });

  it("reads nested package.json files, root first, inheriting the root's package manager", () => {
    const out = runFacts([
      file("web/package.json", JSON.stringify({ name: "web", scripts: { dev: "vite", build: "vite build" } })),
      file("package.json", JSON.stringify({ name: "mono", packageManager: "yarn@4.1.0", workspaces: ["web", "api"], scripts: { dev: "turbo dev" } })),
    ]);
    expect(out).toContain('- package.json: package "mono", package manager yarn 4.1.0, workspaces web, api');
    expect(out).toContain('- web/package.json: package "web", package manager yarn 4.1.0 (packageManager in package.json)');
    expect(out).toContain("- yarn run dev → vite (web/package.json)");
    expect(out.indexOf("turbo dev")).toBeLessThan(out.indexOf("(web/package.json)"));
  });

  it("lists package.json bin commands", () => {
    const out = runFacts([file("package.json", JSON.stringify({ name: "@acme/cli", bin: "./dist/cli.js" }))]);
    expect(out).toContain('- command cli → ./dist/cli.js (package.json "bin")');
  });

  it("skips a malformed package.json and keeps the rest", () => {
    const out = runFacts([
      file("package.json", '{ "name": "broken", "scripts": { "dev": "next dev", } '),
      file("api/package.json", JSON.stringify({ scripts: { start: "node server.js" } })),
      file("tools/package.json", "[1, 2, 3]"),
    ]);
    expect(out).not.toContain("broken");
    expect(out).not.toContain("next dev");
    expect(out).toContain("- npm run start → node server.js (api/package.json)");
  });

  it("reads pyproject.toml project, Python version and scripts, ignoring multi-line arrays", () => {
    const pyproject = [
      "[project]",
      'name = "ragkit"',
      'requires-python = ">=3.10"',
      "dependencies = [",
      '  "fastapi>=0.110",',
      '  "name = not-a-key",',
      "]",
      "",
      "[project.scripts]",
      'ragkit = "ragkit.cli:main"  # the CLI',
      "",
      "[tool.poetry.scripts]",
      'serve = "ragkit.server:run"',
      "",
      "[tool.uv]",
      "dev-dependencies = []",
    ].join("\n");
    const out = runFacts([
      file("pyproject.toml", pyproject),
      file("requirements.txt", "# pinned\nfastapi==0.110\nuvicorn[standard]\n-r base.txt\n"),
      file("manage.py", "import os\nos.environ.setdefault('DJANGO_SETTINGS_MODULE', 'site.settings')\nfrom django.core.management import execute_from_command_line\n"),
      file("Procfile", "web: gunicorn ragkit.wsgi --bind 0.0.0.0:$PORT\nworker: celery -A ragkit worker\n"),
    ]);
    expect(out).toContain('- pyproject.toml: project "ragkit", Python >=3.10, uses poetry ([tool.poetry])');
    expect(out).toContain("- ragkit → ragkit.cli:main (console script, pyproject.toml [project.scripts])");
    expect(out).toContain("- poetry run serve → ragkit.server:run (pyproject.toml [tool.poetry.scripts])");
    expect(out).toContain("- pip install -r requirements.txt (requirements.txt, 2 packages)");
    expect(out).toContain("- python manage.py runserver (Django, manage.py)");
    expect(out).toContain("- gunicorn ragkit.wsgi --bind 0.0.0.0:$PORT (Procfile, web process)");
    expect(out).toContain("- celery -A ragkit worker (Procfile, worker process)");
    expect(out).toContain("Procfile process types:\n- web: gunicorn ragkit.wsgi --bind 0.0.0.0:$PORT (Procfile)");
    expect(out).not.toContain("not-a-key");
  });

  it("lists Makefile targets with a recipe preview, skipping special targets, pattern rules and variables", () => {
    const makefile = [
      ".PHONY: dev test build",
      "APP := gitfill",
      "PORT ?= 3000",
      "export NODE_ENV = development",
      "",
      "dev: ## Start the dev server",
      "\t@npm run dev",
      "",
      "test:",
      "\t# comments are skipped",
      "\tnpx vitest run",
      "",
      "build: deps",
      "\tdocker build -t $(APP) . \\",
      "\t  --pull",
      "",
      "all: build test",
      "",
      "%.o: %.c",
      "\tcc -c $<",
      "",
      "$(APP)-image:",
      "\tdocker build .",
      "",
      "ci: CFLAGS += -O2",
      "clean: ; rm -rf .next",
    ].join("\n");
    const out = runFacts([file("Makefile", makefile)]);
    expect(out).toContain('- make dev → npm run dev (Makefile; "Start the dev server")');
    expect(out).toContain("- make test → npx vitest run (Makefile)");
    expect(out).toContain("- make build → docker build -t $(APP) . … (Makefile)");
    expect(out).toContain("- make all → runs targets: build test (Makefile)");
    expect(out).toContain("- make clean → rm -rf .next (Makefile)");
    const targets = lines(out).filter((l) => l.startsWith("- make ")).map((l) => l.split(" ")[2]);
    expect(targets).toEqual(["dev", "test", "build", "all", "clean"]);
  });

  it("caps Makefile targets at 12", () => {
    const makefile = Array.from({ length: 15 }, (_, i) => `t${i}:\n\techo ${i}`).join("\n");
    const out = runFacts([file("Makefile", makefile)]);
    expect(lines(out).filter((l) => l.startsWith("- make "))).toHaveLength(12);
    expect(out).toContain("- …and 3 more targets in Makefile");
  });

  it("reads Dockerfile base images, EXPOSE and the final stage's CMD", () => {
    const dockerfile = [
      "# syntax=docker/dockerfile:1",
      "FROM --platform=$BUILDPLATFORM node:20-alpine AS deps",
      "RUN npm ci",
      'CMD ["echo", "builder only"]',
      "",
      "FROM deps AS build",
      "RUN npm run build",
      "",
      "FROM node:20-slim AS runner",
      "EXPOSE 3000 9229",
      'CMD ["node", \\',
      '     "server.js"]',
    ].join("\n");
    const out = runFacts([file("Dockerfile", dockerfile)]);
    expect(out).toContain('- Dockerfile: FROM node:20-alpine, node:20-slim (3 stages); EXPOSE 3000 9229; CMD ["node", "server.js"]');
    expect(out).not.toContain("builder only");
  });

  it("inherits CMD and EXPOSE from the stage the final image is built FROM", () => {
    const dockerfile = ["FROM python:3.12 AS base", "EXPOSE 8000", 'CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0"]', "FROM base"].join("\n");
    const out = runFacts([file("api/Dockerfile", dockerfile)]);
    expect(out).toContain('- api/Dockerfile: FROM python:3.12 (2 stages); EXPOSE 8000; CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0"]');
    expect(out).toContain("- uvicorn app.main:app --host 0.0.0.0 (api/Dockerfile CMD)");
  });

  it("reads compose services with image or build and their ports, tolerating odd formatting", () => {
    const compose = [
      "version: '3.9'",
      "",
      "x-defaults: &defaults",
      "  restart: unless-stopped",
      "",
      "services:",
      "    web:   # the app",
      "        build: .",
      "        ports:",
      '            - "3000:3000"',
      "            - 9229",
      "        command: [\"npm\", \"run\", \"dev\"]",
      "    db:",
      "        image: \"postgres:16\"",
      "        ports: ['127.0.0.1:5432:5432']",
      "        environment:",
      "            POSTGRES_PASSWORD: hunter2",
      "    proxy:",
      "        image: nginx:1.27",
      "        ports:",
      "            - target: 80",
      "              published: 8080",
      "              protocol: tcp",
      "            - target: 443",
      "    api:",
      "        build:",
      "            context: ./api",
      "            dockerfile: Dockerfile",
      "        command: uvicorn app:app --reload",
      "",
      "volumes:",
      "  pgdata:",
    ].join("\n");
    const out = runFacts([file("docker-compose.yml", compose)]);
    expect(out).toContain("- docker compose up (docker-compose.yml defines 4 services)");
    expect(out).toContain("- service web: build ., ports 3000:3000, 9229, command npm run dev (docker-compose.yml)");
    expect(out).toContain("- service db: image postgres:16, ports 127.0.0.1:5432:5432 (docker-compose.yml)");
    expect(out).toContain("- service proxy: image nginx:1.27, ports 8080:80, 443 (docker-compose.yml)");
    expect(out).toContain("- service api: build ./api, command uvicorn app:app --reload (docker-compose.yml)");
    expect(out).toContain("- uvicorn app:app --reload (docker-compose.yml, service api)");
    expect(out).not.toContain("pgdata");
    expect(out).not.toContain("hunter2");
  });

  it("resolves YAML merge keys from a shared x- anchor, letting the service's own keys win", () => {
    const compose = [
      "name: app",
      "x-app: &app",
      "  build:",
      "    context: ..",
      "  image: app:latest",
      "  command: [\"npm\", \"start\"]",
      "services:",
      "  web:",
      "    <<: *app",
      "    ports:",
      '      - "127.0.0.1:${PORT:-3100}:8080"',
      "  worker:",
      "    <<: *app",
      "    command: npm run worker",
      "  db:",
      "    image: postgres:16",
    ].join("\n");
    const out = runFacts([file("deploy/docker-compose.yml", compose)]);
    expect(out).toContain("- docker compose up (deploy/docker-compose.yml defines 3 services)");
    expect(out).toContain("- service web: image app:latest, build .., ports 127.0.0.1:${PORT:-3100}:8080, command npm start (deploy/docker-compose.yml)");
    expect(out).toContain("- service worker: image app:latest, build .., command npm run worker (deploy/docker-compose.yml)");
    expect(out).toContain("- service db: image postgres:16 (deploy/docker-compose.yml)");
    expect(out).not.toContain("service x-app");
  });

  it("reads legacy compose files without a services key and names non-default files with -f", () => {
    const compose = ["version: '2'", "redis:", "  image: redis:7", "  ports:", "    - 6379:6379", "volumes:", "  data: {}"].join("\n");
    const out = runFacts([file("compose.dev.yaml", compose)]);
    expect(out).toContain("- docker compose -f compose.dev.yaml up (compose.dev.yaml defines 1 service)");
    expect(out).toContain("- service redis: image redis:7, ports 6379:6379 (compose.dev.yaml)");
  });

  it("reads go.mod, main packages and Cargo.toml", () => {
    const out = runFacts([
      file("go.mod", "module github.com/acme/api\n\ngo 1.22\n\nrequire github.com/go-chi/chi/v5 v5.0.12\n"),
      file("cmd/api/main.go", "package main\n\nfunc main() {}\n"),
      file("internal/x/x.go", "package x\n"),
      file("tools/Cargo.toml", '[package]\nname = "fmtx"\nedition = "2021"\n\n[[bin]]\nname = "fmtx-cli"\npath = "src/cli.rs"\n'),
    ]);
    expect(out).toContain("- go.mod: module github.com/acme/api, go 1.22");
    expect(out).toContain("- go run ./cmd/api (go.mod; package main in cmd/api/main.go)");
    expect(out).toContain('- tools/Cargo.toml: crate "fmtx", edition 2021');
    expect(out).toContain("- cargo run --bin fmtx-cli (tools/Cargo.toml [[bin]])");
  });

  it("lists .env.example variable names and never their values", () => {
    const secret = "sk-live-9f8e7d6c5b4a3210ffeeddccbbaa";
    const env = [
      "# Database",
      "DATABASE_URL=postgres://admin:s3cretPa55@db.internal:5432/app",
      `MODEL_API_KEY=${secret}`,
      'export REDIS_URL="redis://localhost:6379"',
      "# OPTIONAL_FLAG=1",
      "DATABASE_URL=dup",
      "not a variable line",
    ].join("\n");
    const out = runFacts([file(".env.example", env), file("web/.env.sample", "NEXT_PUBLIC_URL=http://localhost:3000\n")]);
    expect(out).toContain(
      "Environment variables the app reads (names from .env.example, web/.env.sample): DATABASE_URL, MODEL_API_KEY, REDIS_URL, NEXT_PUBLIC_URL",
    );
    expect(out).not.toContain(secret);
    expect(out).not.toContain("s3cretPa55");
    expect(out).not.toContain("localhost");
    expect(out).not.toContain("OPTIONAL_FLAG");
  });

  it("caps environment variable names at 30", () => {
    const env = Array.from({ length: 35 }, (_, i) => `VAR_${i}=value${i}`).join("\n");
    const out = runFacts([file(".env.example", env)]);
    expect(out).toContain("VAR_29, …and 5 more");
    expect(out).not.toContain("VAR_30");
    expect(out).not.toContain("value");
  });

  it("terminates on odd paths with a leading or doubled slash", () => {
    const out = runFacts([
      file("/package.json", JSON.stringify({ scripts: { dev: "vite" } })),
      file("a//b/package.json", JSON.stringify({ scripts: { start: "node b.js" } })),
    ]);
    expect(out).toContain("- npm run dev → vite (/package.json)");
    expect(out).toContain("- npm run start → node b.js (a//b/package.json)");
  });

  it("reads compose port items written at the same indent as the ports key", () => {
    const compose = ["services:", "  web:", "    image: app", "    ports:", '    - "3000:3000"', "    - 9229", "    command: npm start"].join("\n");
    const out = runFacts([file("docker-compose.yml", compose)]);
    expect(out).toContain("- service web: image app, ports 3000:3000, 9229, command npm start (docker-compose.yml)");
  });

  it("does not read Dockerfile heredoc bodies as instructions", () => {
    const dockerfile = ["FROM python:3.12", "RUN python3 <<EOF", "from pathlib import Path", "print(Path.cwd())", "EOF", "EXPOSE 8000", 'CMD ["uvicorn", "a:b"]'].join("\n");
    const out = runFacts([file("Dockerfile", dockerfile)]);
    expect(out).toContain('- Dockerfile: FROM python:3.12; EXPOSE 8000; CMD ["uvicorn", "a:b"]');
    expect(out).not.toContain("pathlib");
  });

  it("skips Go generator scripts marked //go:build ignore", () => {
    const out = runFacts([
      file("go.mod", "module x\n\ngo 1.22\n"),
      file("gen.go", "//go:build ignore\n\npackage main\n\nfunc main() {}\n"),
      file("x.go", "package x\n"),
    ]);
    expect(out).not.toContain("go run .");
  });

  it("never reads lines of a multi-line env value, such as a pasted private key, as names", () => {
    const body = "MIIEowIBAAKCAQEAx4abcDEFghiJKLmnoPQRstuVWXyz0123456789abcdefABCD";
    const env = [
      `PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----`, // gitleaks:allow (fake test fixture)
      `${body}=`,
      `-----END RSA PRIVATE KEY-----"`,
      "RAW_KEY=-----BEGIN PRIVATE KEY-----",
      `${body.split("").reverse().join("")}=`,
      "-----END PRIVATE KEY-----",
      `${body.slice(0, 30)}=x`,
      "NEXT=1",
    ].join("\n");
    const out = runFacts([file(".env.example", env)]);
    expect(out).toContain("(names from .env.example): PRIVATE_KEY, RAW_KEY, NEXT");
    expect(out).not.toContain("MIIE");
    expect(out).not.toContain("DCBA");
  });

  it("masks credentials inlined in quoted commands", () => {
    const scripts = {
      seed: "DATABASE_URL=postgres://admin:Sup3rS3cretPw@prod.db/app node seed.js",
      deploy: "STRIPE_KEY=sk_live_abcdef1234567890XYZ vercel", // gitleaks:allow (fake test fixture)
    };
    const out = runFacts([file("package.json", JSON.stringify({ scripts }))]);
    expect(out).toContain("- npm run seed → DATABASE_URL=postgres://admin:");
    expect(out).toContain("node seed.js (package.json)");
    expect(out).not.toContain("Sup3rS3cretPw");
    expect(out).not.toContain("abcdef1234567890XYZ");
  });

  it("never throws on garbage in any recognised file, and stays bounded", () => {
    const garbage = '\u0000{[ "unterminated \\ \n\t:::\n- - -\n[[[\nFROM\nservices:\n  : :\n"""\n= = =\n';
    const paths = ["package.json", "pyproject.toml", "Makefile", "Dockerfile", "docker-compose.yml", "go.mod", "Cargo.toml", "Procfile", ".env.example", "requirements.txt"];
    expect(() => runFacts(paths.map((p) => file(p, garbage)))).not.toThrow();
    const scripts = Object.fromEntries(Array.from({ length: 30 }, (_, j) => [`s${j}`, "x".repeat(300)]));
    const huge = [
      ...Array.from({ length: 40 }, (_, i) => file(`pkg${i}/package.json`, JSON.stringify({ scripts }))),
      file("Dockerfile", "FROM node:20\nEXPOSE 3000\nCMD npm start"),
      file(".env.example", "DATABASE_URL=x"),
    ];
    const out = runFacts(huge);
    expect(out.length).toBeLessThanOrEqual(12_100);
    expect(out).toContain("Node.js packages (package.json; scripts quoted verbatim; first 6 of 40 package.json files):");
    expect(out).toMatch(/- …and \d+ more lines left out/);
    expect(out).toContain("x".repeat(100) + "…");
    expect(out).not.toContain("x".repeat(141));
    // A busy Node section never crowds out the facts after it.
    expect(out).toContain("- Dockerfile: FROM node:20; EXPOSE 3000; CMD npm start");
    expect(out).toContain("Environment variables the app reads (names from .env.example): DATABASE_URL");
  });
});
