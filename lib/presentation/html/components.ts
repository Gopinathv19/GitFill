import { ICONS, type IconName } from "../icons";
import type { Block, CoverSlide } from "../spec";
import { esc, renderFigure } from "./diagrams";

/**
 * Block components. Each returns an HTML string sized for the column it sits in; `width`
 * is that column's width in CSS px, used to pick how many grid columns fit. Text from the
 * spec goes through `inline()`, which escapes it and allows only **bold** and `code`.
 */

export function inline(text: string | undefined, opts: { accent?: boolean } = {}): string {
  if (!text) return "";
  let out = esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  if (opts.accent) out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return out;
}

export function icon(name: IconName, size = 16, stroke = 1.9): string {
  const d = ICONS[name] ?? ICONS.box;
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="${d}"/></svg>`;
}

const iconTile = (name: IconName, plain = false) => `<span class="icon-tile ${plain ? "plain" : ""}">${icon(name)}</span>`;

const STATUS_VIEW = {
  implemented: { label: "Implemented", cls: "ok" },
  partial: { label: "Partial", cls: "warn" },
  planned: { label: "Planned", cls: "accent" },
  unverified: { label: "Unverified", cls: "ghost" },
} as const;

export function status(key: keyof typeof STATUS_VIEW | undefined): string {
  if (!key) return "";
  const s = STATUS_VIEW[key];
  return `<span class="badge ${s.cls}"><span class="dot"></span>${s.label}</span>`;
}

/** Most grid columns that fit `width` at `min` px each, never more than requested or than items. */
function fitColumns(requested: number, items: number, width: number, min: number): number {
  const max = Math.max(1, Math.min(requested, items, Math.floor(width / min)));
  // Prefer a count that leaves no ragged last row, when one is close.
  for (let c = max; c >= Math.max(2, max - 1); c--) if (items % c === 0) return c;
  return max;
}

const panel = (title: string | undefined, body: string, hint?: string) =>
  `<div class="panel">${title ? `<div class="ph">${inline(title)}${hint ? `<span class="hint">${inline(hint)}</span>` : ""}</div>` : ""}<div class="pb">${body}</div></div>`;

const blockTitle = (t?: string) => (t ? `<span class="label block-title">${inline(t)}</span>` : "");

export interface FigureCounter {
  n: number;
}

/** Uploaded images as data URIs keyed by asset id. */
export type ImageMap = ReadonlyMap<string, string>;

const windowBar = (title = "") => `<div class="w-bar"><i></i><i></i><i></i>${title ? `<span>${esc(title)}</span>` : ""}</div>`;

/** A screenshot or picture in its frame. The image keeps its aspect ratio inside the box. */
function shot(src: string | undefined, frame: "browser" | "device" | "plain", fit: "contain" | "cover", alt: string): string {
  const img = src ? `<img src="${src}" alt="${esc(alt)}" style="object-fit:${fit}"/>` : `<div class="shot-missing">Image not available</div>`;
  if (frame === "browser") return `<div class="shot frame-browser">${windowBar()}<div class="shot-img">${img}</div></div>`;
  if (frame === "device") return `<div class="shot frame-device"><div class="shot-img">${img}</div></div>`;
  return `<div class="shot frame-plain"><div class="shot-img">${img}</div></div>`;
}

export function renderBlock(b: Block, width: number, figs: FigureCounter, images?: ImageMap): string {
  switch (b.type) {
    case "cards": {
      const cols = fitColumns(b.columns, b.items.length, width, 170);
      return `<div class="grid g${cols}">${b.items
        .map(
          (c) => `<div class="card ${c.emphasis ? "accent" : ""}"><div class="card-top">${iconTile(c.icon)}${status(c.status)}</div><h3>${inline(c.title)}</h3><p>${inline(c.text)}</p></div>`,
        )
        .join("")}</div>`;
    }
    case "stats": {
      const cols = fitColumns(b.items.length, b.items.length, width, 140);
      return `<div class="stats" style="grid-template-columns:repeat(${cols},1fr)">${b.items
        .map((s) => `<div class="stat"><span class="k">${inline(s.label)}</span><span class="v">${esc(s.value)}${s.unit ? `<small>${esc(s.unit)}</small>` : ""}</span>${s.note ? `<span class="s">${inline(s.note)}</span>` : ""}</div>`)
        .join("")}</div>`;
    }
    case "steps": {
      const vertical = b.direction === "vertical" || width / b.items.length < 150;
      const steps = `<div class="steps ${vertical ? "v" : "h"}">${b.items
        .map((s, i) => `<div class="step">${!vertical && i < b.items.length - 1 ? `<i class="conn"></i>` : ""}<span class="sn">${String(i + 1).padStart(2, "0")}</span><div><h3>${inline(s.title)}</h3><p>${inline(s.text)}</p></div></div>`)
        .join("")}</div>`;
      return b.title ? panel(b.title, steps) : steps;
    }
    case "table": {
      const hl = (i: number) => (b.highlightColumn === i ? "hl" : "");
      const cell = (v: string, i: number) => {
        const t = v.trim().toLowerCase();
        if (t === "yes" || t === "✓" || t === "true")
          return `<td class="c ${hl(i)}"><span class="yes"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" style="display:inline-block;vertical-align:-2px" aria-label="yes"><path d="M5 12l5 5 9-10"/></svg></span></td>`;
        if (t === "no" || t === "—" || t === "-" || t === "false") return `<td class="c ${hl(i)}"><span class="no">—</span></td>`;
        return `<td class="${hl(i)}">${inline(v)}</td>`;
      };
      const table = `<table class="matrix"><thead><tr><th></th>${b.columns.map((c, i) => `<th class="${hl(i)}">${inline(c)}</th>`).join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr><th>${inline(r.head)}</th>${r.cells.map(cell).join("")}</tr>`)
        .join("")}</tbody></table>`;
      return b.title ? `${blockTitle(b.title)}${table}` : table;
    }
    case "list":
      return panel(
        b.title,
        `<ul class="bullets">${b.items.map((i) => `<li><i class="bul"></i><span>${inline(i.text)}</span>${status(i.status)}</li>`).join("")}</ul>`,
        b.hint,
      );
    case "callout": {
      const label = b.label ?? (b.tone === "limit" ? "Limits" : b.tone === "note" ? "Note" : "Key takeaway");
      return `<div class="takeaway ${b.tone === "takeaway" ? "" : b.tone}"><i class="bar"></i><div><span class="label">${inline(label)}</span><p>${inline(b.text)}</p></div></div>`;
    }
    case "explain": {
      const cells = [
        `<div><span class="label">Purpose</span><p>${inline(b.purpose)}</p></div>`,
        `<div><span class="label">How it behaves</span><p>${inline(b.behavior)}</p></div>`,
        `<div><span class="label">Why it matters</span><p>${inline(b.value)}</p></div>`,
        b.limits ? `<div class="limit"><span class="label">Limits</span><p>${inline(b.limits)}</p></div>` : "",
      ];
      const wide = width > 900;
      const style = wide ? ` style="grid-template-columns:repeat(${b.limits ? 4 : 3},1fr)"` : "";
      return `<div class="explain ${!wide && !b.limits ? "odd" : ""}"${style}>${cells.join("")}</div>`;
    }
    case "components": {
      const cols = fitColumns(b.columns, b.items.length, width, 250);
      return `<div class="grid g${cols}">${b.items
        .map(
          (c) =>
            `<div class="card"><div class="resp">${iconTile(c.icon, true)}<h3>${inline(c.name)}</h3>${c.role ? `<span class="who">${inline(c.role)}</span>` : "<span></span>"}<p>${inline(c.text)}</p></div>${c.tech ? `<span class="tech">${esc(c.tech)}</span>` : ""}</div>`,
        )
        .join("")}</div>`;
    }
    case "code":
      return `<div class="codebox">${windowBar(b.title)}<pre>${b.lines.map(esc).join("\n")}</pre>${b.caption ? `<div class="cap">${inline(b.caption)}</div>` : ""}</div>`;
    case "flashcards": {
      const cols = fitColumns(4, b.items.length, width, 230);
      return `<div class="grid g${cols}" style="grid-auto-rows:1fr">${b.items
        .map((c, i) => `<div class="flash"><div class="q"><span class="label">Q${String(i + 1).padStart(2, "0")}</span><p>${inline(c.q)}</p></div><div class="a"><span class="label">A</span>${inline(c.a)}</div></div>`)
        .join("")}</div>`;
    }
    case "glossary": {
      const cols = width > 900 ? 3 : width > 520 ? 2 : 1;
      return `<div class="glossary c${cols}"><dl>${b.items
        .map((t) => `<div class="gl"><dt>${inline(t.term)}${t.code ? ` <code>${esc(t.code)}</code>` : ""}</dt><dd>${inline(t.def)}</dd></div>`)
        .join("")}</dl></div>`;
    }
    case "diagram": {
      figs.n += 1;
      return `<div class="figure"><div class="fig-h"><span class="fig-n">FIG ${String(figs.n).padStart(2, "0")}</span><h2>${inline(b.title)}</h2>${b.hint ? `<span class="hint">${inline(b.hint)}</span>` : ""}</div><div class="canvas">${renderFigure(b.figure, width)}</div></div>`;
    }
    case "image": {
      const head = b.title ? `<div class="fig-h"><h2>${inline(b.title)}</h2></div>` : "";
      return `<div class="figure image">${head}${shot(images?.get(b.assetId), b.frame, b.fit, b.caption ?? b.title ?? "")}${b.caption ? `<p class="caption">${inline(b.caption)}</p>` : ""}</div>`;
    }
  }
}

export function renderCoverVisual(v: CoverSlide["visual"], art: string | undefined, images?: ImageMap): string {
  switch (v.type) {
    case "terminal":
      return `<div class="window">${windowBar(v.title)}<div class="term">${v.lines
        // The prompt glyphs are added here; drop any the model typed itself.
        .map((l) =>
          l.kind === "command"
            ? `<div class="ln command"><span class="pr">$ </span>${esc(l.text.replace(/^\s*\$\s*/, ""))}</div>`
            : l.kind === "comment"
              ? `<div class="ln comment"># ${esc(l.text.replace(/^\s*#+\s*/, ""))}</div>`
              : `<div class="ln output">${esc(l.text)}</div>`,
        )
        .join("")}</div></div>`;
    case "tree":
      return `<div class="window">${windowBar(v.title)}<div class="tree">${v.items
        .map((i) => `<div class="row"><span class="p"><span class="pr">▸ </span>${esc(i.path)}</span>${i.note ? `<span class="n">${inline(i.note)}</span>` : ""}</div>`)
        .join("")}</div></div>`;
    case "image":
      return `<div class="cover-shot">${shot(images?.get(v.assetId), "browser", "cover", v.caption ?? "")}${v.caption ? `<p class="caption">${inline(v.caption)}</p>` : ""}</div>`;
    case "stats":
      return `<div class="cover-stats">${v.items
        .map((s) => `<div class="stat"><span class="k">${inline(s.label)}</span><span class="v">${esc(s.value)}${s.unit ? `<small>${esc(s.unit)}</small>` : ""}</span></div>`)
        .join("")}</div>`;
    case "art":
      return art ? `<div class="cover-art"><img src="${art}" alt=""/></div>` : "";
  }
}
