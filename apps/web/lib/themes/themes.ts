/*
  The theme catalog (docs/19).

  Every theme is a small set of CSS-variable overrides for BOTH modes, applied
  at runtime on top of the base tokens in globals.css — so a user with no
  preference gets byte-identical rendering to the pre-engine app. The router
  validates `themeName` against this catalog, so a theme that does not exist
  here cannot be persisted.
*/

export type ThemeName = "drafting-ink" | "field-amber" | "concrete";

export type ThemeDef = {
  name: ThemeName;
  label: string;
  description: string;
  /* Accent swatches for the preview card, both modes. */
  swatch: { light: string; dark: string };
  light: Record<string, string>;
  dark: Record<string, string>;
};

export const THEMES: Record<ThemeName, ThemeDef> = {
  /* The original palette — drafting ink on paper. Default, so it carries no
     overrides: the base tokens ARE this theme. */
  "drafting-ink": {
    name: "drafting-ink",
    label: "Drafting Ink",
    description: "The original look. Deep blue-teal ink on near-white paper.",
    swatch: { light: "oklch(0.505 0.093 227)", dark: "oklch(0.715 0.105 222)" },
    light: {},
    dark: {},
  },
  /* A warm, high-visibility variant — the safety-vest palette of the yard. */
  "field-amber": {
    name: "field-amber",
    label: "Field Amber",
    description: "Amber primary with warm paper. Built for bright daylight.",
    swatch: { light: "oklch(0.63 0.16 65)", dark: "oklch(0.8 0.14 70)" },
    light: {
      "--primary": "oklch(0.55 0.14 65)",
      "--primary-foreground": "oklch(0.99 0.01 65)",
      "--ring": "oklch(0.55 0.14 65)",
      "--accent": "oklch(0.94 0.03 70)",
      "--accent-foreground": "oklch(0.35 0.08 65)",
      "--sidebar": "oklch(0.945 0.02 70)",
      "--sidebar-accent": "oklch(0.91 0.03 68)",
      "--radius": "0.5rem",
    },
    dark: {
      "--primary": "oklch(0.78 0.13 70)",
      "--primary-foreground": "oklch(0.2 0.04 65)",
      "--ring": "oklch(0.78 0.13 70)",
      "--accent": "oklch(0.32 0.06 68)",
      "--accent-foreground": "oklch(0.92 0.05 70)",
      "--radius": "0.5rem",
    },
  },
  /* A cool slate variant — the concrete of the drawings. */
  concrete: {
    name: "concrete",
    label: "Concrete",
    description: "Slate blue primary with cool neutrals. Quiet and structural.",
    swatch: { light: "oklch(0.48 0.06 250)", dark: "oklch(0.72 0.07 250)" },
    light: {
      "--primary": "oklch(0.45 0.055 250)",
      "--primary-foreground": "oklch(0.99 0.002 250)",
      "--ring": "oklch(0.45 0.055 250)",
      "--accent": "oklch(0.93 0.012 250)",
      "--accent-foreground": "oklch(0.3 0.03 250)",
      "--sidebar": "oklch(0.945 0.012 250)",
      "--sidebar-accent": "oklch(0.9 0.016 248)",
      "--radius": "0.25rem",
    },
    dark: {
      "--primary": "oklch(0.72 0.07 250)",
      "--primary-foreground": "oklch(0.18 0.02 250)",
      "--ring": "oklch(0.72 0.07 250)",
      "--accent": "oklch(0.3 0.03 248)",
      "--accent-foreground": "oklch(0.9 0.02 250)",
      "--radius": "0.25rem",
    },
  },
};

export const FONT_FAMILIES = {
  system: "ui-sans-serif, system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', monospace",
} as const;

export type FontFamilyName = keyof typeof FONT_FAMILIES;

export const FONT_SCALES = ["0.9", "1.0", "1.1", "1.2"] as const;

export type Density = "comfortable" | "compact";

export type ThemePrefs = {
  themeName: ThemeName;
  fontFamily: FontFamilyName;
  fontScale: string;
  density: Density;
  dashboard: { widgets: Record<string, boolean> };
};

export const DEFAULT_PREFS: ThemePrefs = {
  themeName: "drafting-ink",
  fontFamily: "system",
  fontScale: "1.0",
  density: "comfortable",
  dashboard: { widgets: {} },
};
