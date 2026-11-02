"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, MessageCircleQuestion, Sparkles } from "lucide-react";
import { BrandPanel, TemplateGallery, type BrandState } from "@/components/presentation/template-gallery";
import { DictateButton } from "@/components/shared/dictate-button";
import { UploadZone } from "@/components/shared/upload-zone";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/client/api";
import type { AskUser } from "@/lib/client/questions";
import type { RepoView } from "@/lib/client/types";
import type { UploadView } from "@/lib/client/uploads";
import { DECK_TYPE_DEFS, DECK_TYPES, slidesForMinutes, type DeckType } from "@/lib/presentation/deck-types";
import { TEMPLATES, type TemplateId } from "@/lib/presentation/themes";
import { cn } from "@/lib/utils";
import { QuestionCard } from "./question-card";

const STEPS = ["Deck", "Look", "Material", "Questions", "Review"] as const;
type Step = (typeof STEPS)[number];

/** Spoken text added to a field: a new line for list fields, a space otherwise. */
const append = (current: string, spoken: string, newline = false) => (current.trim() ? `${current.trimEnd()}${newline ? "\n" : " "}${spoken}` : spoken);

/** A field label with a mic on the right. */
function VoiceLabel({ htmlFor, children, workspaceId, onText }: { htmlFor: string; children: React.ReactNode; workspaceId: string; onText: (text: string) => void }) {
  return (
    <div className="flex items-end justify-between gap-2">
      <Label htmlFor={htmlFor}>{children}</Label>
      <DictateButton size="sm" workspaceId={workspaceId} onText={onText} />
    </div>
  );
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);

/**
 * Starts a presentation step by step: what kind of deck and for whom, the look (a template, the
 * user's brand, a .pptx template), the material to use (screenshots, documents), then GitFill
 * reads the repository and asks a few grounded questions before it generates anything.
 */
export function GenerateDialog({ workspaceId, repo, trigger, onStarted }: { workspaceId: string; repo: RepoView; trigger: React.ReactNode; onStarted?: (jobId: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("Deck");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deckType, setDeckType] = useState<DeckType>("engineering_walkthrough");
  const [audience, setAudience] = useState("");
  const [minutes, setMinutes] = useState<number | "">(10);
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [useBrand, setUseBrand] = useState(false);
  const [brand, setBrand] = useState<BrandState>({ brand: {}, logo: [], template: [] });
  const [materials, setMaterials] = useState<UploadView[]>([]);
  const [mustCover, setMustCover] = useState("");
  const [avoid, setAvoid] = useState("");
  const [notes, setNotes] = useState("");
  const [questions, setQuestions] = useState<AskUser | null>(null);
  const [questionsState, setQuestionsState] = useState<"idle" | "loading" | "failed" | "answered">("idle");
  const [answers, setAnswers] = useState("");
  const [outputs, setOutputs] = useState({ pdf: true, readme: false, illustrations: false, editable: true });

  const def = DECK_TYPE_DEFS[deckType];
  const chosenTemplate = template ?? def.suggestedTemplate;
  const brandValue = useBrand && Object.keys(brand.brand).length ? brand.brand : undefined;
  const slideCount = minutes ? slidesForMinutes(deckType, minutes) : 10;

  function reset() {
    setStep("Deck");
    setError(null);
    setQuestions(null);
    setQuestionsState("idle");
    setAnswers("");
  }

  async function loadQuestions() {
    setQuestionsState("loading");
    setError(null);
    try {
      const ask = await api<AskUser>(`/api/workspaces/${workspaceId}/presentation-questions`, {
        method: "POST",
        body: JSON.stringify({ repositoryId: repo.id, deckType, audience: audience || undefined, minutes: minutes || undefined, notes: notes || undefined, mustCover: lines(mustCover), assetIds: materials.map((m) => m.id) }),
      });
      setQuestions(ask);
      setQuestionsState("idle");
    } catch (err) {
      setQuestionsState("failed");
      setError(errorMessage(err, "GitFill could not prepare questions. You can generate without them."));
    }
  }

  function go(next: Step) {
    setError(null);
    setStep(next);
    if (next === "Questions" && !questions && questionsState === "idle") void loadQuestions();
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await api<{ jobId: string }>(`/api/workspaces/${workspaceId}/generate`, {
        method: "POST",
        body: JSON.stringify({
          repositoryId: repo.id,
          deckType,
          audience,
          ...(minutes ? { minutes } : { slideCount }),
          theme: chosenTemplate,
          ...(brandValue ? { brand: brandValue } : {}),
          assetIds: [...materials.map((m) => m.id), ...(useBrand ? brand.template.map((t) => t.id) : [])],
          mustCover: lines(mustCover),
          avoid: lines(avoid),
          instructions: notes,
          answers,
          outputs: { pdf: outputs.pdf, readme: outputs.readme, illustrations: outputs.illustrations, pptx: outputs.editable ? "native" : "image" },
        }),
      });
      setOpen(false);
      reset();
      if (onStarted) onStarted(jobId);
      else router.push(`/jobs/${jobId}`);
    } catch (err) {
      setError(errorMessage(err, "Could not start the job."));
    } finally {
      setBusy(false);
    }
  }

  const index = STEPS.indexOf(step);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate presentation</DialogTitle>
          <DialogDescription>
            From <span className="font-medium text-foreground">{repo.fullName}</span> at the latest commit of {repo.defaultBranch ?? "the default branch"}.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-wrap gap-1.5 text-xs" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => i < index && go(s)}
                disabled={i > index}
                aria-current={s === step ? "step" : undefined}
                className={cn("rounded-full border px-2.5 py-0.5", s === step ? "border-primary bg-primary/10 text-foreground" : i < index ? "text-foreground hover:bg-accent" : "text-muted-foreground")}
              >
                {i + 1}. {s}
              </button>
            </li>
          ))}
        </ol>

        {step === "Deck" && (
          <div className="space-y-4">
            <div>
              <Label>What kind of presentation?</Label>
              <div role="radiogroup" aria-label="Deck type" className="mt-1.5 grid gap-2 sm:grid-cols-3">
                {DECK_TYPES.map((t) => {
                  const d = DECK_TYPE_DEFS[t];
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={deckType === t}
                      onClick={() => setDeckType(t)}
                      className={cn("rounded-lg border bg-background p-2.5 text-left transition-colors hover:bg-accent", deckType === t && "border-primary ring-2 ring-primary/30")}
                    >
                      <div className="text-sm font-medium">{d.label}</div>
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{d.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-6">
              <div className="sm:col-span-4">
                <Label htmlFor="g-aud">Who is it for?</Label>
                <Input id="g-aud" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder={def.defaultAudience} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="g-min">Talk length (minutes)</Label>
                <Input id="g-min" type="number" min={1} max={90} value={minutes} onChange={(e) => setMinutes(e.target.value ? Math.max(1, Math.min(90, Number(e.target.value))) : "")} />
                <p className="mt-1 text-[11px] text-muted-foreground">About {slideCount} slides</p>
              </div>
            </div>
          </div>
        )}

        {step === "Look" && (
          <div className="space-y-3">
            <TemplateGallery value={chosenTemplate} onChange={setTemplate} suggested={def.suggestedTemplate} brand={brandValue} />
            <p className="text-xs text-muted-foreground">
              {TEMPLATES[chosenTemplate].name}: {TEMPLATES[chosenTemplate].description} You can switch templates later without regenerating.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useBrand} onChange={(e) => setUseBrand(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" />
              Use my brand (colours, logo or a company .pptx template) on top of the template
            </label>
            {useBrand && <BrandPanel workspaceId={workspaceId} value={brand} onChange={setBrand} />}
          </div>
        )}

        {step === "Material" && (
          <div className="space-y-4">
            <div>
              <Label>Screenshots, images and documents</Label>
              <p className="mb-2 text-xs text-muted-foreground">
                Screenshots and photos are shown on slides (GitFill describes each one); Markdown, text, .docx or .pptx files are read and cited. Nothing here is treated as code.
              </p>
              <UploadZone workspaceId={workspaceId} uploads={materials} onChange={setMaterials} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <VoiceLabel htmlFor="g-must" workspaceId={workspaceId} onText={(t) => setMustCover((v) => append(v, t, true))}>
                  Must cover <span className="font-normal text-muted-foreground">(one per line)</span>
                </VoiceLabel>
                <Textarea id="g-must" value={mustCover} onChange={(e) => setMustCover(e.target.value)} className="min-h-20" placeholder={"The ingestion pipeline\nHow auth works"} />
              </div>
              <div>
                <VoiceLabel htmlFor="g-avoid" workspaceId={workspaceId} onText={(t) => setAvoid((v) => append(v, t, true))}>
                  Leave out <span className="font-normal text-muted-foreground">(one per line)</span>
                </VoiceLabel>
                <Textarea id="g-avoid" value={avoid} onChange={(e) => setAvoid(e.target.value)} className="min-h-20" placeholder="Deployment details" />
              </div>
            </div>
            <div>
              <VoiceLabel htmlFor="g-notes" workspaceId={workspaceId} onText={(t) => setNotes((v) => append(v, t))}>
                Anything else GitFill should know
              </VoiceLabel>
              <Textarea id="g-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16" placeholder="e.g. We won 2nd place last year with the retrieval demo; keep it non-technical for the first half." />
            </div>
          </div>
        )}

        {step === "Questions" && (
          <div className="space-y-3">
            {questionsState === "loading" && (
              <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                GitFill is reading {repo.fullName} to ask you a few questions about the deck…
              </div>
            )}
            {questions && questionsState !== "answered" && (
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
                    setQuestionsState("answered");
                    go("Review");
                  }}
                />
              </>
            )}
            {questionsState === "answered" && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="mb-1 font-medium">Your answers</p>
                <p className="whitespace-pre-wrap text-muted-foreground">{answers || "No preferences; GitFill decides."}</p>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => setQuestionsState("idle")}>
                  Change answers
                </Button>
              </div>
            )}
            {questionsState === "failed" && (
              <Button size="sm" variant="outline" onClick={() => void loadQuestions()}>
                Try again
              </Button>
            )}
          </div>
        )}

        {step === "Review" && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted-foreground">Deck</dt>
              <dd>{def.label}, about {slideCount} slides{minutes ? ` for ${minutes} minutes` : ""}</dd>
              <dt className="text-muted-foreground">For</dt>
              <dd>{audience || def.defaultAudience}</dd>
              <dt className="text-muted-foreground">Look</dt>
              <dd>
                {TEMPLATES[chosenTemplate].name}
                {brandValue ? " with your brand" : ""}
              </dd>
              <dt className="text-muted-foreground">Material</dt>
              <dd>{materials.length ? materials.map((m) => m.filename).join(", ") : "None (code only)"}</dd>
              {lines(mustCover).length > 0 && (
                <>
                  <dt className="text-muted-foreground">Must cover</dt>
                  <dd>{lines(mustCover).join("; ")}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Your answers</dt>
              <dd className="whitespace-pre-wrap">{answers || (questionsState === "answered" ? "GitFill decides" : "Not asked")}</dd>
            </dl>
            <fieldset className="flex flex-wrap gap-x-5 gap-y-2 border-t pt-3">
              <legend className="mb-2 text-sm font-medium">Outputs</legend>
              {(
                [
                  ["editable", "Editable PowerPoint (real text and shapes)"],
                  ["pdf", "PDF"],
                  ["readme", "README.md"],
                  ["illustrations", "AI cover artwork"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={outputs[key]} onChange={(e) => setOutputs((o) => ({ ...o, [key]: e.target.checked }))} className="size-4 accent-[hsl(var(--primary))]" />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <Button type="button" variant="ghost" onClick={() => (index === 0 ? setOpen(false) : go(STEPS[index - 1]!))}>
            {index === 0 ? "Cancel" : <><ArrowLeft />Back</>}
          </Button>
          <div className="flex gap-2">
            {step === "Questions" && questionsState !== "answered" && (
              <Button type="button" variant="outline" onClick={() => go("Review")}>
                Skip questions
              </Button>
            )}
            {step === "Review" ? (
              <Button type="button" onClick={() => void submit()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                Generate
              </Button>
            ) : step !== "Questions" || questionsState === "answered" ? (
              <Button type="button" onClick={() => go(STEPS[index + 1]!)}>
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
