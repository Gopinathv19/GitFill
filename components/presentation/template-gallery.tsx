"use client";

import { Check } from "lucide-react";
import { UploadZone } from "@/components/shared/upload-zone";
import { Label } from "@/components/ui/input";
import type { UploadView } from "@/lib/client/uploads";
import { getTheme, TEMPLATE_IDS, TEMPLATES, type Brand, type TemplateId } from "@/lib/presentation/themes";
import { cn } from "@/lib/utils";

/** A miniature page in the template's real colours, fonts, radius, chrome and cover style. */
export function TemplatePreview({ id, brand, className }: { id: TemplateId; brand?: Brand; className?: string }) {
  const t = getTheme(id, brand);
  const v = (k: string) => t.tokens[k];
  const r = Math.min(t.template.radius, 8) / 2;
  const centered = t.cover === "centered";
  return (
    <div className={cn("relative aspect-video w-full overflow-hidden", className)} style={{ background: v("--bg"), color: v("--text"), fontFamily: v("--font-sans") }} aria-hidden>
      {t.cover === "band" && <div className="absolute inset-y-0 left-0 w-[6%]" style={{ background: v("--accent") }} />}
      <div className={cn("absolute inset-0 flex flex-col p-[7%]", t.cover === "band" && "pl-[12%]", centered && "items-center text-center")}>
        <div className="mb-[5%] flex items-center gap-1">
          <span className="block size-2 rounded-[2px]" style={{ background: v("--mark-bg") }} />
          <span className="block h-1 w-8 rounded-full" style={{ background: v("--text-4") }} />
        </div>
        <div className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: v("--accent-soft") }}>
          Overview
        </div>
        <div className="mt-0.5 text-[13px] font-bold leading-tight" style={{ fontFamily: v("--font-heading") }}>
          How it <span style={{ color: v("--accent-soft") }}>works</span>
        </div>
        <div className={cn("mt-auto grid w-full gap-1", centered ? "grid-cols-3" : "grid-cols-[1.4fr_1fr]")}>
          {[0, 1, centered ? 2 : -1].filter((i) => i >= 0).map((i) => (
            <div key={i} className="h-7 border p-1" style={{ background: v("--surface"), borderColor: v("--border"), borderRadius: r }}>
              <span className="block h-1 w-1/2 rounded-full" style={{ background: i === 0 ? v("--accent") : v("--text-3") }} />
              <span className="mt-1 block h-0.5 w-4/5 rounded-full" style={{ background: v("--text-4") }} />
              <span className="mt-0.5 block h-0.5 w-3/5 rounded-full" style={{ background: v("--text-4") }} />
            </div>
          ))}
        </div>
        {t.chrome !== "clean" && <div className="mt-[4%] h-px w-full" style={{ background: v("--border") }} />}
      </div>
    </div>
  );
}

/** Pick one of the templates; the deck type's suggestion is marked. */
export function TemplateGallery({ value, onChange, brand, suggested, compact = false }: { value: TemplateId; onChange: (id: TemplateId) => void; brand?: Brand; suggested?: TemplateId; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Deck template" className={cn("grid gap-2.5", compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4")}>
      {TEMPLATE_IDS.map((id) => {
        const t = TEMPLATES[id];
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(id)}
            className={cn("group overflow-hidden rounded-lg border bg-background text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring", on && "border-primary ring-2 ring-primary/40")}
          >
            <div className="relative">
              <TemplatePreview id={id} brand={brand} />
              {on && (
                <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </span>
              )}
            </div>
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                {t.name}
                {suggested === id && <span className="rounded bg-primary/10 px-1 text-[10px] font-normal text-primary">suggested</span>}
              </div>
              {!compact && <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{t.bestFor}</p>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export interface BrandState {
  brand: Brand;
  logo: UploadView[];
  template: UploadView[];
}

/**
 * The user's own look on top of a template: brand colours, a logo, or a .pptx whose theme
 * colours and fonts are read and applied.
 */
export function BrandPanel({ workspaceId, value, onChange }: { workspaceId: string; value: BrandState; onChange: (next: BrandState) => void }) {
  const set = (patch: Partial<Brand>) => onChange({ ...value, brand: clean({ ...value.brand, ...patch }) });
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
      <div className="space-y-2">
        <Label>Brand colours</Label>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <ColorField label="Accent" value={value.brand.accent} onChange={(accent) => set({ accent })} />
          <ColorField label="Second" value={value.brand.accent2} onChange={(accent2) => set({ accent2 })} />
          <ColorField label="Background" value={value.brand.background} onChange={(background) => set({ background })} />
        </div>
        <Label htmlFor="brand-name" className="pt-1">Name on slides</Label>
        <input id="brand-name" value={value.brand.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="Defaults to the project name" className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
      </div>
      <div className="space-y-2">
        <Label>Logo</Label>
        <UploadZone
          workspaceId={workspaceId}
          purpose="logo"
          accept="image/png,image/jpeg,image/webp,image/gif"
          compact
          hint="Upload a logo (PNG with transparency works best)"
          uploads={value.logo}
          onChange={(logo) => onChange({ ...value, logo: logo.slice(-1), brand: clean({ ...value.brand, logoAssetId: logo.at(-1)?.id }) })}
        />
        <Label>Company template (.pptx)</Label>
        <UploadZone
          workspaceId={workspaceId}
          purpose="template"
          accept=".pptx"
          compact
          hint="Upload a .pptx to use its colours and fonts"
          uploads={value.template}
          onChange={(template) => {
            const t = template.at(-1);
            const fromTemplate = (t?.brand ?? {}) as Brand;
            onChange({ ...value, template: template.slice(-1), brand: clean({ ...fromTemplate, ...pick(value.brand, ["name", "logoAssetId"]) }) });
          }}
        />
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <input type="color" value={value ?? "#14b8a6"} onChange={(e) => onChange(e.target.value)} className="size-7 cursor-pointer rounded border bg-transparent p-0.5" aria-label={`${label} colour`} />
      <span className={cn(!value && "text-muted-foreground")}>{label}</span>
      {value && (
        <button type="button" onClick={() => onChange(undefined)} className="text-muted-foreground hover:text-foreground" aria-label={`Clear ${label.toLowerCase()} colour`}>
          ×
        </button>
      )}
    </label>
  );
}

function clean(b: Brand): Brand {
  return Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== "")) as Brand;
}

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Partial<T> {
  return Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) as unknown as Partial<T>;
}
