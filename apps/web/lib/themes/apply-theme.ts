"use client";

import { FONT_FAMILIES, THEMES, type ThemePrefs } from "./themes";

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
  ...new Set(
    Object.values(THEMES).flatMap((t) => [...Object.keys(t.light), ...Object.keys(t.dark)]),
  ),
];

export function applyTheme(prefs: ThemePrefs, dark: boolean) {
  const root = document.documentElement;
  const theme = THEMES[prefs.themeName] ?? THEMES["drafting-ink"];
  const vars = dark ? theme.dark : theme.light;

  for (const key of ALL_THEME_KEYS) root.style.removeProperty(key);
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);

  const scale = parseFloat(prefs.fontScale);
  const fontSize = Number.isFinite(scale) ? `${scale}rem` : "1rem";
  const fontFamily = FONT_FAMILIES[prefs.fontFamily] ?? FONT_FAMILIES.system;

  root.style.fontSize = fontSize;
  root.style.fontFamily = fontFamily;
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
      JSON.stringify({ vars, fontSize, fontFamily, density: prefs.density, themeName: prefs.themeName }),
    );
  } catch {
    /* Private mode, quota, disabled storage — the app still works, it just
       flashes the default on reload. Never break rendering over a cache. */
  }
}
