"use client";

import { useMemo, useRef, useState } from "react";
import { CircleCheck, CircleHelp, CircleX, FileCode2, MessageSquareText, ShieldCheck } from "lucide-react";
import { Markdown } from "@/components/shared/markdown";
import { splitAnswer, type EvidenceItem, type EvidenceStatus } from "@/lib/client/answer-parts";
import { cn } from "@/lib/utils";

const STATUS: Record<EvidenceStatus, { label: string; icon: typeof CircleCheck; tone: string }> = {
  verified: { label: "Verified", icon: CircleCheck, tone: "text-emerald-600 dark:text-emerald-400" },
  inferred: { label: "Inferred", icon: CircleHelp, tone: "text-amber-600 dark:text-amber-400" },
  unverified: { label: "Unverified", icon: CircleX, tone: "text-rose-600 dark:text-rose-400" },
};

/**
 * An agent reply. Answers with evidence get two tabs: the answer (citations as numbered status
 * chips) and the evidence list, so the footnotes don't bury the answer. Plain replies render as-is.
 */
export function AssistantMessage({ content, onAsk }: { content: string; onAsk?: (question: string) => void }) {
  const parts = useMemo(() => splitAnswer(content), [content]);
  const [tab, setTab] = useState<"answer" | "evidence">("answer");
  const [focused, setFocused] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const counts = useMemo(() => {
    const c = { verified: 0, inferred: 0, unverified: 0 };
    for (const e of parts.evidence) c[e.status]++;
    return c;
  }, [parts.evidence]);

  const chips = useMemo(
    () => ({
      items: Object.fromEntries(parts.evidence.map((e) => [e.ref, { n: e.n, status: e.status }])),
      onSelect: (ref: string) => {
        setTab("evidence");
        setFocused(ref);
        requestAnimationFrame(() => list.current?.querySelector(`[data-ref="${ref}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
      },
    }),
    [parts.evidence],
  );

  const followUps = parts.followUps.length > 0 && onAsk && (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-3">
      {parts.followUps.map((q) => (
        <button key={q} onClick={() => onAsk(q)} className="rounded-full border bg-background px-2.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
          {q.replace(/`/g, "")}
        </button>
      ))}
    </div>
  );

  if (!parts.evidence.length) {
    return (
      <div className="rounded-lg bg-muted px-3.5 py-2 text-sm">
        <Markdown className="text-sm">{parts.followUps.length && onAsk ? parts.body : content}</Markdown>
        {followUps}
      </div>
    );
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border bg-muted/40 text-sm">
      <div role="tablist" aria-label="Answer views" className="flex items-center gap-1 border-b bg-background/60 px-2">
        <TabButton active={tab === "answer"} onClick={() => setTab("answer")} icon={MessageSquareText}>
          Answer
        </TabButton>
        <TabButton active={tab === "evidence"} onClick={() => setTab("evidence")} icon={ShieldCheck}>
          Evidence
          <span className="ml-1.5 inline-flex items-center gap-1 text-[11px] font-normal">
            <span className={STATUS.verified.tone}>{counts.verified}</span>
            {counts.inferred > 0 && <span className={STATUS.inferred.tone}>· {counts.inferred}</span>}
            {counts.unverified > 0 && <span className={STATUS.unverified.tone}>· {counts.unverified}</span>}
            <span className="text-muted-foreground">/ {parts.evidence.length}</span>
          </span>
        </TabButton>
      </div>

      {tab === "answer" ? (
        <div role="tabpanel" className="px-3.5 py-3">
          <Markdown className="text-sm" evidence={chips}>{parts.body}</Markdown>
          {followUps}
        </div>
      ) : (
        <div role="tabpanel" className="space-y-3 px-3.5 py-3">
          {parts.footer && <Markdown className="text-xs text-muted-foreground">{parts.footer}</Markdown>}
          <div className="flex flex-wrap gap-3 text-xs">
            {(Object.keys(STATUS) as EvidenceStatus[]).map((s) => {
              const { label, icon: Icon, tone } = STATUS[s];
              return (
                <span key={s} className={cn("inline-flex items-center gap-1", tone)}>
                  <Icon className="size-3.5" />
                  {counts[s]} {label.toLowerCase()}
                </span>
              );
            })}
          </div>
          <ol ref={list} className="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
            {parts.evidence.map((e) => (
              <EvidenceRow key={e.ref} item={e} focused={e.ref === focused} />
            ))}
          </ol>
          {parts.sources && (
            <div className="border-t pt-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <FileCode2 className="size-3.5" />
                Key files
              </p>
              <Markdown className="text-xs">{parts.sources}</Markdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceRow({ item, focused }: { item: EvidenceItem; focused: boolean }) {
  const { label, icon: Icon, tone } = STATUS[item.status];
  return (
    <li data-ref={item.ref} className={cn("flex gap-2.5 rounded-md px-2 py-1.5 transition-colors", focused ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-background")}>
      <span className="w-5 shrink-0 pt-0.5 text-right text-[11px] tabular-nums text-muted-foreground">{item.n}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className={cn("inline-flex items-center gap-1 font-medium", tone)}>
            <Icon className="size-3.5" />
            {label}
          </span>
          {item.location &&
            (item.href ? (
              <a href={item.href} target="_blank" rel="noreferrer" className="truncate font-mono text-[11px] text-primary hover:underline">
                {item.location}
              </a>
            ) : (
              <span className="truncate font-mono text-[11px] text-muted-foreground">{item.location}</span>
            ))}
        </div>
        <Markdown className="mt-0.5 text-xs text-foreground/90">{item.claim}</Markdown>
      </div>
    </li>
  );
}

function TabButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof CircleCheck; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs font-medium transition-colors", active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}
