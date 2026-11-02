import type { ThemeName } from "./spec";

/**
 * GitFill deck themes as CSS custom properties. The page stylesheet reads only these
 * tokens, so a theme is a complete recolouring. Accent colours come from the GitFill
 * mark (emerald #059669 → teal #2DD4BF); fonts are Geist, as in the GitFill app.
 */
export interface Theme {
  name: ThemeName;
  /** Body background outside the pages (screen preview only). */
  canvas: string;
  /** Hex without '#', for the .pptx slide background behind each page image. */
  background: string;
  tokens: Record<string, string>;
}

const shared = {
  "--font-sans": '"Geist", ui-sans-serif, system-ui, sans-serif',
  "--font-mono": '"Geist Mono", ui-monospace, monospace',
  "--radius": "6px",
  "--mark-radius": "5px",
};

export const THEME_DEFS: Record<ThemeName, Theme> = {
  midnight: {
    name: "midnight",
    canvas: "#030506",
    background: "070B0D",
    tokens: {
      "--bg": "#070b0d",
      "--bg-sidebar": "#090e10",
      "--surface": "#0c1214",
      "--surface-2": "#0f1618",
      "--surface-3": "#131b1e",
      "--chip": "#1f2a2d",
      "--border": "#1b2528",
      "--border-strong": "#29363b",
      "--grid": "#152024",
      "--divider": "#38484d",
      "--text": "#f4f7f6",
      "--text-2": "#d0dad8",
      "--text-3": "#97a8a5",
      "--text-4": "#728481",
      "--accent": "#14b8a6",
      "--accent-strong": "#0d9488",
      "--accent-soft": "#2dd4bf",
      "--accent-softer": "#99f6e4",
      "--accent-dim": "#1d5a52",
      "--accent-bg": "#0a1715",
      "--on-accent": "#ffffff",
      "--mark-bg": "linear-gradient(135deg, #059669, #2dd4bf)",
      "--ok": "#4ade80",
      "--ok-border": "#1f5c3a",
      "--warn": "#f59e0b",
      "--warn-soft": "#fcd34d",
      "--warn-border": "#6b4e12",
      "--warn-bg": "#17130a",
      "--danger": "#ef4444",
      "--danger-soft": "#fca5a5",
      "--danger-border": "#6b2525",
      "--danger-bg": "#1a0f11",
      "--info": "#7dd3fc",
      "--info-border": "#1e4a63",
      "--shadow": "0 24px 60px rgba(0,0,0,.55)",
      ...shared,
    },
  },
  daylight: {
    name: "daylight",
    canvas: "#e4eaea",
    background: "FFFFFF",
    tokens: {
      "--bg": "#ffffff",
      "--bg-sidebar": "#f8fafa",
      "--surface": "#f7f9f9",
      "--surface-2": "#f0f4f4",
      "--surface-3": "#e9efef",
      "--chip": "#d9e2e2",
      "--border": "#dfe7e7",
      "--border-strong": "#c7d3d3",
      "--grid": "#e3eaea",
      "--divider": "#a9b9b9",
      "--text": "#0b1416",
      "--text-2": "#273639",
      "--text-3": "#52666a",
      "--text-4": "#738587",
      "--accent": "#0d9488",
      "--accent-strong": "#0f766e",
      "--accent-soft": "#0d9488",
      "--accent-softer": "#115e59",
      "--accent-dim": "#8fd3c8",
      "--accent-bg": "#eefaf7",
      "--on-accent": "#ffffff",
      "--mark-bg": "linear-gradient(135deg, #059669, #2dd4bf)",
      "--ok": "#15803d",
      "--ok-border": "#9fd6b1",
      "--warn": "#d97706",
      "--warn-soft": "#b45309",
      "--warn-border": "#f0cd8f",
      "--warn-bg": "#fff8eb",
      "--danger": "#dc2626",
      "--danger-soft": "#b91c1c",
      "--danger-border": "#f1b3b3",
      "--danger-bg": "#fff2f2",
      "--info": "#0369a1",
      "--info-border": "#a9d4ee",
      "--shadow": "0 18px 44px rgba(15,40,40,.16)",
      ...shared,
    },
  },
};

export function getTheme(name: ThemeName): Theme {
  return THEME_DEFS[name];
}

export function themeCss(theme: Theme): string {
  return `:root{${Object.entries(theme.tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}\nhtml,body{background:${theme.canvas}}`;
}
