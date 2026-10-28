import type { DeckSpec } from "@/lib/presentation/spec";

/** A small valid deck used by the render/check scripts and tests. */
export const sampleDeck: DeckSpec = {
  title: "Hono: a small, fast web framework",
  subtitle: "Architecture overview",
  audience: "Engineering team",
  purpose: "Explain the architecture, routing and middleware model.",
  theme: "midnight",
  slides: [
    { id: "s1", layout: "title", title: "Hono", subtitle: "Ultrafast web framework for the edge", meta: "honojs/hono · main · bac5c4a", notes: "", claimRefs: [] },
    { id: "s2", layout: "section", title: "Architecture", subtitle: "Routers, context and middleware", notes: "", claimRefs: [] },
    {
      id: "s3",
      layout: "bullets",
      title: "What it is",
      keyMessage: "One codebase, every runtime",
      bullets: [
        { text: "Runs on Cloudflare Workers, Deno, Bun and Node.js", claimRefs: [] },
        { text: "Routing based on the Web Standards Request and Response", claimRefs: [] },
        { text: "Middleware composed with a tiny onion model", claimRefs: [] },
      ],
      notes: "",
      claimRefs: [],
    },
    {
      id: "s4",
      layout: "architecture",
      title: "Request path",
      nodes: [
        { id: "client", label: "Client", tier: 0 },
        { id: "router", label: "Router", detail: "RegExpRouter / TrieRouter", tier: 1 },
        { id: "mw", label: "Middleware", tier: 2 },
        { id: "handler", label: "Handler", tier: 3 },
      ],
      edges: [
        { from: "client", to: "router", label: "fetch" },
        { from: "router", to: "mw" },
        { from: "mw", to: "handler" },
      ],
      caption: "A request is matched, passed through middleware, then handled.",
      notes: "",
      claimRefs: [],
    },
    {
      id: "s5",
      layout: "flow",
      title: "Middleware model",
      steps: [
        { label: "Match route", claimRefs: [] },
        { label: "Run middleware", detail: "await next()", claimRefs: [] },
        { label: "Handler", claimRefs: [] },
        { label: "Response", claimRefs: [] },
      ],
      notes: "",
      claimRefs: [],
    },
    {
      id: "s6",
      layout: "stack",
      title: "Technology",
      groups: [
        { category: "Language", items: [{ name: "TypeScript", claimRefs: [] }] },
        { category: "Tooling", items: [{ name: "Vitest", note: "tests", claimRefs: [] }, { name: "tsup", claimRefs: [] }] },
      ],
      notes: "",
      claimRefs: [],
    },
    { id: "s7", layout: "closing", title: "Thanks", bullets: [{ text: "github.com/honojs/hono", claimRefs: [] }], notes: "", claimRefs: [] },
  ],
};
