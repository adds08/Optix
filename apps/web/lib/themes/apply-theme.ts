"use client";

import { ALL_FONT_KEYS, FONT_FAMILIES, THEMES, type ThemePrefs } from "./themes";

/*
  Apply the active preferences to the document.

  Called whenever prefs or the light/dark mode change. Theme overrides are
  inline CSS variables on <html> — they layer over the base tokens, so
  resetting to the default theme just removes them. Font scale is the root
  font-size (everything in the app is rem-based, so this really scales);
  font family goes on the root; density becomes a data attribute the CSS in
  globals.css reads.
*/

/*
  Every variable any theme can set, in either mode.

  What has to be cleared on a switch is the union across the whole catalog, not
  the keys of the theme being applied. Clearing only the incoming theme's keys
  meant switching to Drafting Ink — whose overrides are empty by design, because
  it IS the base token set — removed nothing at all, so the previous theme's
  primary, sidebar and radius stayed on the root and the default became
  unreachable until a reload.
*/
const ALL_THEME_KEYS = [
  /* Radius is pinned in globals.css (Blocky 4px) and is no longer emitted by
     any theme. It stays in the clear-set so a pre-existing cached appearance
     that once carried a per-theme radius cannot keep overriding the base. */
  "--radius",
  ...new Set(
    Object.values(THEMES).flatMap((t) => [...Object.keys(t.light), ...Object.keys(t.dark)]),
  ),
];

export function applyTheme(prefs: ThemePrefs, dark: boolean) {
  const root = document.documentElement;
  const theme = THEMES[prefs.themeName] ?? THEMES.blocky;
  const vars = dark ? theme.dark : theme.light;

  for (const key of ALL_THEME_KEYS) root.style.removeProperty(key);
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);

  const scale = parseFloat(prefs.fontScale);
  const fontSize = Number.isFinite(scale) ? `${scale}rem` : "1rem";
  /* The family overrides `--font-sans` at :root, where next/font defined it, so
     every `font-sans` utility follows the choice. Setting `style.fontFamily`
     here did nothing at all — see the note on FONT_FAMILIES. */
  const fontVars = FONT_FAMILIES[prefs.fontFamily] ?? FONT_FAMILIES.system;

  /*
    Icons are multiplied by their own factor rather than riding the type scale.
    They already track it — everything is rem-based — but a `size-4` glyph is
    1rem against 0.875rem body copy, so "bigger type" never made the icons read
    as bigger relative to the words beside them. `--icon-scale` is read by the
    `svg.size-*` rules in globals.css. Clamped here as well as in the router
    because this value goes straight into a style.
  */
  const icon = parseFloat(prefs.iconScale);
  const iconScale = String(Number.isFinite(icon) ? Math.min(Math.max(icon, 0.75), 2) : 1);

  root.style.fontSize = fontSize;
  root.style.setProperty("--icon-scale", iconScale);
  root.style.removeProperty("font-family");
  for (const key of ALL_FONT_KEYS) root.style.removeProperty(key);
  for (const [key, value] of Object.entries(fontVars)) root.style.setProperty(key, value);
  root.dataset.density = prefs.density;
  root.dataset.theme = prefs.themeName;
  root.classList.toggle("dark", dark);

  /* Cached so the boot script in the document head can repaint the same
     appearance before first paint. Without it every reload renders the default
     theme until the preferences query resolves, which is the flash that reads
     as "the theme did not apply". Resolved values, not a theme name, so the
     script never needs a copy of the catalog. */
  try {
    localStorage.setItem(
      "sti-appearance",
      JSON.stringify({ vars, fontSize, iconScale, fontVars, density: prefs.density, themeName: prefs.themeName }),
    );
  } catch {
    /* Private mode, quota, disabled storage — the app still works, it just
       flashes the default on reload. Never break rendering over a cache. */
  }
}
