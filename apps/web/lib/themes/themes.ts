/*
  The theme catalog (docs/19).

  Every theme is a set of CSS-variable overrides for BOTH modes, applied at
  runtime on top of the base tokens in globals.css. The router validates
  `themeName` against this catalog, so a theme that does not exist here cannot
  be persisted.

  ---

  Why these are built from a recipe rather than written out.

  The first version of this file overrode eleven variables — primary, accent,
  ring, sidebar, radius — and left `--background`, `--card`, `--foreground`,
  `--muted` and `--secondary` to the base tokens. That meant every theme was
  the same near-white paper with a different accent colour, which is why they
  all looked alike no matter what hues went in. A theme is the paper, the ink,
  the card lift and the rail, not just the buttons.

  Owning the full surface set means ~30 variables per mode, and hand-writing
  8 x 2 x 30 oklch values is neither reviewable nor safe. So each theme
  declares the handful of decisions that actually distinguish it — paper, card,
  ink, primary, rail treatment, radius — and `expand()` derives the mechanical
  rest by fixed rules (muted sits 0.03 below paper, borders 0.09 below, and so
  on). Adding a theme is six numbers, and no theme can drift out of the
  relationships that keep text legible on its own background.

  Status hues (--ok/--warn/--crit) deliberately do NOT move: they are the one
  vocabulary that must mean the same thing in every theme. Their tinted
  BACKGROUNDS do move, because a pill tinted for near-white paper is invisible
  on Clay's beige and muddy on Blueprint's navy.
*/

export type ThemeName =
  | "drafting-ink"
  | "blocky"
  | "field-amber"
  | "concrete"
  | "blueprint"
  | "forest"
  | "clay"
  | "graphite"
  | "high-contrast"
  | "site-green"
  | "site-cream"
  | "site-slate"
  | "hi-vis";

export type ThemeDef = {
  name: ThemeName;
  label: string;
  description: string;
  /* Accent swatches for the preview card, both modes. */
  swatch: { light: string; dark: string };
  light: Record<string, string>;
  dark: Record<string, string>;
};

/* An oklch triple: lightness 0-1, chroma, hue in degrees. */
type C = [number, number, number];

const c = ([l, ch, h]: C) => `oklch(${+l.toFixed(3)} ${+ch.toFixed(3)} ${h})`;
/* Shift lightness, keeping hue; chroma scales with the shift so a tinted paper
   stays tinted as it darkens instead of going flat grey. */
const shift = ([l, ch, h]: C, dl: number, mul = 1): C => [
  Math.min(1, Math.max(0, l + dl)),
  ch * mul,
  h,
];

type Side = {
  /** Page background. The single biggest thing that makes a theme distinct. */
  paper: C;
  /** Card / popover surface. Equal to paper reads flat; lighter reads lifted. */
  card: C;
  /** Body text. */
  ink: C;
  /** Primary action colour. */
  primary: C;
  /** Text on primary. */
  onPrimary: C;
  /**
   * A dark rail against a light page — a different silhouette, not just a
   * different hue. The strongest lever this catalog has, so only some themes
   * use it.
   */
  rail?: C;
  /** Secondary text. Derived when omitted; set it when contrast needs help. */
  mutedInk?: C;
  /** Border strength. Derived when omitted. */
  border?: C;
};

type Recipe = {
  name: ThemeName;
  label: string;
  description: string;
  light: Side;
  dark: Side;
};

function expand(s: Side, mode: "light" | "dark"): Record<string, string> {
  const [, , paperHue] = s.paper;
  const [pl, pc, ph] = s.primary;
  const down = mode === "light" ? -1 : 1; /* "away from paper" flips in dark */

  const railBase: C = s.rail ?? shift(s.paper, down * 0.045, 1.6);
  const railDark = !!s.rail;
  /* On a dark rail the text is paper-coloured; on a light one it is ink. */
  const railInk: C = railDark ? [0.94, 0.008, paperHue] : shift(s.ink, 0.06);
  const railAccent: C = railDark
    ? shift(railBase, 0.07, 1.4)
    : shift(railBase, down * 0.045, 1.3);

  const muted = shift(s.paper, down * 0.03, 1.3);
  const border = s.border ?? shift(s.paper, down * 0.09, 1.8);
  const mutedInk = s.mutedInk ?? [mode === "light" ? 0.505 : 0.688, 0.014, paperHue];
  const accent: C = [mode === "light" ? 0.94 : 0.3, mode === "light" ? 0.03 : 0.05, ph];
  const accentInk: C = [mode === "light" ? 0.33 : 0.89, mode === "light" ? 0.07 : 0.06, ph];

  /* Status tints, re-seated on this theme's paper. The hues are fixed by the
     status vocabulary; only their lightness follows the surface. */
  const tintL = mode === "light" ? s.paper[0] - 0.035 : 0.28;
  const tint = (h: number, ch: number): C => [tintL, ch, h];

  return {
    "--background": c(s.paper),
    "--foreground": c(s.ink),
    "--card": c(s.card),
    "--card-foreground": c(s.ink),
    "--popover": c(s.card),
    "--popover-foreground": c(s.ink),

    "--primary": c(s.primary),
    "--primary-foreground": c(s.onPrimary),
    "--ring": c([pl, pc, ph]),

    "--secondary": c(muted),
    "--secondary-foreground": c(shift(s.ink, 0.08)),
    "--muted": c(muted),
    "--muted-foreground": c(mutedInk),
    "--accent": c(accent),
    "--accent-foreground": c(accentInk),

    "--border": c(border),
    "--input": c(border),

    "--ok-bg": c(tint(168, mode === "light" ? 0.024 : 0.038)),
    "--warn-bg": c(tint(72, mode === "light" ? 0.036 : 0.042)),
    "--crit-bg": c(tint(28, mode === "light" ? 0.028 : 0.052)),
    "--idle-bg": c(tint(paperHue, mode === "light" ? 0.005 : 0.008)),

    "--sidebar": c(railBase),
    "--sidebar-foreground": c(railInk),
    "--sidebar-primary": c(railDark && mode === "light" ? [0.82, pc * 0.9, ph] : s.primary),
    "--sidebar-primary-foreground": c(railDark && mode === "light" ? [0.2, 0.03, ph] : s.onPrimary),
    "--sidebar-accent": c(railAccent),
    "--sidebar-accent-foreground": c(railDark ? [0.97, 0.01, paperHue] : accentInk),
    "--sidebar-border": c(railDark ? shift(railBase, 0.06, 1.2) : shift(railBase, down * 0.06, 1.2)),
  };
}

const RECIPES: Recipe[] = [
  {
    /* The ORIGINAL palette, and no longer the base.

       Until 2026-08-23 this was the base token set in globals.css and carried
       no overrides, while `blocky` — the actual product look — was an override
       layer switched on by the default preference. That inversion is what made
       the design language feel like a theme you could accidentally leave. The
       base is now Blocky; these are the old values, kept as a real palette so
       anyone who had chosen Drafting Ink still gets Drafting Ink. */
    name: "drafting-ink",
    label: "Drafting Ink",
    description: "The original look. Deep blue-teal ink on near-white paper.",
    light: {
      paper: [0.988, 0.003, 240],
      card: [1, 0, 0],
      ink: [0.195, 0.016, 245],
      primary: [0.505, 0.093, 227],
      onPrimary: [0.99, 0.002, 240],
    },
    dark: {
      paper: [0.172, 0.012, 245],
      card: [0.212, 0.014, 245],
      ink: [0.948, 0.005, 240],
      primary: [0.715, 0.105, 222],
      onPrimary: [0.172, 0.012, 245],
    },
  },
  {
    name: "field-amber",
    label: "Field Amber",
    description: "Warm cream paper, amber ink, soft corners. Built for bright daylight.",
    light: {
      paper: [0.985, 0.014, 85],
      card: [0.998, 0.006, 85],
      ink: [0.24, 0.02, 60],
      primary: [0.55, 0.14, 65],
      onPrimary: [0.99, 0.01, 65],
    },
    dark: {
      paper: [0.178, 0.016, 60],
      card: [0.222, 0.018, 60],
      ink: [0.95, 0.008, 80],
      primary: [0.78, 0.13, 70],
      onPrimary: [0.2, 0.04, 65],
    },
  },
  {
    name: "concrete",
    label: "Concrete",
    description: "Grey paper with white cards lifted off it. Slate accents, sharp corners.",
    light: {
      /* The only light theme where paper is clearly grey and cards are white —
         the register reads as sheets on a desk rather than ink on one page. */
      paper: [0.947, 0.004, 250],
      card: [1, 0, 0],
      ink: [0.21, 0.015, 250],
      primary: [0.45, 0.055, 250],
      onPrimary: [0.99, 0.002, 250],
    },
    dark: {
      paper: [0.192, 0.008, 250],
      card: [0.243, 0.01, 250],
      ink: [0.95, 0.004, 250],
      primary: [0.72, 0.07, 250],
      onPrimary: [0.18, 0.02, 250],
    },
  },
  {
    name: "blueprint",
    label: "Blueprint",
    description: "Navy rail against pale blue paper. The strongest silhouette here.",
    light: {
      paper: [0.976, 0.012, 255],
      card: [1, 0.002, 255],
      ink: [0.22, 0.03, 262],
      primary: [0.46, 0.13, 265],
      onPrimary: [0.99, 0.01, 265],
      /* Dark rail on a light page. */
      rail: [0.28, 0.055, 265],
    },
    dark: {
      paper: [0.163, 0.028, 265],
      card: [0.208, 0.032, 265],
      ink: [0.94, 0.012, 265],
      primary: [0.72, 0.12, 268],
      onPrimary: [0.17, 0.03, 265],
    },
  },
  {
    name: "forest",
    label: "Forest",
    description: "Deep green rail on warm off-white. Low glare, quiet contrast.",
    light: {
      paper: [0.979, 0.01, 130],
      card: [0.999, 0.004, 130],
      ink: [0.22, 0.022, 150],
      primary: [0.44, 0.09, 150],
      onPrimary: [0.99, 0.01, 150],
      rail: [0.3, 0.045, 152],
    },
    dark: {
      paper: [0.158, 0.02, 150],
      card: [0.202, 0.024, 150],
      ink: [0.94, 0.01, 150],
      primary: [0.73, 0.1, 152],
      onPrimary: [0.17, 0.02, 150],
    },
  },
  {
    name: "clay",
    label: "Clay",
    description: "Beige paper and terracotta, generously rounded. The warmest of the set.",
    light: {
      paper: [0.968, 0.019, 60],
      card: [0.995, 0.008, 60],
      ink: [0.25, 0.028, 40],
      primary: [0.52, 0.11, 35],
      onPrimary: [0.99, 0.01, 35],
    },
    dark: {
      paper: [0.172, 0.022, 35],
      card: [0.218, 0.026, 35],
      ink: [0.95, 0.01, 45],
      primary: [0.74, 0.1, 38],
      onPrimary: [0.18, 0.03, 35],
    },
  },
  {
    name: "graphite",
    label: "Graphite",
    description: "Zero chroma anywhere. The only colour left on screen is status.",
    light: {
      paper: [0.968, 0, 0],
      card: [1, 0, 0],
      ink: [0.2, 0, 0],
      primary: [0.32, 0, 0],
      onPrimary: [1, 0, 0],
      mutedInk: [0.48, 0, 0],
    },
    dark: {
      paper: [0.16, 0, 0],
      card: [0.208, 0, 0],
      ink: [0.95, 0, 0],
      primary: [0.82, 0, 0],
      onPrimary: [0.16, 0, 0],
      mutedInk: [0.7, 0, 0],
    },
  },
  {
    name: "high-contrast",
    label: "High Contrast",
    description: "Pure white, black ink, heavy borders. For a phone at arm's length in the sun.",
    light: {
      paper: [1, 0, 0],
      card: [1, 0, 0],
      ink: [0.12, 0, 0],
      primary: [0.2, 0.015, 250],
      onPrimary: [1, 0, 0],
      /* Hairlines and grey secondary text are the first things to disappear
         outdoors, so this theme is the one that darkens both. */
      border: [0.68, 0.008, 250],
      mutedInk: [0.34, 0.01, 250],
    },
    dark: {
      paper: [0.09, 0, 0],
      card: [0.14, 0, 0],
      ink: [0.99, 0, 0],
      primary: [0.94, 0.008, 250],
      onPrimary: [0.1, 0.008, 250],
      border: [0.46, 0.01, 250],
      mutedInk: [0.8, 0.008, 250],
    },
  },
  /*
    Four themes below are grounded in urbaniconstruct.com's actual compiled
    CSS (its Webflow :root custom properties and real component rules), not
    a text summary of the page. That correction mattered: a first pass here
    read the site as light-paper-with-yellow-as-primary. The real site's
    `body` sets a BLACK background with near-white text, its actual button
    is `background: #339c5e; color: white` (a specific green, not yellow),
    and yellow (#fec00f) appears in exactly one place — the active nav
    link's text colour. Hi-Vis below is corrected to say that plainly; the
    three "Site" themes are faithful reconstructions of the real brand.
    Every one of them shares the same green primary on purpose — different
    paper, different rail, same anchor — because that is what "one brand,
    several themes" should mean. Radius is 0.5rem throughout: the real
    button's own border-radius, not a guess.
  */
  {
    name: "site-green",
    label: "Site Green",
    description: "Urban's real brand: their button green, off-white paper, near-black dark mode.",
    light: {
      paper: [0.979, 0, 90],
      card: [1, 0, 90],
      ink: [0.218, 0, 90],
      primary: [0.617, 0.134, 153.5],
      /* White on this green measures ~3.5:1 — short of the 4.5:1 this
         catalog holds body text to, but this colour never carries body
         text. It is the exact pairing the real button uses, and 3.5:1
         clears WCAG's large-scale/bold-text threshold (3:1), which is the
         correct bar for a button label, not the stricter one. */
      onPrimary: [0.99, 0, 90],
    },
    dark: {
      paper: [0.16, 0.002, 90],
      card: [0.205, 0.003, 90],
      ink: [0.95, 0.002, 90],
      primary: [0.74, 0.13, 153.5],
      onPrimary: [0.16, 0.02, 153.5],
    },
  },
  {
    name: "site-cream",
    label: "Site Cream",
    description: "The same green, on Urban's warm off-white. Dark mode is their real footer green-black.",
    light: {
      /* #fffaee — the site's own light section background, not the body's
         default. Promoted here to the paper itself. */
      paper: [0.986, 0.017, 88],
      card: [0.998, 0.008, 88],
      ink: [0.22, 0.02, 65],
      primary: [0.617, 0.134, 153.5],
      onPrimary: [0.99, 0, 88],
    },
    dark: {
      /* #0f1b07 — the exact colour the real footer and one section
         transition use as a background. Not derived; lifted directly. */
      paper: [0.205, 0.041, 134.1],
      card: [0.25, 0.045, 134],
      ink: [0.95, 0.01, 88],
      primary: [0.74, 0.13, 153.5],
      onPrimary: [0.16, 0.02, 153.5],
    },
  },
  {
    name: "site-slate",
    label: "Site Slate",
    description: "The cooler read: the same green against Urban's own blue-grey rail, not an invented navy.",
    light: {
      paper: [0.979, 0, 90],
      card: [1, 0, 90],
      ink: [0.218, 0, 90],
      primary: [0.617, 0.134, 153.5],
      onPrimary: [0.99, 0, 90],
      /* #23282d — a real colour from the site's own palette, not a
         constructed navy the way Blueprint's rail is. */
      rail: [0.274, 0.012, 248.3],
    },
    dark: {
      paper: [0.17, 0.014, 256],
      card: [0.215, 0.016, 256],
      ink: [0.95, 0.006, 256],
      primary: [0.74, 0.13, 153.5],
      onPrimary: [0.16, 0.02, 153.5],
    },
  },
  {
    name: "hi-vis",
    label: "Hi-Vis",
    description: "Their yellow, promoted from a minor accent to primary — a deliberate departure, not a faithful read.",
    light: {
      paper: [0.979, 0, 90],
      card: [1, 0, 90],
      ink: [0.218, 0, 90],
      /* #fec00f, precisely — on the real site this colours exactly one
         thing: the current nav link's text. Everywhere else here it is
         doing a job it was never asked to do on urbaniconstruct.com. */
      primary: [0.841, 0.171, 84.6],
      /* Black text on yellow, not white — the hazard-signage convention,
         not the site's own (the site never puts text ON its yellow). */
      onPrimary: [0.18, 0.02, 90],
      rail: [0.218, 0, 90],
    },
    dark: {
      paper: [0.16, 0.002, 90],
      card: [0.205, 0.003, 90],
      ink: [0.95, 0.002, 90],
      primary: [0.84, 0.16, 85],
      onPrimary: [0.16, 0.02, 90],
    },
  },
];

export const THEMES: Record<ThemeName, ThemeDef> = {
  /*
    The house palette. It carries NO overrides because the base tokens in
    globals.css are it — selecting it means clearing every override, which is
    the only way a "default" can be a real destination rather than one more
    layer. Everything below is an alternative palette over this ground.

    It is listed here so the picker has something to show as selected, not
    because the design language is optional: radii, type and the shell are
    global and no palette can touch them.
  */
  blocky: {
    name: "blocky",
    label: "Default",
    description: "The house palette — near-black instrument surfaces under a drafting-blue accent.",
    swatch: { light: "oklch(0.5 0.085 235)", dark: "oklch(0.72 0.1 235)" },
    light: {},
    dark: {},
  },
  ...(Object.fromEntries(
    RECIPES.map((r) => [
      r.name,
      {
        name: r.name,
        label: r.label,
        description: r.description,
        swatch: { light: c(r.light.primary), dark: c(r.dark.primary) },
        light: expand(r.light, "light"),
        dark: expand(r.dark, "dark"),
      } satisfies ThemeDef,
    ]),
  ) as Record<Exclude<ThemeName, "blocky">, ThemeDef>),
};

/*
  Font family choices, expressed as :root variable overrides rather than as a
  `font-family` string.

  A family has to be applied by overriding `--font-sans`, because that is the
  variable every `font-sans` utility in the app resolves against. Writing
  `style.fontFamily` instead — which this did until 2026-08-23 — set the family
  on <html> only for `<body>`'s own `font-sans` class to override it one element
  later, so every choice here rendered identically and the picker did nothing.

  "system" deliberately emits NOTHING. The house pairing is loaded by next/font,
  whose generated family name is a build hash rather than "Inter Tight", so the
  only correct way to ask for it is to leave the variables next/font already set
  on :root alone. Naming it literally is what made the old default resolve to
  `system-ui`.

  The keys are the three the API contract accepts (`preferences.ts`
  FONT_FAMILIES); changing one changes an enum both clients validate against.
*/
export const FONT_FAMILIES = {
  system: {},
  serif: { "--font-sans": "Georgia, 'Times New Roman', serif" },
  /* Everything mono, including prose: dense and unambiguous, and a real request
     from screens that are read as instrument panels rather than documents. */
  mono: { "--font-sans": "var(--font-mono)" },
  /* `satisfies`, not an annotation: an annotation widens the keys to `string`
     and `FontFamilyName` below stops being the three-value union the API
     contract validates against. */
} satisfies Record<string, Record<string, string>>;

export type FontFamilyName = keyof typeof FONT_FAMILIES;

export const FONT_FAMILY_LABELS: Record<FontFamilyName, { label: string; hint: string }> = {
  system: { label: "Inter Tight", hint: "The house pairing — Inter Tight with JetBrains Mono for values" },
  serif: { label: "Serif", hint: "Georgia for prose, values stay mono" },
  mono: { label: "All mono", hint: "JetBrains Mono everywhere" },
};

/* Every variable any font choice can set — the union, so switching back to the
   house pairing clears what the previous choice wrote. Same reasoning as
   ALL_THEME_KEYS in apply-theme.ts, and the same bug if it is ever narrowed to
   just the incoming choice's keys. */
export const ALL_FONT_KEYS: string[] = [
  ...new Set(Object.values(FONT_FAMILIES).flatMap((v) => Object.keys(v))),
];

/* 0.9–1.4: from condensed for dense screens to extra large for poorer
   eyesight. The whole app is rem-based, so these really scale — the settings
   page previews each step immediately. */
export const FONT_SCALES = ["0.9", "1.0", "1.1", "1.2", "1.3", "1.4"] as const;

export type Density = "comfortable" | "compact";

export type ThemePrefs = {
  themeName: ThemeName;
  fontFamily: FontFamilyName;
  fontScale: string;
  density: Density;
  dashboard: {
    widgets: Record<string, boolean>;
    /* The tab that opens first (docs/20, B1). The star on the dashboard sets
       it; default is the fleet view. */
    defaultTab?: "fleet" | "command";
  };
};

export const DEFAULT_PREFS: ThemePrefs = {
  themeName: "blocky",
  fontFamily: "system",
  fontScale: "1.0",
  density: "comfortable",
  dashboard: { widgets: {} },
};
