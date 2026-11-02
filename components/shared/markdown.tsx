"use client";

import { Component, memo, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { EVIDENCE_HREF, type EvidenceStatus } from "@/lib/client/answer-parts";
import { cn } from "@/lib/utils";

export interface EvidenceChips {
  items: Record<string, { n: number; status: EvidenceStatus }>;
  onSelect: (ref: string) => void;
}

const DETAILS = /<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;

/**
 * Renders GitFill documents: GFM Markdown (tables, footnotes for evidence) with
 * ```mermaid fences drawn by Mermaid in the browser. Raw HTML is never rendered: the two tags
 * GitFill itself emits (<details> around diagram sources, legacy <sub> footers) become components.
 * With `evidence`, `#gf-ev-<ref>` links render as status chips (see splitAnswer).
 */
export const Markdown = memo(function Markdown({ children, className, evidence }: { children: string; className?: string; evidence?: EvidenceChips }) {
  const text = children.replace(/<sub>([\s\S]*?)<\/sub>/g, (_, inner: string) => `*${inner.trim()}*`);
  const segments: Array<{ md: string; summary?: string }> = [];
  let last = 0;
  for (const m of text.matchAll(DETAILS)) {
    segments.push({ md: text.slice(last, m.index) }, { summary: m[1]!.trim(), md: m[2]!.trim() });
    last = m.index! + m[0].length;
  }
  segments.push({ md: text.slice(last) });
  return (
    <div className={cn("gf-prose", className)}>
      {segments.map((seg, i) =>
        seg.summary !== undefined ? (
          <details key={i} className="my-2 rounded-md border px-3 py-1.5 text-xs">
            <summary className="cursor-pointer select-none text-muted-foreground">{seg.summary}</summary>
            <MarkdownBlock evidence={evidence}>{seg.md}</MarkdownBlock>
          </details>
        ) : seg.md.trim() ? (
          <MarkdownBlock key={i} evidence={evidence}>{seg.md}</MarkdownBlock>
        ) : null,
      )}
    </div>
  );
});

const CHIP_TONE: Record<EvidenceStatus, string> = {
  verified: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-400",
  inferred: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-400",
  unverified: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-400",
};

function MarkdownBlock({ children, evidence }: { children: string; evidence?: EvidenceChips }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className: cls, children: code, ...props }) {
          const match = /language-(\w+)/.exec(cls ?? "");
          const text = String(code).replace(/\n$/, "");
          if (match?.[1] === "mermaid") return <DiagramBoundary chart={text}><Mermaid chart={text} /></DiagramBoundary>;
          return (
            <code className={cls} {...props}>
              {code}
            </code>
          );
        },
        a({ href, children: label, ...props }) {
          const ref = href?.startsWith(EVIDENCE_HREF) ? href.slice(EVIDENCE_HREF.length) : null;
          const chip = ref ? evidence?.items[ref] : undefined;
          if (ref && chip) {
            return (
              <button
                type="button"
                onClick={() => evidence!.onSelect(ref)}
                title={`${chip.status[0]!.toUpperCase()}${chip.status.slice(1)}: show evidence`}
                className={cn("mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded-full border px-1 align-middle text-[10px] font-semibold leading-none", CHIP_TONE[chip.status])}
              >
                {chip.n}
              </button>
            );
          }
          const external = href?.startsWith("http");
          return (
            <a href={href} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} {...props}>
              {label}
            </a>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function DiagramFallback({ chart, className, reason }: { chart: string; className?: string; reason?: string | null }) {
  return (
    <div className={cn("rounded-md border border-amber-300/60 bg-amber-50 p-3 text-xs dark:bg-amber-950/30", className)}>
      <p className="font-medium text-amber-700 dark:text-amber-400">Diagram could not be rendered.</p>
      {reason ? <p className="mt-1 text-amber-700/80 dark:text-amber-400/80">{reason}</p> : null}
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{chart}</pre>
    </div>
  );
}

/** Whatever goes wrong inside one diagram stays inside it: the rest of the answer and the page keep rendering. */
class DiagramBoundary extends Component<{ chart: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { chart: string }) {
    if (prev.chart !== this.props.chart && this.state.failed) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <DiagramFallback chart={this.props.chart} /> : this.props.children;
  }
}

/**
 * Mermaid keeps its configuration and parser state in module-level globals, so two diagrams
 * rendering at the same time corrupt each other (a page with several diagrams then shows
 * "could not be rendered" at random). Every render goes through this one-at-a-time queue.
 */
let mermaidQueue: Promise<unknown> = Promise.resolve();

function renderDiagram(id: string, chart: string, dark: boolean): Promise<string> {
  const run = mermaidQueue.then(async () => {
    const mermaid = (await import("mermaid")).default;
    // suppressErrorRendering: on a parse error Mermaid otherwise draws its "Syntax error" bomb into a
    // temporary element on <body> and leaves it there (common while an answer is still streaming).
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: dark ? "dark" : "neutral", fontFamily: "ui-sans-serif, system-ui, sans-serif" });
    try {
      // Validate first: parse() throws without touching the page.
      await mermaid.parse(sanitizeChart(chart));
      const { svg } = await mermaid.render(id, sanitizeChart(chart));
      return svg;
    } finally {
      // Mermaid renders inside a temporary #d<id> wrapper on <body>; remove it if a failed render left it behind.
      // (Never look up #<id> itself: the diagram shown on the page carries that id.)
      const leftover = document.getElementById(`d${id}`);
      if (leftover?.parentElement === document.body) leftover.remove();
    }
  });
  // The queue must keep moving even when this diagram fails.
  mermaidQueue = run.catch(() => undefined);
  return run;
}

/**
 * Characters models emit that Mermaid's lexer rejects: non-breaking and narrow spaces look like
 * spaces but are not, and zero-width marks are invisible in the source shown on failure.
 */
function sanitizeChart(chart: string): string {
  return chart
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .trim();
}

/** One Mermaid diagram. Re-renders when the theme changes; shows the source if it fails to parse. */
export function Mermaid({ chart, className }: { chart: string; className?: string }) {
  const { resolvedTheme } = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Ids must be unique per attempt: Mermaid refuses to reuse one that is still on the page.
    const renderId = `gf-${id}-${resolvedTheme ?? "light"}-${Date.now().toString(36)}`;
    renderDiagram(renderId, chart, resolvedTheme === "dark")
      .then((out) => {
        if (!alive) return;
        setSvg(out);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setSvg(null);
        setError(err instanceof Error ? err.message.split("\n")[0]! : "Diagram could not be rendered.");
      });
    return () => {
      alive = false;
    };
  }, [chart, id, resolvedTheme]);

  if (error) return <DiagramFallback chart={chart} className={className} reason={error} />;
  if (!svg) return <div className={cn("h-32 animate-pulse rounded-md bg-muted/50", className)} />;
  return <div ref={ref} className={cn("gf-mermaid overflow-x-auto rounded-md border bg-card p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full", className)} dangerouslySetInnerHTML={{ __html: svg }} />;
}
