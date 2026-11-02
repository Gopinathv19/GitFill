import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { esc, renderFigure, wrap } from "@/lib/presentation/html/diagrams";
import { architectureFigure, flowFigure, sequenceFigure, type Figure } from "@/lib/presentation/spec";
import { getTheme, type Brand, type Theme } from "@/lib/presentation/themes";

/**
 * README images, drawn by code: a banner, an architecture diagram and a flow (or sequence) diagram
 * as standalone SVG files that GitHub shows through <img>. The model only fills the structured specs
 * below from the evidence; colours come from a deck template (or the team's brand), boxes and arrows
 * from the same diagram kit the decks use. Fonts are system stacks because an SVG inside <img>
 * cannot load web fonts.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).optional();

export const bannerSchema = z.object({
  kicker: text(40).describe("Small uppercase label, e.g. 'AI customer support'."),
  title: text(64).describe("A claim about what the project does, not just its name, e.g. 'Answers only from what you train it on.'"),
  accent: opt(40).describe("A phrase copied exactly from the title to colour, e.g. 'what you train it on'."),
  tagline: opt(110).describe("Three short proof points separated by ' · '."),
  footnote: opt(80).describe("e.g. 'Powered by NVIDIA Nemotron on Nebius', only if the code shows it."),
  panel: z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("chat"),
        title: text(30),
        subtitle: opt(40),
        messages: z.array(z.object({ from: z.enum(["user", "app"]), text: text(70), chip: opt(28).describe("A source file or button label under an app message.") })).min(2).max(4),
      }),
      z.object({ type: z.literal("terminal"), title: text(36), lines: z.array(z.object({ text: z.string().max(60), kind: z.enum(["command", "output", "comment"]) })).min(3).max(7) }),
      z.object({ type: z.literal("cards"), items: z.array(z.object({ title: text(26), sub: opt(44) })).min(2).max(4) }),
    ])
    .describe("Right side: a chat mock for chat products, a terminal with real commands for tools, or feature cards."),
});

export const badgeSchema = z.object({
  label: text(24),
  message: text(30),
  color: z.string().regex(/^[0-9A-Fa-f]{6}$/).describe("Hex colour without #, e.g. 009688."),
  logo: z.string().regex(/^[a-z0-9.-]{1,40}$/).optional().describe("simple-icons slug, e.g. fastapi, nextdotjs, python."),
});

export const readmeVisualsSchema = z.object({
  banner: bannerSchema.optional(),
  architecture: z.object({ title: text(40), caption: opt(140), figure: architectureFigure }).optional(),
  flow: z.object({ title: text(40), caption: opt(140), figure: z.discriminatedUnion("kind", [flowFigure, sequenceFigure]) }).optional(),
  badges: z.array(badgeSchema).max(8).default([]),
});

export type ReadmeVisuals = z.infer<typeof readmeVisualsSchema>;
export type Banner = z.infer<typeof bannerSchema>;

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const W = 1280;
/** Left-column text of the banner must end before the panel. */
const LEFT_MAX = 750;

let diagramCss: string | null = null;
/** The diagram kit's rules (.d-box, .d-edge, …) from the deck stylesheet, so README images match decks. */
function diagramRules(): string {
  if (diagramCss) return diagramCss;
  const css = readFileSync(path.join(process.cwd(), "lib", "presentation", "html", "deck.css"), "utf8");
  diagramCss = [...css.matchAll(/^\.d-[^{]+\{[^}]*\}/gm)].map((m) => m[0]).join("\n");
  return diagramCss;
}

function themeStyle(theme: Theme): string {
  const vars = Object.entries({ ...theme.tokens, "--font-sans": SANS, "--font-mono": MONO })
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return `<style>:root{${vars}}text{font-family:${SANS}}\n${diagramRules()}</style>`;
}

/** The look of README images: a deck template, with the team's brand on top. */
export function readmeTheme(template: string, brand?: Brand): Theme {
  return getTheme(template, brand);
}

const card = (theme: Theme, w: number, h: number) => {
  const t = theme.tokens;
  return `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t["--bg"]}"/><stop offset="1" stop-color="${t["--accent-bg"]}"/></linearGradient>
  <radialGradient id="glow" cx="0.85" cy="0" r="0.8"><stop offset="0" stop-color="${t["--accent"]}" stop-opacity="0.22"/><stop offset="1" stop-color="${t["--accent"]}" stop-opacity="0"/></radialGradient>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${t["--grid"]}"/></pattern>
</defs>
<rect width="${w}" height="${h}" rx="20" fill="url(#bg)"/><rect width="${w}" height="${h}" rx="20" fill="url(#dots)" opacity="0.7"/><rect width="${w}" height="${h}" rx="20" fill="url(#glow)"/>`;
};

/** Words of `title` with the accent phrase marked, wrapped greedily to `chars` per line. */
function accentLines(title: string, accent: string | undefined, chars: number, maxLines: number): Array<Array<{ word: string; accent: boolean }>> {
  const words = title.split(/\s+/).filter(Boolean);
  const flags = words.map(() => false);
  if (accent) {
    const target = accent.toLowerCase().split(/\s+/).filter(Boolean);
    for (let i = 0; i + target.length <= words.length; i++) {
      if (target.every((t, j) => words[i + j]!.toLowerCase().replace(/[^\w'-]/g, "") === t.replace(/[^\w'-]/g, ""))) {
        for (let j = 0; j < target.length; j++) flags[i + j] = true;
        break;
      }
    }
  }
  const lines: Array<Array<{ word: string; accent: boolean }>> = [];
  let cur: Array<{ word: string; accent: boolean }> = [];
  let len = 0;
  words.forEach((word, i) => {
    if (cur.length && len + 1 + word.length > chars && lines.length < maxLines - 1) {
      lines.push(cur);
      cur = [];
      len = 0;
    }
    cur.push({ word, accent: flags[i]! });
    len += (cur.length > 1 ? 1 : 0) + word.length;
  });
  if (cur.length) lines.push(cur);
  return lines;
}

/** The banner: name, kicker, title with an accent phrase, tagline, and a panel on the right. */
export function renderBanner(b: Banner, opts: { name: string; theme: Theme; logo?: string }): string {
  const t = opts.theme.tokens;
  const H = 400;
  const left = 64;
  const letter = esc((/[A-Za-z0-9]/.exec(opts.name)?.[0] ?? "G").toUpperCase());
  const mark = opts.logo
    ? `<image href="${opts.logo}" x="${left}" y="56" width="44" height="44" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect x="${left}" y="56" width="44" height="44" rx="10" fill="${t["--accent"]}"/><text x="${left + 22}" y="86" text-anchor="middle" font-size="22" font-weight="700" fill="${t["--on-accent"]}">${letter}</text>`;
  const lines = accentLines(b.title, b.accent, 24, 3);
  const size = lines.length >= 3 ? 36 : 42;
  // First baseline sits a full line below the kicker, so the cap height never touches it.
  const titleTop = 146 + 18 + size;
  const title = lines
    .map(
      (line, i) =>
        `<text x="${left}" y="${titleTop + i * size * 1.12}" font-size="${size}" font-weight="700" letter-spacing="-0.5" data-max-x="${LEFT_MAX}">${line
          .map((w, j) => `<tspan fill="${w.accent ? t["--accent-soft"] : t["--text"]}">${j ? " " : ""}${esc(w.word)}</tspan>`)
          .join("")}</text>`,
    )
    .join("");
  const after = titleTop + (lines.length - 1) * size * 1.12 + 36;
  const tagline = b.tagline ? wrap(b.tagline, 62, 2).map((l, i) => `<text x="${left}" y="${after + i * 21}" font-size="15" fill="${t["--text-2"]}" data-max-x="${LEFT_MAX}">${esc(l)}</text>`).join("") : "";
  const foot = b.footnote ? `<text x="${left}" y="${H - 44}" font-size="12" fill="${t["--text-4"]}" data-max-x="${LEFT_MAX}">${esc(b.footnote)}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${opts.name}: ${b.title}`)}">${themeStyle(opts.theme)}
${card(opts.theme, W, H)}
${mark}<text x="${left + 60}" y="86" font-size="22" font-weight="700" fill="${t["--text"]}">${esc(opts.name)}</text>
<text x="${left}" y="146" font-size="12" font-weight="700" letter-spacing="2" fill="${t["--accent-soft"]}" data-max-x="${LEFT_MAX}">${esc(b.kicker.toUpperCase())}</text>
${title}${tagline}${foot}
${panel(b.panel, opts.theme, 770, 60, 446, 280)}
</svg>`;
}

function panel(p: Banner["panel"], theme: Theme, x: number, y: number, w: number, h: number): string {
  const t = theme.tokens;
  const frame = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${t["--surface"]}" stroke="${t["--border-strong"]}"/>`;
  if (p.type === "chat") {
    const head = `<path d="M${x} ${y + 14} a14 14 0 0 1 14 -14 h${w - 28} a14 14 0 0 1 14 14 v38 h-${w} z" fill="${t["--accent"]}"/>
<rect x="${x + 16}" y="${y + 12}" width="28" height="28" rx="7" fill="${t["--on-accent"]}" opacity="0.2"/>
<text x="${x + 56}" y="${y + 26}" font-size="13" font-weight="700" fill="${t["--on-accent"]}">${esc(p.title)}</text>
${p.subtitle ? `<text x="${x + 56}" y="${y + 42}" font-size="10" fill="${t["--on-accent"]}" opacity="0.85">${esc(p.subtitle)}</text>` : ""}`;
    let cy = y + 70;
    const bottom = y + h - 12;
    const bubbles = p.messages
      .map((m) => {
        const lines = wrap(m.text, 40, 2);
        const bw = Math.min(w - 60, Math.max(...lines.map((l) => l.length)) * 6.6 + 28);
        const bh = 14 + lines.length * 16;
        // A message that would spill out of the panel is left out, with everything after it.
        if (cy + bh + (m.chip && m.from === "app" ? 28 : 0) > bottom) {
          cy = Infinity;
          return "";
        }
        const bx = m.from === "user" ? x + w - 16 - bw : x + 16;
        const fill = m.from === "user" ? t["--accent"] : t["--surface-3"];
        const color = m.from === "user" ? t["--on-accent"] : t["--text"];
        let out = `<rect x="${bx}" y="${cy}" width="${bw}" height="${bh}" rx="9" fill="${fill}"/>${lines.map((l, i) => `<text x="${bx + 14}" y="${cy + 20 + i * 16}" font-size="12" fill="${color}" data-max-x="${x + w - 8}">${esc(l)}</text>`).join("")}`;
        cy += bh + 8;
        if (m.chip && m.from === "app") {
          const cw = m.chip.length * 6.4 + 20;
          out += `<rect x="${bx}" y="${cy}" width="${cw}" height="20" rx="5" fill="none" stroke="${t["--accent-dim"]}"/><text x="${bx + 10}" y="${cy + 14}" font-size="10.5" font-family="${MONO}" fill="${t["--accent-softer"]}">${esc(m.chip)}</text>`;
          cy += 28;
        }
        return out;
      })
      .join("");
    return `${frame}${head}${bubbles}`;
  }
  if (p.type === "terminal") {
    const bar = `<rect x="${x}" y="${y}" width="${w}" height="34" rx="14" fill="${t["--surface-2"]}"/><rect x="${x}" y="${y + 20}" width="${w}" height="14" fill="${t["--surface-2"]}"/>
${[0, 1, 2].map((i) => `<circle cx="${x + 20 + i * 14}" cy="${y + 17}" r="4.5" fill="${t["--chip"]}"/>`).join("")}<text x="${x + 70}" y="${y + 21}" font-size="11" font-family="${MONO}" fill="${t["--text-4"]}">${esc(p.title)}</text>`;
    const rows = p.lines
      .map((l, i) => {
        const ty = y + 66 + i * 28;
        const body = esc(l.text.replace(/^\s*[$#]\s*/, ""));
        if (l.kind === "command") return `<text x="${x + 20}" y="${ty}" font-size="13" font-family="${MONO}"><tspan fill="${t["--accent-soft"]}">$ </tspan><tspan fill="${t["--text"]}">${body}</tspan></text>`;
        return `<text x="${x + 20}" y="${ty}" font-size="13" font-family="${MONO}" fill="${l.kind === "comment" ? t["--text-4"] : t["--text-3"]}">${l.kind === "comment" ? "# " : ""}${body}</text>`;
      })
      .join("");
    return `${frame}${bar}${rows}`;
  }
  const n = p.items.length;
  const gap = 12;
  const ch = (h - 32 - gap * (n - 1)) / n;
  return p.items
    .map((it, i) => {
      const cy = y + 16 + i * (ch + gap);
      return `<rect x="${x}" y="${cy}" width="${w}" height="${ch}" rx="12" fill="${t["--surface"]}" stroke="${i === 0 ? t["--accent"] : t["--border-strong"]}"/>
<rect x="${x + 16}" y="${cy + ch / 2 - 14}" width="28" height="28" rx="7" fill="${t["--accent-bg"]}" stroke="${t["--accent-dim"]}"/><text x="${x + 30}" y="${cy + ch / 2 + 5}" text-anchor="middle" font-size="13" font-weight="700" fill="${t["--accent-soft"]}">${i + 1}</text>
<text x="${x + 58}" y="${cy + ch / 2 - (it.sub ? 3 : -5)}" font-size="14" font-weight="700" fill="${t["--text"]}">${esc(it.title)}</text>
${it.sub ? `<text x="${x + 58}" y="${cy + ch / 2 + 15}" font-size="11.5" fill="${t["--text-3"]}">${esc(it.sub)}</text>` : ""}`;
    })
    .join("");
}

/** A diagram on a card with a kicker title and an optional caption, as a standalone SVG. */
export function renderDiagramImage(fig: Figure, opts: { title: string; caption?: string; theme: Theme }): string {
  const t = opts.theme.tokens;
  const inner = renderFigure(fig, 1200);
  const vb = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(inner);
  const [fw, fh] = vb ? [Number(vb[1]), Number(vb[2])] : [1000, 400];
  const pad = 48;
  const top = 76;
  const width = W - pad * 2;
  const scale = Math.min(width / fw, 620 / fh);
  const dw = fw * scale;
  const dh = fh * scale;
  const caption = opts.caption ? wrap(opts.caption, 150, 2) : [];
  const H = Math.round(top + dh + 28 + caption.length * 18 + (caption.length ? 22 : 8));
  const nested = inner.replace(/^<svg /, `<svg x="${(W - dw) / 2}" y="${top}" width="${dw}" height="${dh}" `);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title)}">${themeStyle(opts.theme)}
${card(opts.theme, W, H)}
<text x="${pad}" y="46" font-size="12" font-weight="700" letter-spacing="2" fill="${t["--accent-soft"]}">${esc(opts.title.toUpperCase())}</text>
${nested}
${caption.map((l, i) => `<text x="${pad}" y="${top + dh + 34 + i * 18}" font-size="12.5" fill="${t["--text-3"]}">${esc(l)}</text>`).join("")}
</svg>`;
}

/** shields.io badge URLs (external images, allowed in README) for the stack found in the code. */
export function badgeMarkdown(badges: ReadmeVisuals["badges"]): string {
  const enc = (s: string) => encodeURIComponent(s.replace(/-/g, "--").replace(/_/g, "__"));
  return badges
    .map((b) => `![${b.label}](https://img.shields.io/badge/${enc(b.label)}-${enc(b.message)}-${b.color}${b.logo ? `?logo=${b.logo}&logoColor=white` : ""})`)
    .join("\n");
}
