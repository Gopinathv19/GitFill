/**
 * Deck templates. A template is a complete look: colour tokens, fonts, corner radius, type scale,
 * how much page chrome (header/footer) it shows, the cover composition and the default page
 * background. The stylesheet reads only CSS custom properties and a few template classes, so a
 * template never changes what a slide says, only how it looks. A brand (the user's colours, logo
 * and fonts, typed in or read from an uploaded .pptx) is applied on top of any template.
 *
 * Pure data and colour maths: safe to import in client components (the template gallery).
 */

export const TEMPLATE_IDS = ["midnight", "daylight", "graphite", "paper", "blueprint", "aurora", "evergreen", "contrast"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
/** Kept for older code paths: a deck's `theme` field holds a template id. */
export type ThemeName = TemplateId;

export type Chrome = "full" | "minimal" | "clean";
export type CoverStyle = "split" | "centered" | "band";
export type PageStyle = "atlas" | "editorial" | "cards";

export interface TemplateFonts {
  /** CSS stacks used in the preview, PDF and slide images. */
  sans: string;
  heading: string;
  mono: string;
  /** Font names written into the .pptx (fonts PowerPoint, Keynote and Google Slides have). */
  pptx: { body: string; heading: string; mono: string };
}

export interface Palette {
  mode: "dark" | "light";
  bg: string;
  surface: string;
  text: string;
  accent: string;
  /** Second accent for highlights; defaults to a lighter/darker accent. */
  accent2?: string;
}

export interface DeckTemplate {
  id: TemplateId;
  name: string;
  description: string;
  /** What kind of deck it suits, shown in the gallery. */
  bestFor: string;
  palette: Palette;
  fonts: TemplateFonts;
  radius: number;
  /** Multiplies the base type scale; >1 for airy pitch templates. */
  typeScale: number;
  chrome: Chrome;
  cover: CoverStyle;
  pageStyle: PageStyle;
}

/** A user's brand, applied on top of a template. Every field is optional. */
export interface Brand {
  name?: string;
  accent?: string;
  accent2?: string;
  background?: string;
  text?: string;
  mode?: "dark" | "light";
  headingFont?: string;
  bodyFont?: string;
  /** Upload id of the logo shown in the page header and on the cover. */
  logoAssetId?: string;
}

/** The resolved look a deck renders with. */
export interface Theme {
  name: TemplateId;
  template: DeckTemplate;
  /** Body background outside the pages (screen preview only). */
  canvas: string;
  /** Hex without '#', for the .pptx slide background. */
  background: string;
  tokens: Record<string, string>;
  fonts: TemplateFonts;
  chrome: Chrome;
  cover: CoverStyle;
  pageStyle: PageStyle;
}

const GEIST = '"Geist", ui-sans-serif, system-ui, sans-serif';
const GEIST_MONO = '"Geist Mono", ui-monospace, monospace';
const SERIF = 'Georgia, "Liberation Serif", "DejaVu Serif", "Times New Roman", serif';

const sansFonts: TemplateFonts = { sans: GEIST, heading: GEIST, mono: GEIST_MONO, pptx: { body: "Arial", heading: "Arial", mono: "Consolas" } };

export const TEMPLATES: Record<TemplateId, DeckTemplate> = {
  midnight: {
    id: "midnight",
    name: "Midnight",
    description: "Dark, teal accents, dense technical pages.",
    bestFor: "Engineering walkthroughs",
    palette: { mode: "dark", bg: "#070b0d", surface: "#0c1214", text: "#f4f7f6", accent: "#14b8a6", accent2: "#2dd4bf" },
    fonts: sansFonts,
    radius: 6,
    typeScale: 1,
    chrome: "full",
    cover: "split",
    pageStyle: "atlas",
  },
  daylight: {
    id: "daylight",
    name: "Daylight",
    description: "Clean white pages with teal accents.",
    bestFor: "Docs-style decks, printing",
    palette: { mode: "light", bg: "#ffffff", surface: "#f7f9f9", text: "#0b1416", accent: "#0d9488", accent2: "#0f766e" },
    fonts: sansFonts,
    radius: 6,
    typeScale: 1,
    chrome: "full",
    cover: "split",
    pageStyle: "atlas",
  },
  graphite: {
    id: "graphite",
    name: "Graphite",
    description: "Charcoal with amber highlights and a centred cover; little page chrome.",
    bestFor: "Product and tech talks",
    palette: { mode: "dark", bg: "#111214", surface: "#18191c", text: "#f5f5f4", accent: "#f59e0b", accent2: "#fbbf24" },
    fonts: sansFonts,
    radius: 10,
    typeScale: 1.08,
    chrome: "minimal",
    cover: "centered",
    pageStyle: "editorial",
  },
  paper: {
    id: "paper",
    name: "Paper",
    description: "Warm ivory, navy ink and serif headings, like a printed report.",
    bestFor: "Architecture reviews, design docs",
    palette: { mode: "light", bg: "#fbf8f1", surface: "#f4efe4", text: "#1c1a17", accent: "#1e3a8a", accent2: "#b45309" },
    fonts: { sans: GEIST, heading: SERIF, mono: GEIST_MONO, pptx: { body: "Arial", heading: "Georgia", mono: "Consolas" } },
    radius: 3,
    typeScale: 1,
    chrome: "minimal",
    cover: "band",
    pageStyle: "editorial",
  },
  blueprint: {
    id: "blueprint",
    name: "Blueprint",
    description: "Deep navy, cyan lines, monospace headings on a grid.",
    bestFor: "Deep technical dives, system design",
    palette: { mode: "dark", bg: "#0a1630", surface: "#0f1f3f", text: "#e6f0ff", accent: "#38bdf8", accent2: "#7dd3fc" },
    fonts: { sans: GEIST, heading: GEIST_MONO, mono: GEIST_MONO, pptx: { body: "Arial", heading: "Consolas", mono: "Consolas" } },
    radius: 2,
    typeScale: 1,
    chrome: "full",
    cover: "split",
    pageStyle: "cards",
  },
  aurora: {
    id: "aurora",
    name: "Aurora",
    description: "Bright, violet and pink, rounded, large type and lots of air.",
    bestFor: "Hackathon pitches, demo days",
    palette: { mode: "light", bg: "#fdfcff", surface: "#f5f2ff", text: "#1a1530", accent: "#7c3aed", accent2: "#db2777" },
    fonts: sansFonts,
    radius: 14,
    typeScale: 1.14,
    chrome: "clean",
    cover: "centered",
    pageStyle: "atlas",
  },
  evergreen: {
    id: "evergreen",
    name: "Evergreen",
    description: "Soft white with forest green; friendly and calm.",
    bestFor: "Onboarding, internal handovers",
    palette: { mode: "light", bg: "#fcfdfb", surface: "#f1f6ef", text: "#14211a", accent: "#15803d", accent2: "#0f766e" },
    fonts: sansFonts,
    radius: 8,
    typeScale: 1.04,
    chrome: "full",
    cover: "band",
    pageStyle: "editorial",
  },
  contrast: {
    id: "contrast",
    name: "Contrast",
    description: "Black and white with a yellow accent; readable on any projector.",
    bestFor: "Large rooms, accessibility",
    palette: { mode: "dark", bg: "#000000", surface: "#0d0d0d", text: "#ffffff", accent: "#facc15", accent2: "#fde047" },
    fonts: sansFonts,
    radius: 0,
    typeScale: 1.1,
    chrome: "minimal",
    cover: "band",
    pageStyle: "editorial",
  },
};

export function isTemplateId(id: string): id is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(id);
}

/* ------------------------------------------------------------ colour maths */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(v: string): boolean {
  return HEX.test(v.trim());
}

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** a mixed toward b by t (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/** The accent moved toward the text colour until it reads on the background (≥ 3:1). */
function readableOn(accent: string, bg: string, text: string): string {
  let c = accent;
  for (let i = 0; i < 8 && contrastRatio(c, bg) < 3; i++) c = mix(c, text, 0.2);
  return c;
}

/** Every token the stylesheet uses, derived from a five-colour palette. */
export function paletteTokens(p: Palette): Record<string, string> {
  const dark = p.mode === "dark";
  const { bg, surface, text } = p;
  const accent = readableOn(p.accent, bg, text);
  const accent2 = p.accent2 ? readableOn(p.accent2, bg, text) : mix(accent, text, 0.3);
  const ok = dark ? "#4ade80" : "#15803d";
  const warn = dark ? "#f59e0b" : "#d97706";
  const danger = dark ? "#ef4444" : "#dc2626";
  const info = dark ? "#7dd3fc" : "#0369a1";
  return {
    "--bg": bg,
    "--bg-sidebar": mix(bg, surface, 0.5),
    "--surface": surface,
    "--surface-2": mix(surface, text, dark ? 0.04 : 0.035),
    "--surface-3": mix(surface, text, dark ? 0.08 : 0.07),
    "--chip": mix(surface, text, dark ? 0.14 : 0.13),
    "--border": mix(surface, text, dark ? 0.1 : 0.1),
    "--border-strong": mix(surface, text, dark ? 0.18 : 0.2),
    "--grid": mix(bg, text, dark ? 0.07 : 0.08),
    "--divider": mix(surface, text, dark ? 0.26 : 0.32),
    "--text": text,
    "--text-2": mix(text, bg, 0.18),
    "--text-3": mix(text, bg, 0.38),
    "--text-4": mix(text, bg, 0.5),
    "--accent": accent,
    "--accent-strong": mix(accent, dark ? "#000000" : "#000000", 0.15),
    "--accent-soft": accent2,
    "--accent-softer": dark ? mix(accent2, "#ffffff", 0.45) : mix(accent, "#000000", 0.35),
    "--accent-dim": mix(accent, bg, dark ? 0.6 : 0.55),
    "--accent-bg": mix(bg, accent, dark ? 0.07 : 0.06),
    "--on-accent": contrastRatio("#ffffff", accent) >= 3 ? "#ffffff" : "#000000",
    "--mark-bg": `linear-gradient(135deg, ${accent}, ${accent2})`,
    "--ok": ok,
    "--ok-border": mix(ok, bg, 0.6),
    "--warn": warn,
    "--warn-soft": dark ? "#fcd34d" : "#b45309",
    "--warn-border": mix(warn, bg, 0.6),
    "--warn-bg": mix(bg, warn, dark ? 0.06 : 0.07),
    "--danger": danger,
    "--danger-soft": dark ? "#fca5a5" : "#b91c1c",
    "--danger-border": mix(danger, bg, 0.6),
    "--danger-bg": mix(bg, danger, dark ? 0.06 : 0.05),
    "--info": info,
    "--info-border": mix(info, bg, 0.6),
    "--shadow": dark ? "0 24px 60px rgba(0,0,0,.55)" : "0 18px 44px rgba(15,25,40,.14)",
  };
}

/** The two original themes keep their hand-tuned tokens. */
const TUNED: Partial<Record<TemplateId, Record<string, string>>> = {
  midnight: {
    "--bg": "#070b0d", "--bg-sidebar": "#090e10", "--surface": "#0c1214", "--surface-2": "#0f1618", "--surface-3": "#131b1e", "--chip": "#1f2a2d",
    "--border": "#1b2528", "--border-strong": "#29363b", "--grid": "#152024", "--divider": "#38484d", "--text": "#f4f7f6", "--text-2": "#d0dad8",
    "--text-3": "#97a8a5", "--text-4": "#728481", "--accent": "#14b8a6", "--accent-strong": "#0d9488", "--accent-soft": "#2dd4bf", "--accent-softer": "#99f6e4",
    "--accent-dim": "#1d5a52", "--accent-bg": "#0a1715", "--on-accent": "#ffffff", "--mark-bg": "linear-gradient(135deg, #059669, #2dd4bf)",
  },
  daylight: {
    "--bg": "#ffffff", "--bg-sidebar": "#f8fafa", "--surface": "#f7f9f9", "--surface-2": "#f0f4f4", "--surface-3": "#e9efef", "--chip": "#d9e2e2",
    "--border": "#dfe7e7", "--border-strong": "#c7d3d3", "--grid": "#e3eaea", "--divider": "#a9b9b9", "--text": "#0b1416", "--text-2": "#273639",
    "--text-3": "#52666a", "--text-4": "#738587", "--accent": "#0d9488", "--accent-strong": "#0f766e", "--accent-soft": "#0d9488", "--accent-softer": "#115e59",
    "--accent-dim": "#8fd3c8", "--accent-bg": "#eefaf7", "--on-accent": "#ffffff", "--mark-bg": "linear-gradient(135deg, #059669, #2dd4bf)",
  },
};

/** Font names are written into CSS and PPTX, so only plain names are accepted. */
const FONT_NAME = /^[A-Za-z0-9 \-]{2,40}$/;

function brandFonts(base: TemplateFonts, brand: Brand | undefined): TemplateFonts {
  const heading = brand?.headingFont && FONT_NAME.test(brand.headingFont) ? brand.headingFont : null;
  const body = brand?.bodyFont && FONT_NAME.test(brand.bodyFont) ? brand.bodyFont : null;
  return {
    sans: body ? `"${body}", ${base.sans}` : base.sans,
    heading: heading ? `"${heading}", ${base.heading}` : body ? `"${body}", ${base.heading}` : base.heading,
    mono: base.mono,
    pptx: { body: body ?? base.pptx.body, heading: heading ?? body ?? base.pptx.heading, mono: base.pptx.mono },
  };
}

/** The template with the brand applied, as the renderer and the PPTX writer use it. */
export function getTheme(name: string, brand?: Brand): Theme {
  const template = TEMPLATES[isTemplateId(name) ? name : "midnight"];
  const branded = Boolean(brand && (brand.accent || brand.background || brand.text || brand.accent2));
  const palette: Palette = { ...template.palette };
  if (brand?.background && isHexColor(brand.background)) {
    const light = luminance(brand.background) > 0.4;
    palette.bg = brand.background;
    palette.mode = brand.mode ?? (light ? "light" : "dark");
    // Text follows the background unless the brand names it, so a dark brand on a light template stays readable.
    palette.text = brand.text && isHexColor(brand.text) ? brand.text : light ? "#14181b" : "#f4f6f6";
    palette.surface = mix(brand.background, palette.text, 0.04);
  } else {
    if (brand?.mode) palette.mode = brand.mode;
    if (brand?.text && isHexColor(brand.text)) palette.text = brand.text;
  }
  if (brand?.accent && isHexColor(brand.accent)) {
    palette.accent = brand.accent;
    palette.accent2 = brand.accent2 && isHexColor(brand.accent2) ? brand.accent2 : undefined;
  }
  const tokens = { ...paletteTokens(palette), ...(branded ? {} : (TUNED[template.id] ?? {})) };
  const fonts = brandFonts(template.fonts, brand);
  Object.assign(tokens, {
    "--font-sans": fonts.sans,
    "--font-heading": fonts.heading,
    "--font-mono": fonts.mono,
    "--radius": `${template.radius}px`,
    "--mark-radius": `${Math.min(template.radius, 6)}px`,
    "--type-scale": String(template.typeScale),
  });
  return {
    name: template.id,
    template,
    canvas: palette.mode === "dark" ? mix(tokens["--bg"]!, "#000000", 0.5) : mix(tokens["--bg"]!, "#5a6b6b", 0.15),
    background: tokens["--bg"]!.replace("#", "").toUpperCase(),
    tokens,
    fonts,
    chrome: template.chrome,
    cover: template.cover,
    pageStyle: template.pageStyle,
  };
}

export function themeCss(theme: Theme): string {
  return `:root{${Object.entries(theme.tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}\nhtml,body{background:${theme.canvas}}`;
}

/** Template summaries for prompts and pickers. */
export function describeTemplates(): string {
  return TEMPLATE_IDS.map((id) => `- ${id}: ${TEMPLATES[id].name} — ${TEMPLATES[id].description} Best for: ${TEMPLATES[id].bestFor}.`).join("\n");
}
