import { deckSpecSchema, type DeckSpec } from "@/lib/presentation/spec";

/** A deck that exercises every block and figure type, for rendering tests and visual checks. */
export const sampleDeck: DeckSpec = deckSpecSchema.parse({
  project: "Memora",
  title: "Memora: grounded memory for AI apps",
  subtitle: "Architecture overview",
  audience: "Engineering team",
  purpose: "Explain how Memora stores, links and retrieves knowledge.",
  theme: "midnight",
  slides: [
    {
      id: "s1",
      layout: "cover",
      kicker: "Architecture overview",
      title: "Persistent memory that *answers only from what it stored.*",
      subtitle: "How Memora extracts facts from sources, links them in a graph, and retrieves grounded passages for any AI application.",
      tag: "main · b6357f6",
      visual: {
        type: "terminal",
        title: "memora · local setup",
        lines: [
          { text: "Start Postgres, FalkorDB and the API", kind: "comment" },
          { text: "docker compose up -d", kind: "command" },
          { text: "uv run alembic upgrade head", kind: "command" },
          { text: "INFO  Running upgrade -> 0042, add facts", kind: "output" },
          { text: "uv run uvicorn app.main:app --port 8000", kind: "command" },
          { text: "Uvicorn running on http://127.0.0.1:8000", kind: "output" },
        ],
      },
      meta: [
        { label: "Repository", value: "Gopinathv19/memora" },
        { label: "Commit", value: "b6357f6" },
        { label: "Audience", value: "Engineering team" },
      ],
    },
    { id: "s2", layout: "contents", title: "Contents", lede: "From what Memora is to how a question is answered. Each page covers one idea." },
    {
      id: "s3",
      layout: "page",
      section: "Overview",
      title: "What Memora is",
      lede: "A memory service for AI applications. Apps register sources; Memora extracts facts, links them in a knowledge graph and returns **grounded passages** for any question.",
      arrangement: "split",
      main: [
        {
          type: "cards",
          columns: 2,
          items: [
            { icon: "document", title: "Sources in, facts out", text: "Files and pages are triaged, chunked and embedded; an LLM extracts versioned facts from each chunk." },
            { icon: "graph", title: "A graph of what it knows", text: "Facts become nodes and edges in FalkorDB, so related knowledge is found even without shared words." },
            { icon: "search", title: "Hybrid retrieval", text: "Vector search, keyword search and graph expansion are fused, diversified with MMR and reranked." },
            { icon: "shield", title: "Scoped by application", text: "Every query carries an application scope; one tenant never sees another's memory." },
          ],
        },
        { type: "callout", tone: "takeaway", text: "Memora finds and ranks knowledge; the calling application decides what to say with it." },
      ],
      side: [
        {
          type: "steps",
          title: "Four steps",
          direction: "vertical",
          items: [
            { title: "Register", text: "An app registers a source with `POST /sources`." },
            { title: "Process", text: "Workers triage, chunk, embed and extract facts." },
            { title: "Link", text: "Facts are merged into the subject's graph." },
            { title: "Retrieve", text: "Questions return ranked, cited passages." },
          ],
        },
      ],
    },
    {
      id: "s4",
      layout: "page",
      section: "Architecture",
      title: "System map",
      lede: "A modular FastAPI monolith with a Next.js console. Every request enters through one API and is scope-checked before it reaches a service.",
      arrangement: "stack",
      main: [
        {
          type: "diagram",
          title: "Memora system map",
          hint: "left: callers · centre: backend · right: storage",
          figure: {
            kind: "architecture",
            lanes: [
              { id: "people", label: "Callers" },
              { id: "api", label: "Entry" },
              { id: "core", label: "Backend · FastAPI", zone: true },
              { id: "store", label: "Storage & providers" },
            ],
            nodes: [
              { id: "console", lane: "people", title: "Console", sub: "Next.js admin UI" },
              { id: "apps", lane: "people", title: "Client apps", sub: "SDK or REST" },
              { id: "router", lane: "api", title: "API routers", sub: "/v1/* · scope check", tone: "accent" },
              { id: "ingest", lane: "core", title: "Ingestion", sub: "triage · chunk · embed" },
              { id: "extract", lane: "core", title: "Extraction", sub: "versioned facts", mono: "app/extraction/" },
              { id: "retrieve", lane: "core", title: "Retrieval", sub: "hybrid · MMR · rerank" },
              { id: "pg", lane: "store", title: "PostgreSQL", sub: "pgvector · rows", tone: "external" },
              { id: "falkor", lane: "store", title: "FalkorDB", sub: "knowledge graph", tone: "external" },
              { id: "llm", lane: "store", title: "LLM providers", sub: "embed · extract", tone: "external" },
            ],
            edges: [
              { from: "console", to: "router" },
              { from: "apps", to: "router" },
              { from: "router", to: "ingest", label: "sources" },
              { from: "router", to: "retrieve", label: "queries" },
              { from: "ingest", to: "pg", label: "chunks" },
              { from: "extract", to: "falkor", label: "facts", style: "accent" },
              { from: "retrieve", to: "pg", label: "search" },
              { from: "extract", to: "llm", style: "dashed" },
            ],
          },
        },
        { type: "callout", tone: "note", label: "Simple to run", text: "Workers, schedulers and the API ship as one process; Postgres and FalkorDB are the only stateful services." },
      ],
    },
    {
      id: "s5",
      layout: "page",
      section: "Architecture",
      title: "Component responsibilities",
      lede: "What each part owns, with the technology it is built on.",
      style: "cards",
      arrangement: "stack",
      main: [
        {
          type: "components",
          columns: 3,
          items: [
            { icon: "server", name: "API", role: "Backend · Python", text: "Routers, auth, scope checks and request validation for every endpoint.", tech: "FastAPI · Pydantic" },
            { icon: "layers", name: "Ingestion", role: "Workers", text: "Triage, chunking and embedding of each registered source.", tech: "asyncio · tiktoken" },
            { icon: "spark", name: "Extraction", role: "LLM pipeline", text: "Turns chunks into versioned facts and merges duplicates.", tech: "OpenAI-compatible" },
            { icon: "graph", name: "Graph", role: "External · state", text: "Stores entities and relations for multi-hop retrieval.", tech: "FalkorDB" },
            { icon: "database", name: "Relational store", role: "External · state", text: "Sources, chunks, embeddings, applications and audit rows.", tech: "PostgreSQL · pgvector" },
            { icon: "overview", name: "Console", role: "Frontend", text: "Admin views over sources, subjects and retrieval traces.", tech: "Next.js · React" },
          ],
        },
      ],
    },
    {
      id: "s6",
      layout: "page",
      section: "How it works",
      title: "How an answer is retrieved",
      lede: "Retrieval is staged so that weak candidates are dropped before anything is returned.",
      arrangement: "split",
      main: [
        {
          type: "diagram",
          title: "Retrieval pipeline",
          hint: "app/retrieval/",
          figure: {
            kind: "flow",
            steps: [
              { title: "Normalize query", sub: "scope check, language detection" },
              { title: "Candidate search", sub: "vector + keyword in parallel", branch: { when: "cache hit", title: "Cached result", sub: "same subject version", tone: "ok" } },
              { title: "Graph expansion", sub: "neighbours of matched entities" },
              { title: "Fuse and diversify", sub: "reciprocal rank fusion, MMR" },
              { title: "Rerank", sub: "cross-encoder, top k", branch: { when: "below floor", title: "Empty result", sub: "caller shows its fallback", tone: "warn" } },
            ],
            outcomes: [
              { title: "Passages", sub: "ranked, with source ids", tone: "ok" },
              { title: "Trace", sub: "scores and timings", tone: "default" },
            ],
          },
        },
      ],
      side: [
        {
          type: "explain",
          purpose: "Return only passages that genuinely support the question.",
          behavior: "Candidates below the similarity floor are dropped before reranking.",
          value: "Callers can trust an empty result: it means nothing relevant exists.",
          limits: "Rerank adds about 120 ms per query.",
        },
        { type: "stats", items: [{ value: "5", label: "Passages returned", note: "after rerank" }, { value: "0.30", label: "Similarity floor", note: "per subject" }] },
      ],
    },
    {
      id: "s7",
      layout: "page",
      section: "How it works",
      title: "Sequence: an application asks a question",
      lede: "The services behind one retrieval call.",
      arrangement: "stack",
      main: [
        {
          type: "diagram",
          title: "A retrieval request",
          hint: "routers/retrieve.py → retrieval",
          figure: {
            kind: "sequence",
            actors: [
              { id: "app", label: "Client app", sub: "SDK" },
              { id: "api", label: "API", sub: "routers", accent: true },
              { id: "ret", label: "Retrieval", sub: "pipeline" },
              { id: "pg", label: "PostgreSQL", sub: "pgvector" },
              { id: "graph", label: "FalkorDB", sub: "graph" },
            ],
            steps: [
              { from: "app", to: "api", label: "POST /v1/retrieve" },
              { from: "api", to: "api", label: "scope check" },
              { from: "api", to: "ret", label: "retrieve(query, subject)" },
              {
                group: "Candidate search",
                steps: [
                  { from: "ret", to: "pg", label: "vector + keyword" },
                  { from: "pg", to: "ret", label: "candidates", reply: true },
                  { from: "ret", to: "graph", label: "expand entities" },
                  { from: "graph", to: "ret", label: "neighbours", reply: true },
                ],
              },
              { from: "ret", to: "ret", label: "fuse · MMR · rerank" },
              { from: "ret", to: "app", label: "passages + trace", reply: true },
            ],
          },
        },
      ],
    },
    {
      id: "s8",
      layout: "page",
      section: "How it works",
      title: "Source lifecycle and request routing",
      lede: "Each source moves through fixed states; each request passes fixed checks in order.",
      arrangement: "stack",
      main: [
        {
          type: "diagram",
          title: "Source status",
          figure: {
            kind: "states",
            states: [
              { id: "queued", title: "queued", sub: "registered" },
              { id: "processing", title: "processing", sub: "chunk · embed · extract", tone: "warn" },
              { id: "ready", title: "ready", sub: "searchable", tone: "ok" },
              { id: "failed", title: "failed", sub: "error on the row", tone: "danger" },
            ],
            transitions: [
              { from: "queued", to: "processing", label: "worker picks up" },
              { from: "processing", to: "ready", label: "all chunks done" },
              { from: "processing", to: "failed", label: "error" },
              { from: "failed", to: "queued", label: "retry" },
              { from: "ready", to: "queued", label: "re-index after edit" },
            ],
          },
        },
        {
          type: "diagram",
          title: "Request routing",
          figure: {
            kind: "decision",
            checks: [
              { question: "Valid token?", yes: { title: "Continue", sub: "application resolved" } },
              { question: "Subject in scope?", yes: { title: "Continue", sub: "scope attached" } },
              { question: "Rate limit hit?", yes: { title: "429", sub: "retry after header", tone: "warn" } },
            ],
            otherwise: { title: "Route handler", sub: "request served" },
          },
        },
      ],
    },
    {
      id: "s9",
      layout: "page",
      section: "Operations",
      title: "Capabilities and status",
      lede: "What the code at this commit implements, checked against the source.",
      arrangement: "split",
      main: [
        {
          type: "table",
          columns: ["Status", "Where"],
          rows: [
            { head: "Hybrid retrieval", cells: ["yes", "`app/retrieval/`"] },
            { head: "Versioned facts", cells: ["yes", "`app/extraction/`"] },
            { head: "Graph expansion", cells: ["yes", "`app/graph/`"] },
            { head: "Multi-tenant scopes", cells: ["yes", "`app/auth/scope.py`"] },
            { head: "Streaming answers", cells: ["no", "callers generate answers"] },
          ],
          highlightColumn: 0,
        },
        { type: "callout", tone: "limit", text: "Memora never writes answers. Generation stays in the calling application." },
      ],
      side: [
        {
          type: "code",
          title: "Retrieve from a subject",
          lines: ["curl -X POST $MEMORA/v1/retrieve \\", '  -H "Authorization: Bearer $TOKEN" \\', "  -d '{\"subject\":\"docs\",\"query\":\"refund policy\"}'"],
          caption: "Returns ranked passages with source ids and scores.",
        },
        {
          type: "list",
          title: "Run it locally",
          items: [
            { text: "`docker compose up -d` starts Postgres and FalkorDB.", status: "implemented" },
            { text: "`uv run alembic upgrade head` applies migrations.", status: "implemented" },
            { text: "Kubernetes manifests are not in the repository.", status: "unverified" },
          ],
        },
      ],
    },
    {
      id: "s10",
      layout: "page",
      section: "Reference",
      title: "Glossary and flashcards",
      arrangement: "split_even",
      main: [
        {
          type: "glossary",
          items: [
            { term: "Source", def: "A file or page registered for processing." },
            { term: "Subject", code: "subject_id", def: "Container for one application's sources." },
            { term: "Fact", def: "A versioned statement extracted from a chunk." },
            { term: "Scope", def: "The application and subjects a request may read." },
            { term: "MMR", def: "Maximal marginal relevance: diversifies results." },
            { term: "Rerank", def: "Cross-encoder rescoring of the top candidates." },
          ],
        },
      ],
      side: [
        {
          type: "flashcards",
          items: [
            { q: "Who writes answers?", a: "The calling application. Never Memora." },
            { q: "What drops weak passages?", a: "The similarity floor, before rerank." },
            { q: "Where do facts live?", a: "FalkorDB, linked by entity." },
            { q: "What isolates tenants?", a: "The application scope on every query." },
          ],
        },
      ],
    },
  ],
});
