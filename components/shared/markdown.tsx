"use client";

import { useEffect, useId, useRef, useState } from "react";
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
export function Markdown({ children, className, evidence }: { children: string; className?: string; evidence?: EvidenceChips }) {
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
}

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
          if (match?.[1] === "mermaid") return <Mermaid chart={text} />;
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

/** One Mermaid diagram. Re-renders when the theme changes; shows the source if it fails to parse. */
export function Mermaid({ chart, className }: { chart: string; className?: string }) {
  const { resolvedTheme } = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: resolvedTheme === "dark" ? "dark" : "neutral", fontFamily: "ui-sans-serif, system-ui, sans-serif" });
        const { svg: out } = await mermaid.render(`gf-${id}-${resolvedTheme ?? "light"}`, chart);
        if (alive) {
          setSvg(out);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Diagram could not be rendered.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [chart, id, resolvedTheme]);

  if (error) {
    return (
      <div className={cn("rounded-md border border-amber-300/60 bg-amber-50 p-3 text-xs dark:bg-amber-950/30", className)}>
        <p className="font-medium text-amber-700 dark:text-amber-400">Diagram could not be rendered.</p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{chart}</pre>
      </div>
    );
  }
  if (!svg) return <div className={cn("h-32 animate-pulse rounded-md bg-muted/50", className)} />;
  return <div ref={ref} className={cn("gf-mermaid overflow-x-auto rounded-md border bg-card p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full", className)} dangerouslySetInnerHTML={{ __html: svg }} />;
}
