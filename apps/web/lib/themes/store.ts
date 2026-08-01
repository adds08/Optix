"use client";

import { create } from "zustand";
import type { ThemePrefs } from "./themes";

/*
  The active appearance, mirrored from the server row.

  Zustand holds only UI state — the preference row itself is React Query's
  business. The store exists so the settings page can update the theme
  INSTANTLY (before the save round-trips) and so the theme toggle and the
  apply effect share one source of truth for what "dark" means.
*/

type ThemeState = {
  prefs: ThemePrefs | null;
  dark: boolean;
  setPrefs: (p: ThemePrefs) => void;
  setDark: (d: boolean) => void;
};

export const useThemeStore = create<ThemeState>((set) => ({
  prefs: null,
  dark: false,
  setPrefs: (p) => set({ prefs: p }),
  setDark: (d) => set({ dark: d }),
}));
