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

export function applyTheme(prefs: ThemePrefs, dark: boolean) {
  const root = document.documentElement;
  const theme = THEMES[prefs.themeName] ?? THEMES["drafting-ink"];
  const vars = dark ? theme.dark : theme.light;

  /* Drafting-ink is the base token set — its overrides are empty by design,
     so applying them must CLEAR any previously applied theme rather than
     leaving stale variables behind. */
  for (const key of Object.keys(theme.light)) {
    root.style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }

  const scale = parseFloat(prefs.fontScale);
  root.style.fontSize = Number.isFinite(scale) ? `${scale}rem` : "1rem";
  root.style.fontFamily = FONT_FAMILIES[prefs.fontFamily] ?? FONT_FAMILIES.system;
  root.dataset.density = prefs.density;
  root.dataset.theme = prefs.themeName;
  root.classList.toggle("dark", dark);
}
