/**
 * Conservative text measurement for Calibri/Carlito. Used to pick font sizes before
 * rendering; the rendered PDF is then checked to confirm the estimate held.
 */

export interface Paragraph {
  text: string;
  bullet?: boolean;
  bold?: boolean;
  /** Relative size multiplier for this paragraph. */
  scale?: number;
  color?: string;
}

const AVG_CHAR_EM = 0.5;
const BOLD_CHAR_EM = 0.54;
const LINE_HEIGHT = 1.2;
const PARA_GAP_EM = 0.45;
const BULLET_INDENT_IN = 0.3;
/** PptxGenJS default text box insets (0.1in each side). */
export const TEXT_INSET_IN = 0.1;

export function estimateLines(text: string, fontPt: number, widthIn: number, bold = false): number {
  const usableIn = Math.max(widthIn, 0.2);
  const charWidthIn = (fontPt * (bold ? BOLD_CHAR_EM : AVG_CHAR_EM)) / 72;
  const charsPerLine = Math.max(1, Math.floor(usableIn / charWidthIn));
  let lines = 0;
  for (const hard of text.split("\n")) {
    // Word wrap: a word that does not fit starts a new line.
    let current = 0;
    let count = 1;
    for (const word of hard.split(/\s+/).filter(Boolean)) {
      const len = word.length;
      if (current === 0) current = len;
      else if (current + 1 + len <= charsPerLine) current += 1 + len;
      else {
        count++;
        current = len;
      }
      while (current > charsPerLine) {
        count++;
        current -= charsPerLine;
      }
    }
    lines += count;
  }
  return lines;
}

export function estimateHeightIn(paragraphs: Paragraph[], fontPt: number, boxWidthIn: number, insetIn = TEXT_INSET_IN): number {
  const inner = boxWidthIn - 2 * insetIn;
  let heightPt = 0;
  paragraphs.forEach((p, i) => {
    const size = fontPt * (p.scale ?? 1);
    const width = inner - (p.bullet ? BULLET_INDENT_IN : 0);
    heightPt += estimateLines(p.text, size, width, p.bold) * size * LINE_HEIGHT;
    if (i < paragraphs.length - 1) heightPt += size * PARA_GAP_EM;
  });
  return heightPt / 72 + 2 * insetIn;
}

/** Largest font size in [minPt, maxPt] (whole points) whose estimated height fits the box. */
export function fitFontSize(paragraphs: Paragraph[], boxWidthIn: number, boxHeightIn: number, maxPt: number, minPt: number, insetIn = TEXT_INSET_IN) {
  for (let size = maxPt; size >= minPt; size--) {
    if (estimateHeightIn(paragraphs, size, boxWidthIn, insetIn) <= boxHeightIn) return { fontPt: size, fits: true };
  }
  return { fontPt: minPt, fits: false };
}

export const PARA_SPACING_PT = (fontPt: number) => Math.round(fontPt * PARA_GAP_EM);
