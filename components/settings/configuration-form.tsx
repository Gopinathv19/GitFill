"use client";

import { useEffect, useState } from "react";
import { Brain, Check, Loader2, MessageSquareText, Plus, Presentation, Repeat, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select as ThemedSelect } from "@/components/ui/select";
import { api, errorMessage } from "@/lib/client/api";
import { DECK_TYPE_DEFS, DECK_TYPES, type DeckType } from "@/lib/presentation/deck-types";
import { TEMPLATE_IDS, TEMPLATES, type TemplateId } from "@/lib/presentation/themes";
import type { Preferences } from "@/lib/preferences/schema";
import { cn, timeAgo } from "@/lib/utils";

/**
 * The Configuration page: how GitFill's agent loop behaves for this user — reply style, how many
 * questions it asks before starting work, presentation defaults and its memory of the user. Saved
 * to /api/preferences and read by the chat agent on every turn.
 */
export function ConfigurationForm() {
  const [saved, setSaved] = useState<Preferences | null>(null);
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    api<Preferences>("/api/preferences").then(
      (p) => {
        setSaved(p);
        setDraft(p);
      },
      (e) => setError(errorMessage(e, "Could not load your configuration.")),
    );
  }, []);

  if (!draft) {
    return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading configuration…</p>;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof Preferences>(section: K, patch: Partial<Preferences[K]>) => {
    setState("idle");
    setDraft((d) => (d ? { ...d, [section]: { ...d[section], ...patch } } : d));
  };

  const save = async (next: Preferences = draft) => {
    setState("saving");
    setError(null);
    try {
      const p = await api<Preferences>("/api/preferences", { method: "PUT", body: JSON.stringify(next) });
      setSaved(p);
      setDraft(p);
      setState("saved");
    } catch (e) {
      setError(errorMessage(e, "Could not save."));
      setState("idle");
    }
  };

  const addNote = () => {
    const text = note.trim();
    if (text.length < 2) return;
    set("memory", { notes: [...draft.memory.notes, { id: Math.random().toString(36).slice(2, 10), text: text.slice(0, 300), createdAt: new Date().toISOString() }].slice(-50) });
    setNote("");
  };

  return (
    <div className="space-y-4">
      <Section icon={MessageSquareText} title="Replies" description="How GitFill writes to you in chat.">
        <Row label="Tone">
          <Segmented value={draft.reply.tone} onChange={(tone) => set("reply", { tone })} options={[["concise", "Concise"], ["friendly", "Friendly"], ["formal", "Formal"], ["technical", "Technical"]]} />
        </Row>
        <Row label="Length">
          <Segmented value={draft.reply.length} onChange={(length) => set("reply", { length })} options={[["short", "Short"], ["medium", "Medium"], ["detailed", "Detailed"]]} />
        </Row>
        <Row label="Language">
          <Input value={draft.reply.language} maxLength={40} onChange={(e) => set("reply", { language: e.target.value })} className="h-8 max-w-48 text-sm" aria-label="Reply language" />
        </Row>
        <Row label="Standing instructions" hint="Applied to every conversation, e.g. “always show file paths” or “explain like I'm new to the codebase”.">
          <textarea
            value={draft.reply.instructions}
            maxLength={1000}
            rows={3}
            onChange={(e) => set("reply", { instructions: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            placeholder="Optional"
            aria-label="Standing instructions"
          />
        </Row>
      </Section>

      <Section icon={Repeat} title="Before starting work" description="How much GitFill asks before it makes a presentation, handbook, README or video.">
        <Row label="Question rounds" hint="0 starts right away with sensible defaults.">
          <Segmented value={String(draft.loop.intentRounds)} onChange={(v) => set("loop", { intentRounds: Number(v) })} options={["0", "1", "2", "3", "4", "5"].map((n) => [n, n] as const)} />
        </Row>
        <Toggle label="Ask which format first" hint="Presentation, document, README or video, when your request doesn't say." checked={draft.loop.askFormat} onChange={(askFormat) => set("loop", { askFormat })} />
        <Toggle label="Confirm the brief before starting" hint="Show the plan in a few lines and wait for your yes." checked={draft.loop.confirmBrief} onChange={(confirmBrief) => set("loop", { confirmBrief })} />
      </Section>

      <Section icon={Presentation} title="Presentations" description="Defaults for every deck. A choice you make for one deck always wins.">
        <Toggle label="Use the project's own theme" hint="Colours and fonts read from the repository's stylesheets, Tailwind config and .gitfill/assets/brand.json." checked={draft.presentation.useProjectTheme} onChange={(useProjectTheme) => set("presentation", { useProjectTheme })} />
        <Row label="Template" hint={draft.presentation.useProjectTheme ? "Layout used with the project's colours." : "Used for every deck."}>
          <Select value={draft.presentation.template ?? ""} onChange={(v) => set("presentation", { template: (v || undefined) as TemplateId | undefined })} options={[["", "Best for the deck type"], ...TEMPLATE_IDS.map((id) => [id, TEMPLATES[id].name] as const)]} label="Default template" />
        </Row>
        <Row label="Deck type">
          <Select value={draft.presentation.deckType ?? ""} onChange={(v) => set("presentation", { deckType: (v || undefined) as DeckType | undefined })} options={[["", "Decide from my request"], ...DECK_TYPES.map((t) => [t, DECK_TYPE_DEFS[t].label] as const)]} label="Default deck type" />
        </Row>
        <Row label="Slides">
          <Input type="number" min={4} max={20} value={draft.presentation.slides} onChange={(e) => set("presentation", { slides: Math.min(20, Math.max(4, Number(e.target.value) || 10)) })} className="h-8 w-20 text-sm" aria-label="Default slide count" />
        </Row>
        <Toggle label="Generate cover artwork" checked={draft.presentation.illustrations} onChange={(illustrations) => set("presentation", { illustrations })} />
        <Row label="PowerPoint">
          <Segmented value={draft.presentation.pptx} onChange={(pptx) => set("presentation", { pptx })} options={[["native", "Editable"], ["image", "One image per slide"]]} />
        </Row>
      </Section>

      <Section icon={Brain} title="Memory" description="Things GitFill remembers about you across conversations. Say “remember …” in chat to add one.">
        <Toggle label="Use and add memories" checked={draft.memory.enabled} onChange={(enabled) => set("memory", { enabled })} />
        <ul className="divide-y rounded-md border">
          {draft.memory.notes.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">Nothing remembered yet.</li>}
          {draft.memory.notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 text-sm">{n.text}<span className="ml-2 text-xs text-muted-foreground">{timeAgo(n.createdAt)}</span></span>
              <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label={`Forget: ${n.text}`} onClick={() => set("memory", { notes: draft.memory.notes.filter((x) => x.id !== n.id) })}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addNote())} placeholder="e.g. I present to hackathon judges; keep decks to 8 slides." className="h-8 text-sm" aria-label="New memory" />
          <Button size="sm" variant="outline" className="h-8" onClick={addNote} disabled={note.trim().length < 2}><Plus />Add</Button>
        </div>
      </Section>

      {/* Shown only while there is something to save (or an error), floating over the page bottom. */}
      {(dirty || error) && (
        <div className="sticky bottom-4 z-10 ml-auto flex w-fit items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-lg">
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p className="text-sm text-muted-foreground">You have unsaved changes</p>}
          <Button variant="ghost" size="sm" disabled={state === "saving"} onClick={() => (setDraft(saved), setError(null))}>Discard</Button>
          <Button size="sm" disabled={!dirty || state === "saving"} onClick={() => void save()}>
            {state === "saving" && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      )}
      {state === "saved" && !dirty && (
        <p role="status" className="flex items-center justify-end gap-1 text-sm text-success"><Check className="size-4" />Configuration saved</p>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, description, children }: { icon: typeof Brain; title: string; description: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand/10 text-brand"><Icon className="size-4" /></span>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-3.5">{children}</div>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-4">
      <div className="pt-1.5">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50", checked ? "border-primary bg-primary" : "bg-muted")}
      >
        <span className={cn("absolute top-0.5 size-3.5 rounded-full bg-background shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </button>
    </label>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: ReadonlyArray<readonly [T, string]> }) {
  return (
    <div className="inline-flex flex-wrap rounded-md border bg-muted/40 p-0.5" role="radiogroup">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={cn("rounded px-2.5 py-1 text-xs transition-colors", v === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: ReadonlyArray<readonly [string, string]>; label: string }) {
  return (
    <ThemedSelect value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="h-8 w-auto min-w-52">
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </ThemedSelect>
  );
}
