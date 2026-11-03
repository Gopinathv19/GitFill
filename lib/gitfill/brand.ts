import type { GitHubClient } from "@/lib/connectors/github/client";
import { brandSchema, type Brand } from "@/lib/presentation/spec";
import type { CodeSource } from "@/lib/repo-store";
import { ASSETS_DIR } from "./layout";

/**
 * The analyzed application's own look, read from its repository so decks and images match its UI:
 * `.gitfill/assets/brand.json` when the team wrote one, otherwise the CSS custom properties of its
 * global stylesheet (shadcn/Tailwind v4 tokens in hex, hsl, rgb or oklch), its Tailwind config and the
 * fonts it loads. Code reads the files; no model guesses a brand. What could not be found is listed
 * so the user can be told and fill it in.
 */
export interface RepoBrand {
  brand: Brand;
  /** Where each value came from, e.g. { accent: "app/globals.css (--primary)" }. */
  sources: Record<string, string>;
  /** Brand parts the repository does not show (accent, background, fonts). */
  missing: string[];
}

const STYLE_FILE = /(^|\/)(globals?|theme|themes|variables|tokens|index|app|main|styles?|tailwind|base)\.(css|scss)$/i;
const TAILWIND_CONFIG = /(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/i;
const FONT_FILE = /(^|\/)(app\/layout|src\/app\/layout|pages\/_app|src\/pages\/_app|index|src\/main|src\/index)\.(tsx|jsx|ts|js|html)$/i;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|\.next|vendor|coverage|storybook-static|public\/vendor)\//;
const MAX_BYTES = 60_000;
/** System aliases, generic families and icon or emoji fonts: never a brand's text font. */
const NOT_TEXT_FONT = /^(blinkmacsystemfont|-apple-system|system-ui|ui-[\w-]+|(sans-)?serif|monospace|inherit|initial)$|emoji|symbol|icons?\b|font ?awesome/i;

/** Pure part: the brand from file texts. Exported for tests. */
export function brandFromFiles(files: Array<{ path: string; content: string }>): RepoBrand {
  const brand: Brand = {};
  const sources: Record<string, string> = {};
  const set = (key: keyof Brand, value: string | undefined, source: string) => {
    if (!value || brand[key] !== undefined) return;
    const parsed = brandSchema.shape[key].safeParse(value);
    if (!parsed.success) return;
    (brand as Record<string, unknown>)[key] = parsed.data;
    sources[key] = source;
  };

  // 1. The team's own brand file wins over anything read from code.
  for (const f of files.filter((x) => x.path === `${ASSETS_DIR}/brand.json`)) {
    try {
      const json = JSON.parse(f.content) as Record<string, unknown>;
      const colors = (json.colors ?? json.colours ?? {}) as Record<string, unknown>;
      const fonts = (json.fonts ?? {}) as Record<string, unknown>;
      const str = (...vals: unknown[]) => vals.find((v): v is string => typeof v === "string");
      set("name", str(json.name), f.path);
      set("accent", toHex(str(json.accent, json.primary, colors.accent, colors.primary, colors.brand)), f.path);
      set("accent2", toHex(str(json.accent2, json.secondary, colors.accent2, colors.secondary)), f.path);
      set("background", toHex(str(json.background, colors.background)), f.path);
      set("text", toHex(str(json.text, json.foreground, colors.text, colors.foreground)), f.path);
      set("headingFont", str(json.headingFont, fonts.heading, fonts.display), f.path);
      set("bodyFont", str(json.bodyFont, fonts.body, fonts.sans, json.font), f.path);
      if (json.mode === "dark" || json.mode === "light") set("mode", json.mode, f.path);
    } catch {
      // A broken brand.json is ignored; the code's own tokens still apply.
    }
  }

  // 2. CSS custom properties: the light (first) definition of each token.
  const vars = new Map<string, { value: string; path: string }>();
  for (const f of files.filter((x) => /\.(s?css)$/i.test(x.path))) {
    for (const [name, value] of cssVariables(f.content)) if (!vars.has(name)) vars.set(name, { value, path: f.path });
  }
  const fromVar = (key: keyof Brand, names: string[], test: (hex: string) => boolean = () => true) => {
    for (const name of names) {
      const v = resolveVar(vars, name);
      const hex = v && toHex(v.value);
      if (hex && test(hex)) return set(key, hex, `${v.path} (--${name})`);
    }
  };
  // shadcn's default --primary is near-black; only a coloured token counts as the brand accent.
  fromVar("accent", ["brand", "color-brand", "brand-primary", "primary", "color-primary", "accent-color", "ring"], isColourful);
  fromVar("accent2", ["brand-secondary", "color-secondary", "secondary-accent", "accent"], (hex) => isColourful(hex) && hex !== brand.accent);
  fromVar("background", ["background", "color-background", "bg", "color-bg", "body-bg"]);
  fromVar("text", ["foreground", "color-foreground", "text", "color-text", "body-color"]);

  // 3. Tailwind config colours.
  for (const f of files.filter((x) => TAILWIND_CONFIG.test(x.path))) {
    for (const [key, names] of [["accent", "brand|primary"], ["accent2", "secondary|accent"]] as const) {
      const m = new RegExp(`\\b(?:${names})\\b['"]?\\s*:\\s*(?:\\{[^}]*?\\b(?:DEFAULT|500|600)\\b['"]?\\s*:\\s*)?['"](#[0-9a-fA-F]{3,8})['"]`).exec(f.content);
      const hex = m && toHex(m[1]);
      if (hex && isColourful(hex)) set(key, hex, f.path);
    }
  }

  // 4. Fonts: next/font imports, Google Fonts links, then font tokens in CSS.
  for (const f of files) {
    const nextFont = /import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/.exec(f.content);
    const families = nextFont ? nextFont[1]!.split(",").map((s) => s.trim().split(/\s+as\s+/)[0]!.replace(/_/g, " ")).filter((s) => !/mono/i.test(s)) : [];
    for (const m of f.content.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"'&:)]+)/g)) {
      try {
        families.push(decodeURIComponent(m[1]!).replace(/\+/g, " "));
      } catch {
        // A malformed escape: skip this font, keep the rest of the brand.
      }
    }
    const text = families.filter((x) => !NOT_TEXT_FONT.test(x));
    if (text[0]) set("bodyFont", text[0], f.path);
    if (text[1]) set("headingFont", text[1], f.path);
  }
  for (const [key, names] of [["bodyFont", ["font-sans", "font-body", "font-family", "body-font"]], ["headingFont", ["font-heading", "font-display", "heading-font"]]] as const) {
    for (const name of names) {
      const v = vars.get(name);
      const family = v && firstFamily(v.value);
      if (family) {
        set(key, family, `${v.path} (--${name})`);
        break;
      }
    }
  }

  if (brand.background && !brand.mode) brand.mode = luminance(brand.background) > 0.4 ? "light" : "dark";
  const missing = [
    !brand.accent && "brand colour",
    !brand.background && "background colour",
    !brand.bodyFont && !brand.headingFont && "fonts",
  ].filter((x): x is string => Boolean(x));
  return { brand, sources, missing };
}

/** The few files that carry a brand, shallowest first: brand.json, global stylesheets, Tailwind config, font loaders. */
export function brandFiles(paths: Array<{ path: string; sizeBytes?: number }>): string[] {
  const depth = (p: string) => p.split("/").length;
  const pick = (re: RegExp, n: number) =>
    paths
      .filter((p) => re.test(p.path) && !SKIP_DIR.test(p.path) && (p.sizeBytes === undefined || (p.sizeBytes > 0 && p.sizeBytes <= MAX_BYTES)))
      .sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))
      .slice(0, n)
      .map((p) => p.path);
  return [...paths.filter((p) => p.path === `${ASSETS_DIR}/brand.json`).map((p) => p.path), ...pick(STYLE_FILE, 4), ...pick(TAILWIND_CONFIG, 1), ...pick(FONT_FILE, 3)];
}

/** Reads the files that carry the brand from a repository at an exact commit. */
export async function readRepoBrand(client: GitHubClient, repo: { owner: string; name: string; sha: string; paths: Array<{ path: string; sizeBytes: number }> }): Promise<RepoBrand> {
  const files: Array<{ path: string; content: string }> = [];
  for (const path of brandFiles(repo.paths)) {
    const content = await client.getFileTextIfExists(repo.owner, repo.name, repo.sha, path, MAX_BYTES).catch(() => null);
    if (content) files.push({ path, content });
  }
  return brandFromFiles(files);
}

/** The same from a scouting source (the chat's read-only repository view). */
export async function readRepoBrandFromSource(source: CodeSource): Promise<RepoBrand> {
  const { paths } = await source.listFiles({ limit: 5000 });
  const files: Array<{ path: string; content: string }> = [];
  for (const path of brandFiles(paths.map((path) => ({ path })))) {
    const read = await source.read(path, { start: 1, end: 2000 }).catch(() => null);
    if (read) files.push({ path, content: read.lines.join("\n") });
  }
  return brandFromFiles(files);
}

/** One line for prompts and progress: what was found and where. */
export function describeRepoBrand(rb: RepoBrand): string {
  const found = Object.entries(rb.brand).map(([k, v]) => `${k} ${v}${rb.sources[k] ? ` (from ${rb.sources[k]})` : ""}`);
  return [found.length ? `The application's own look: ${found.join("; ")}.` : "No brand colours or fonts were found in the repository.", rb.missing.length ? `Not found in the repository: ${rb.missing.join(", ")}.` : ""]
    .filter(Boolean)
    .join(" ");
}

function cssVariables(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  // Dark-mode blocks come after the light ones in nearly every stylesheet; drop the obvious ones anyway.
  const light = css.replace(/(\.dark|\[data-theme=["']?dark["']?\]|\[data-mode=["']?dark["']?\])\s*\{[^}]*\}/g, "");
  for (const m of light.matchAll(/--([\w-]+)\s*:\s*([^;}{]+)[;}]/g)) out.push([m[1]!.toLowerCase(), m[2]!.trim()]);
  return out;
}

function resolveVar(vars: Map<string, { value: string; path: string }>, name: string, hops = 0): { value: string; path: string } | undefined {
  const v = vars.get(name);
  const ref = v && /^var\(--([\w-]+)\)$/.exec(v.value);
  return ref && hops < 4 ? resolveVar(vars, ref[1]!.toLowerCase(), hops + 1) ?? v : v;
}

function firstFamily(value: string): string | undefined {
  for (const part of value.split(",")) {
    const name = part.trim().replace(/^['"]|['"]$/g, "");
    if (/^var\(/.test(name) || NOT_TEXT_FONT.test(name)) continue;
    return /^[A-Za-z0-9 \-]{2,40}$/.test(name) ? name : undefined;
  }
}

/** #rgb, #rrggbb, rgb(), hsl(), bare shadcn "222 47% 11%" and oklch() to #rrggbb. */
export function toHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase().replace(/\s*!important$/, "");
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return m[1]!.length === 3 ? `#${[...m[1]!].map((c) => c + c).join("")}` : `#${m[1]}`;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(v);
  if (m) return rgbHex(+m[1]!, +m[2]!, +m[3]!);
  m = /^(?:hsla?\()?\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/.exec(v);
  if (m) return rgbHex(...hslRgb(+m[1]!, +m[2]! / 100, +m[3]! / 100));
  m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/.exec(v);
  if (m) return rgbHex(...oklchRgb(m[2] ? +m[1]! / 100 : +m[1]!, +m[3]!, +m[4]!));
  return undefined;
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function oklchRgb(L: number, C: number, H: number): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055);
  return lin.map((x) => gamma(x) * 255) as [number, number, number];
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Saturated enough to read as a brand colour, not a grey, near-black or near-white. */
function isColourful(hex: string): boolean {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  return s > 0.25 && l > 0.15 && l < 0.85;
}
