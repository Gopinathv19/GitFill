import { describe, expect, it } from "vitest";
import { enclosingSymbol, extractSymbols, languageOf } from "@/lib/analysis/symbols";

describe("extractSymbols", () => {
  it("finds TypeScript functions, classes, methods and arrow functions with line ranges", () => {
    const src = [
      "import { x } from './x';",
      "export async function handler(req: Request) {",
      "  return new Response('ok');",
      "}",
      "export class UserService {",
      "  constructor(private readonly repo: Repo) {}",
      "  async findById(id: string): Promise<User | null> {",
      "    return this.repo.find(id);",
      "  }",
      "}",
      "export const parse = (input: string): number => {",
      "  return Number(input);",
      "};",
      "const Card = React.memo(function Card() { return null; });",
      "export type Props = { id: string };",
      "export interface Repo { find(id: string): Promise<User | null> }",
    ].join("\n");
    const syms = extractSymbols("src/a.ts", src);
    const byName = Object.fromEntries(syms.map((s) => [s.name, s]));
    expect(byName.handler).toMatchObject({ kind: "function", line: 2, endLine: 4, exported: true });
    expect(byName.UserService).toMatchObject({ kind: "class", line: 5, endLine: 10 });
    expect(byName.findById).toMatchObject({ kind: "method", parent: "UserService", line: 7, endLine: 9 });
    expect(byName.parse).toMatchObject({ kind: "function", exported: true });
    expect(byName.Card).toMatchObject({ kind: "function", exported: false });
    expect(byName.Props.kind).toBe("type");
    expect(byName.Repo.kind).toBe("interface");
    expect(syms.find((s) => s.name === "if")).toBeUndefined();
  });

  it("uses indentation for Python block ends and attributes methods to classes", () => {
    const src = ["class Account:", "    def __init__(self):", "        self.balance = 0", "", "    def deposit(self, n):", "        self.balance += n", "", "def helper():", "    return 1", "", "x = 2"].join("\n");
    const syms = extractSymbols("app/models.py", src);
    expect(syms.find((s) => s.name === "Account")).toMatchObject({ kind: "class", line: 1, endLine: 6 });
    expect(syms.find((s) => s.name === "deposit")).toMatchObject({ kind: "method", parent: "Account", line: 5, endLine: 6 });
    expect(syms.find((s) => s.name === "helper")).toMatchObject({ kind: "function", line: 8, endLine: 9, exported: true });
    expect(syms.find((s) => s.name === "__init__")?.exported).toBe(false);
  });

  it("handles Go receivers and exported casing", () => {
    const src = ["package main", "", "type Server struct {", "\tport int", "}", "", "func (s *Server) Start() error {", "\treturn nil", "}", "", "func helper() {}"].join("\n");
    const syms = extractSymbols("cmd/main.go", src);
    expect(syms.find((s) => s.name === "Server")).toMatchObject({ kind: "struct", exported: true });
    expect(syms.find((s) => s.name === "Start")).toMatchObject({ kind: "method", exported: true, line: 7, endLine: 9 });
    expect(syms.find((s) => s.name === "helper")).toMatchObject({ kind: "function", exported: false });
  });

  it("detects languages and the enclosing symbol of a line", () => {
    expect(languageOf("a/b.tsx")).toBe("typescript");
    expect(languageOf("x.rs")).toBe("rust");
    expect(languageOf("Makefile")).toBe("unknown");
    const syms = extractSymbols("a.ts", "export class A {\n  m() {\n    return 1;\n  }\n}\n");
    expect(enclosingSymbol(syms, 3)?.name).toBe("m");
    expect(enclosingSymbol(syms, 1)?.name).toBe("A");
    expect(enclosingSymbol(syms, 9)).toBeUndefined();
  });
});
