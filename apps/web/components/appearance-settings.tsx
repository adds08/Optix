"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useThemeStore } from "@/lib/themes/store";
import { applyTheme } from "@/lib/themes/apply-theme";
import {
  FONT_SCALES,
  THEMES,
  type Density,
  type FontFamilyName,
  type ThemeName,
  type ThemePrefs,
} from "@/lib/themes/themes";
import { cn } from "@/lib/utils";

/*
  Appearance: the theme engine's controls (docs/19).

  Named themes, each with dedicated light and dark palettes; font family and
  size; density. Changes apply INSTANTLY through the theme store (so the desk
  sees what it is choosing) and persist on Save through preferences.set — the
  server row is what makes the choice follow the user to another browser.
*/

export function AppearanceSettings() {
  const utils = trpc.useUtils();
  const prefs = trpc.preferences.get.useQuery();
  const dark = useThemeStore((s) => s.dark);
  const setPrefs = useThemeStore((s) => s.setPrefs);

  const [themeName, setThemeName] = useState<ThemeName>("drafting-ink");
  const [fontFamily, setFontFamily] = useState<FontFamilyName>("system");
  const [fontScale, setFontScale] = useState("1.0");
  const [density, setDensity] = useState<Density>("comfortable");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefs.data) {
      setThemeName(prefs.data.themeName as ThemeName);
      setFontFamily(prefs.data.fontFamily as FontFamilyName);
      setFontScale(prefs.data.fontScale);
      setDensity(prefs.data.density as Density);
    }
  }, [prefs.data]);

  const save = trpc.preferences.set.useMutation({
    onSuccess: () => {
      setError(null);
      setSaved(true);
      utils.preferences.get.invalidate();
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e) => setError(e.message),
  });

  /* Preview applies immediately; Save persists. */
  const current = (): ThemePrefs => ({ themeName, fontFamily, fontScale, density, dashboard: { widgets: {} } });
  const preview = () => setPrefs(current());
  const onSave = () => {
    setPrefs(current());
    save.mutate(current());
  };

  return (
    <section className="flex flex-col gap-4 rounded-md border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          Named themes with their own light and dark palettes, plus type and density. Saved per
          account, applied on every screen.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Theme</label>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(THEMES) as ThemeName[]).map((name) => {
            const t = THEMES[name];
            const active = themeName === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => { setThemeName(name); preview(); }}
                aria-pressed={active}
                className={cn(
                  "flex flex-col gap-2 rounded-md border p-3 text-left transition-colors",
                  active ? "border-primary ring-2 ring-ring/40" : "hover:bg-accent",
                )}
              >
                <span className="flex items-center gap-1.5">
                  <span className="size-4 rounded-full border border-border" style={{ backgroundColor: t.swatch.light }} />
                  <span className="size-4 rounded-full border border-border" style={{ backgroundColor: t.swatch.dark }} />
                  <span className="text-sm font-medium">{t.label}</span>
                  {active ? <Check className="ml-auto size-3.5 text-primary" /> : null}
                </span>
                <span className="text-xs text-muted-foreground">{t.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="app-font">Font family</label>
          <select
            id="app-font"
            value={fontFamily}
            onChange={(e) => { setFontFamily(e.target.value as FontFamilyName); preview(); }}
            className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="system">System</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="app-scale">Font size</label>
          <select
            id="app-scale"
            value={fontScale}
            onChange={(e) => { setFontScale(e.target.value); preview(); }}
            className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {FONT_SCALES.map((s) => (
              <option key={s} value={s}>{Math.round(parseFloat(s) * 100)}%</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Density</label>
        <div className="grid grid-cols-2 gap-2 rounded-md border p-1" role="group" aria-label="Density">
          {(["comfortable", "compact"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => { setDensity(d); preview(); }}
              aria-pressed={density === d}
              className={cn(
                "rounded-sm px-3 py-1.5 text-sm capitalize transition-colors",
                density === d ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-3">
        <Button onClick={onSave} disabled={save.isPending}>{save.isPending ? "..." : "Save appearance"}</Button>
        {saved ? <span className="text-sm text-ok">Saved</span> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Font stacks load from the system — nothing is fetched from a font CDN.
      </p>
    </section>
  );
}
