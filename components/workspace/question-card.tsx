"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAnswers, type AskUser } from "@/lib/client/questions";
import { cn } from "@/lib/utils";

/**
 * Questions the agent wrote after scouting the code. Each takes chosen options and/or the user's own
 * words; submitting sends the answers as the next chat message. Read-only once the chat has moved on.
 */
export function QuestionCard({ ask, onAnswer }: { ask: AskUser; onAnswer?: (text: string) => void }) {
  const [answers, setAnswers] = useState(() => ask.questions.map(() => ({ chosen: [] as string[], other: "" })));
  const disabled = !onAnswer;

  const toggle = (qi: number, label: string, multiple: boolean) =>
    setAnswers((all) =>
      all.map((a, i) => {
        if (i !== qi) return a;
        const has = a.chosen.includes(label);
        return { ...a, chosen: multiple ? (has ? a.chosen.filter((c) => c !== label) : [...a.chosen, label]) : has ? [] : [label] };
      }),
    );

  return (
    <div className="w-full overflow-hidden rounded-lg border bg-muted/40 text-sm">
      <ol className="divide-y">
        {ask.questions.map((q, qi) => (
          <li key={qi} className="space-y-2 px-3.5 py-3">
            <div>
              <p className="font-medium">{q.question}</p>
              {q.why ? <p className="mt-0.5 text-xs text-muted-foreground">{q.why}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              {q.options.map((o) => {
                const on = answers[qi]!.chosen.includes(o.label);
                return (
                  <button
                    key={o.label}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    onClick={() => toggle(qi, o.label, q.multiple)}
                    className={cn(
                      "flex items-start gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left transition-colors enabled:hover:bg-accent disabled:opacity-70",
                      on && "border-primary/60 bg-primary/5",
                    )}
                  >
                    <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center border", q.multiple ? "rounded" : "rounded-full", on && "border-primary bg-primary text-primary-foreground")}>
                      {on ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px]">{o.label}</span>
                      {o.detail ? <span className="block text-xs text-muted-foreground">{o.detail}</span> : null}
                    </span>
                  </button>
                );
              })}
              <input
                type="text"
                disabled={disabled}
                value={answers[qi]!.other}
                onChange={(e) => setAnswers((all) => all.map((a, i) => (i === qi ? { ...a, other: e.target.value } : a)))}
                placeholder="Or in your own words…"
                aria-label={`Your own answer to: ${q.question}`}
                className="rounded-md border bg-background px-2.5 py-1.5 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-70"
              />
            </div>
          </li>
        ))}
      </ol>
      {onAnswer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-background/60 px-3.5 py-2.5">
          <Button size="sm" variant="ghost" onClick={() => onAnswer("No preferences. Use your judgment and go ahead.")}>
            Use your judgment
          </Button>
          <Button size="sm" onClick={() => onAnswer(formatAnswers(ask, answers))}>
            Send answers
          </Button>
        </div>
      ) : null}
    </div>
  );
}
