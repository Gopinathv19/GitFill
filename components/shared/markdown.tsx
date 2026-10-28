"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "next-themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Renders GitFill documents: GFM Markdown (tables, footnotes for evidence) with
 * ```mermaid fences drawn by Mermaid in the browser. Raw HTML is not rendered.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("gf-prose", className)}>
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
    </div>
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
