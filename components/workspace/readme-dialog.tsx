"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, FileUp, Loader2, MessageCircleQuestion, Plus, Sparkles, X } from "lucide-react";
import { BrandPanel, TemplateGallery, type BrandState } from "@/components/presentation/template-gallery";
import { DictateButton } from "@/components/shared/dictate-button";
import { UploadZone } from "@/components/shared/upload-zone";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/client/api";
import type { AskUser } from "@/lib/client/questions";
import type { RepoView } from "@/lib/client/types";
import type { UploadView } from "@/lib/client/uploads";
import { README_TEMPLATE_IDS, README_TEMPLATES, SECTION_BY_ID, SECTIONS, type ChosenSection, type ReadmeStyle, type ReadmeTemplateId } from "@/lib/readme/templates";
import { isTemplateId, type TemplateId } from "@/lib/presentation/themes";
import { cn } from "@/lib/utils";
import { QuestionCard } from "./question-card";

const STEPS = ["Template", "Contents", "Look", "Questions", "Review"] as const;
type Step = (typeof STEPS)[number];

const STYLE_LABELS: Array<[keyof ReadmeStyle, string]> = [
  ["banner", "Banner image"],
  ["diagrams", "Architecture and flow images"],
  ["badges", "Stack badges"],
  ["centered", "Centered header"],
  ["contents", "Contents list"],
  ["emoji", "Emoji headings"],
  ["callout", "Tip callout"],
  ["rules", "Lines between sections"],
];

/** "## Contents" style outline of a template, for its card. */
function outline(id: ReadmeTemplateId) {
  const t = README_TEMPLATES[id];
  return t.sections.slice(0, 6).map((s) => `${t.style.emoji ? `${SECTION_BY_ID.get(s)?.emoji} ` : ""}${SECTION_BY_ID.get(s)?.title}`);
}

/**
 * README studio: pick a template (or bring your own README to follow), arrange the contents, choose
 * the look of the generated images and add screenshots, a logo and links, answer GitFill's questions
 * about the repository, then generate. The result opens as a document with a GitHub-style preview.
 */
export function ReadmeDialog({ workspaceId, repo, trigger, onStarted }: { workspaceId: string; repo: RepoView; trigger: React.ReactNode; onStarted?: (jobId: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("Template");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [template, setTemplate] = useState<ReadmeTemplateId>("showcase");
  const [useReference, setUseReference] = useState(false);
  const [reference, setReference] = useState("");
  const [sections, setSections] = useState<ChosenSection[]>(README_TEMPLATES.showcase.sections.map((id) => ({ id })));
  const [style, setStyle] = useState<ReadmeStyle>(README_TEMPLATES.showcase.style);
  const [imageTheme, setImageTheme] = useState<TemplateId>("aurora");
  const [brand, setBrand] = useState<BrandState>({ brand: {}, logo: [], template: [] });
  const [shots, setShots] = useState<UploadView[]>([]);
  const [links, setLinks] = useState<Array<{ label: string; url: string }>>([]);
  const [notes, setNotes] = useState("");
  const [questions, setQuestions] = useState<AskUser | null>(null);
  const [qState, setQState] = useState<"idle" | "loading" | "failed" | "answered">("idle");
  const [answers, setAnswers] = useState("");
  const [adding, setAdding] = useState("");
  const [custom, setCustom] = useState({ title: "", note: "" });
  const fileInput = useRef<HTMLInputElement>(null);

  const t = README_TEMPLATES[template];
  const index = STEPS.indexOf(step);

  function pickTemplate(id: ReadmeTemplateId) {
    const next = README_TEMPLATES[id];
    setTemplate(id);
    setSections(next.sections.map((s) => ({ id: s })));
    setStyle(next.style);
    if (isTemplateId(next.imageTheme)) setImageTheme(next.imageTheme);
  }

  function move(i: number, by: -1 | 1) {
    setSections((list) => {
      const next = [...list];
      const j = i + by;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  async function loadQuestions() {
    setQState("loading");
    setError(null);
    try {
      const ask = await api<AskUser>(`/api/workspaces/${workspaceId}/readme-questions`, {
        method: "POST",
        body: JSON.stringify({ repositoryId: repo.id, template, sections: sections.map((s) => s.id), notes: notes || undefined, hasBanner: style.banner, links: links.map((l) => l.url) }),
      });
      setQuestions(ask);
      setQState("idle");
    } catch (err) {
      setQState("failed");
      setError(errorMessage(err, "GitFill could not prepare questions. You can generate without them."));
    }
  }

  function go(next: Step) {
    setError(null);
    setStep(next);
    if (next === "Questions" && !questions && qState === "idle") void loadQuestions();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const brandValue = Object.keys(brand.brand).length ? brand.brand : undefined;
      const { jobId } = await api<{ jobId: string }>(`/api/workspaces/${workspaceId}/readme`, {
        method: "POST",
        body: JSON.stringify({
          repositoryId: repo.id,
          template,
          sections,
          style,
          imageTheme,
          ...(brandValue ? { brand: brandValue } : {}),
          reference: useReference ? reference : "",
          assetIds: shots.map((s) => s.id),
          links: links.filter((l) => l.label.trim() && /^https?:\/\//.test(l.url.trim())),
          instructions: notes,
          answers,
        }),
      });
      setOpen(false);
      if (onStarted) onStarted(jobId);
      else router.push(`/jobs/${jobId}`);
    } catch (err) {
      setError(errorMessage(err, "Could not start the README."));
    } finally {
      setBusy(false);
    }
  }

  const missing = SECTIONS.filter((s) => !sections.some((x) => x.id === s.id));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Write the README</DialogTitle>
          <DialogDescription>
            For <span className="font-medium text-foreground">{repo.fullName}</span>, from its code, your material and your answers. You review it before anything goes to GitHub.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-wrap gap-1.5 text-xs" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" onClick={() => i < index && go(s)} disabled={i > index} aria-current={s === step ? "step" : undefined} className={cn("rounded-full border px-2.5 py-0.5", s === step ? "border-primary bg-primary/10" : i < index ? "hover:bg-accent" : "text-muted-foreground")}>
                {i + 1}. {s}
              </button>
            </li>
          ))}
        </ol>

        {step === "Template" && (
          <div className="space-y-3">
            <div role="radiogroup" aria-label="README template" className="grid gap-2 sm:grid-cols-2">
              {README_TEMPLATE_IDS.map((id) => {
                const r = README_TEMPLATES[id];
                const on = template === id;
                return (
                  <button key={id} type="button" role="radio" aria-checked={on} onClick={() => pickTemplate(id)} className={cn("rounded-lg border bg-background p-3 text-left transition-colors hover:bg-accent", on && "border-primary ring-2 ring-primary/30")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{r.name}</span>
                      {on && <Check className="size-4 text-primary" />}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                    <ol className="mt-2 space-y-0.5 border-l pl-2 text-[11px] text-muted-foreground">
                      {outline(id).map((line) => (
                        <li key={line} className="truncate">{line}</li>
                      ))}
                      {r.sections.length > 6 && <li>+ {r.sections.length - 6} more</li>}
                    </ol>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {STYLE_LABELS.filter(([k]) => r.style[k] && ["banner", "diagrams", "badges"].includes(k)).map(([, label]) => (
                        <span key={label} className="rounded bg-primary/10 px-1.5 text-[10px] text-primary">{label}</span>
                      ))}
                      <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{r.bestFor}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useReference} onChange={(e) => setUseReference(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
              Use a README I like as the model (its structure and style, never its facts)
            </label>
            {useReference && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="r-ref">Paste a README, or load a .md file</Label>
                  <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                    <FileUp />
                    Load .md
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".md,.markdown,.txt"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (f) setReference((await f.text()).slice(0, 40_000));
                      e.target.value = "";
                    }}
                  />
                </div>
                <Textarea id="r-ref" value={reference} onChange={(e) => setReference(e.target.value.slice(0, 40_000))} className="min-h-32 font-mono text-xs" placeholder="# My favourite README…" />
              </div>
            )}
          </div>
        )}

        {step === "Contents" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">The README follows this order. Rename sections, tell GitFill what you want in one, or add your own.</p>
            <ol className="space-y-1.5">
              {sections.map((s, i) => {
                const known = SECTION_BY_ID.get(s.id);
                return (
                  <li key={`${s.id}-${i}`} className="rounded-md border bg-background p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                      {style.emoji && known && <span aria-hidden>{known.emoji}</span>}
                      <input
                        value={s.title ?? known?.title ?? ""}
                        onChange={(e) => setSections((list) => list.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                        aria-label={`Title of section ${i + 1}`}
                        className="min-w-0 flex-1 rounded bg-transparent px-1 text-sm font-medium outline-none focus:bg-muted"
                      />
                      <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="size-3.5" /></Button>
                      <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === sections.length - 1}><ArrowDown className="size-3.5" /></Button>
                      <Button type="button" size="icon" variant="ghost" className="size-7" aria-label="Remove section" onClick={() => setSections((list) => list.filter((_, j) => j !== i))}><X className="size-3.5" /></Button>
                    </div>
                    <div className="ml-6 mt-1 flex items-center gap-1">
                      <input
                        value={s.note ?? ""}
                        onChange={(e) => setSections((list) => list.map((x, j) => (j === i ? { ...x, note: e.target.value.slice(0, 400) } : x)))}
                        placeholder={known ? `Anything to include? (${known.guide.split(".")[0]!.toLowerCase()})` : "What should this section say?"}
                        aria-label={`Note for section ${i + 1}`}
                        className="min-w-0 flex-1 rounded border bg-muted/30 px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      />
                      <DictateButton size="sm" workspaceId={workspaceId} onText={(spoken) => setSections((list) => list.map((x, j) => (j === i ? { ...x, note: `${x.note ? `${x.note} ` : ""}${spoken}`.slice(0, 400) } : x)))} />
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-2">
              <div className="min-w-48 flex-1">
                <Label htmlFor="r-add">Add a section</Label>
                <Select id="r-add" value={adding} onChange={(e) => setAdding(e.target.value)}>
                  <option value="">Choose…</option>
                  {missing.map((s) => (
                    <option key={s.id} value={s.id}>{s.emoji} {s.title}</option>
                  ))}
                  <option value="custom">Your own section…</option>
                </Select>
              </div>
              {adding === "custom" && (
                <>
                  <Input value={custom.title} onChange={(e) => setCustom({ ...custom, title: e.target.value.slice(0, 60) })} placeholder="Title, e.g. Team" className="w-36" />
                  <Input value={custom.note} onChange={(e) => setCustom({ ...custom, note: e.target.value.slice(0, 400) })} placeholder="What it should say" className="min-w-40 flex-1" />
                </>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!adding || (adding === "custom" && !custom.title.trim())}
                onClick={() => {
                  setSections((list) => [...list, adding === "custom" ? { id: "custom", title: custom.title.trim(), note: custom.note.trim() || undefined } : { id: adding }]);
                  setAdding("");
                  setCustom({ title: "", note: "" });
                }}
              >
                <Plus />
                Add
              </Button>
            </div>
          </div>
        )}

        {step === "Look" && (
          <div className="space-y-4">
            <fieldset className="grid gap-2 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-medium">Style</legend>
              {STYLE_LABELS.map(([key, label]) => (
                <label key={key} className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={style[key]} onChange={(e) => setStyle((s) => ({ ...s, [key]: e.target.checked }))} className="size-4 accent-[hsl(var(--primary))]" />
                  {label}
                </label>
              ))}
            </fieldset>
            {(style.banner || style.diagrams) && (
              <div className="space-y-2">
                <Label>Colours of the generated images</Label>
                <TemplateGallery compact value={imageTheme} onChange={setImageTheme} brand={Object.keys(brand.brand).length ? brand.brand : undefined} suggested={isTemplateId(t.imageTheme) ? t.imageTheme : undefined} />
                <details className="rounded-md border px-3 py-2 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Use my brand: colours, logo or a .pptx template</summary>
                  <div className="mt-2">
                    <BrandPanel workspaceId={workspaceId} value={brand} onChange={setBrand} />
                  </div>
                </details>
              </div>
            )}
            <div>
              <Label>Screenshots to show</Label>
              <p className="mb-2 text-xs text-muted-foreground">They are added under <code>docs/readme/</code> and placed in the sections they illustrate.</p>
              <UploadZone workspaceId={workspaceId} uploads={shots} onChange={setShots} accept="image/png,image/jpeg,image/webp,image/gif" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Header links</Label>
                <Button type="button" size="sm" variant="ghost" disabled={links.length >= 6} onClick={() => setLinks((l) => [...l, { label: l.length ? "Demo video" : "Live app", url: "" }])}>
                  <Plus />
                  Add link
                </Button>
              </div>
              {links.map((l, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input value={l.label} onChange={(e) => setLinks((all) => all.map((x, j) => (j === i ? { ...x, label: e.target.value.slice(0, 30) } : x)))} className="w-36" aria-label="Link label" />
                  <Input value={l.url} onChange={(e) => setLinks((all) => all.map((x, j) => (j === i ? { ...x, url: e.target.value.slice(0, 300) } : x)))} placeholder="https://…" className="flex-1" aria-label="Link URL" />
                  <Button type="button" size="icon" variant="ghost" aria-label="Remove link" onClick={() => setLinks((all) => all.filter((_, j) => j !== i))}><X /></Button>
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-end justify-between">
                <Label htmlFor="r-notes">Anything else GitFill should know</Label>
                <DictateButton size="sm" workspaceId={workspaceId} onText={(spoken) => setNotes((v) => (v.trim() ? `${v.trimEnd()} ${spoken}` : spoken))} />
              </div>
              <Textarea id="r-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" placeholder="e.g. Built for the Nebius hackathon; keep the setup section short." />
            </div>
          </div>
        )}

        {step === "Questions" && (
          <div className="space-y-3">
            {qState === "loading" && (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                GitFill is reading {repo.fullName} and its current README to ask you a few questions…
              </div>
            )}
            {questions && qState !== "answered" && (
              <>
                {questions.intro && (
                  <p className="flex gap-2 text-sm">
                    <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-primary" />
                    {questions.intro}
                  </p>
                )}
                <QuestionCard
                  ask={questions}
                  workspaceId={workspaceId}
                  onAnswer={(text) => {
                    setAnswers(text.startsWith("No preferences") ? "" : text);
                    setQState("answered");
                    go("Review");
                  }}
                />
              </>
            )}
            {qState === "answered" && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="mb-1 font-medium">Your answers</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{answers || "No preferences; GitFill decides."}</p>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setQState("idle")}>Change answers</Button>
              </div>
            )}
            {qState === "failed" && <Button size="sm" variant="outline" onClick={() => void loadQuestions()}>Try again</Button>}
          </div>
        )}

        {step === "Review" && (
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Template</dt>
            <dd>{t.name}{useReference && reference.trim() ? ", following your README's structure" : ""}</dd>
            <dt className="text-muted-foreground">Contents</dt>
            <dd>{sections.map((s) => s.title || SECTION_BY_ID.get(s.id)?.title).join(" · ")}</dd>
            <dt className="text-muted-foreground">Images</dt>
            <dd>{[style.banner && "banner", style.diagrams && "architecture and flow", style.badges && "badges", shots.length && `${shots.length} screenshot${shots.length > 1 ? "s" : ""}`].filter(Boolean).join(", ") || "None"}</dd>
            <dt className="text-muted-foreground">Your answers</dt>
            <dd className="whitespace-pre-wrap">{answers || (qState === "answered" ? "GitFill decides" : "Not asked")}</dd>
          </dl>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <Button type="button" variant="ghost" onClick={() => (index === 0 ? setOpen(false) : go(STEPS[index - 1]!))}>
            {index === 0 ? "Cancel" : <><ArrowLeft />Back</>}
          </Button>
          <div className="flex gap-2">
            {step === "Questions" && qState !== "answered" && <Button type="button" variant="outline" onClick={() => go("Review")}>Skip questions</Button>}
            {step === "Review" ? (
              <Button type="button" onClick={() => void submit()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Write README
              </Button>
            ) : step !== "Questions" || qState === "answered" ? (
              <Button type="button" onClick={() => go(STEPS[index + 1]!)} disabled={step === "Contents" && !sections.length}>
                Next
                <ArrowRight />
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
