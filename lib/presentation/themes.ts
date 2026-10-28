import type { ThemeName } from "./spec";

export interface Theme {
  name: ThemeName;
  /** Hex colors without '#', as PptxGenJS expects. */
  colors: {
    background: string;
    surface: string;
    surfaceAlt: string;
    border: string;
    text: string;
    textMuted: string;
    accent: string;
    accentAlt: string;
    accentText: string;
    connector: string;
  };
  fonts: { heading: string; body: string; mono: string };
  /** Font sizes in points. */
  sizes: { display: number; title: number; subtitle: number; body: number; bodyMin: number; small: number; caption: number };
}

/**
 * Calibri and Courier New are native in PowerPoint and have metric-compatible
 * substitutes (Carlito, Liberation Mono) on Linux, so renders match PowerPoint layout.
 */
const fonts = { heading: "Calibri", body: "Calibri", mono: "Courier New" };
const sizes = { display: 44, title: 30, subtitle: 18, body: 18, bodyMin: 12, small: 13, caption: 11 };

export const THEME_DEFS: Record<ThemeName, Theme> = {
  midnight: {
    name: "midnight",
    colors: {
      background: "0B1020",
      surface: "141B2E",
      surfaceAlt: "1C2540",
      border: "2A3556",
      text: "E8ECF6",
      textMuted: "9AA6C4",
      accent: "5B8CFF",
      accentAlt: "2BD4A4",
      accentText: "0B1020",
      connector: "6E7FAE",
    },
    fonts,
    sizes,
  },
  daylight: {
    name: "daylight",
    colors: {
      background: "FFFFFF",
      surface: "F3F5FA",
      surfaceAlt: "E7EBF5",
      border: "CBD3E6",
      text: "111827",
      textMuted: "5B6478",
      accent: "2F5BEA",
      accentAlt: "0E9F77",
      accentText: "FFFFFF",
      connector: "7A869E",
    },
    fonts,
    sizes,
  },
};

export function getTheme(name: ThemeName): Theme {
  return THEME_DEFS[name];
}
