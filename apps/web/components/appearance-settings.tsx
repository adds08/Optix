"use client";

import { useEffect, useState } from "react";
import { Check, HardHat, Truck, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useThemeStore } from "@/lib/themes/store";
import {
  DEFAULT_PREFS,
  FONT_FAMILY_LABELS,
  FONT_SCALES,
  ICON_SCALES,
  THEMES,
  type Density,
  type FontFamilyName,
  type ThemeName,
  type ThemePrefs,
} from "@/lib/themes/themes";
import { cn } from "@/lib/utils";
import { EntityField } from "@/components/ui/entity-picker";

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
  const setPrefs = useThemeStore((s) => s.setPrefs);

  const [themeName, setThemeName] = useState<ThemeName>(DEFAULT_PREFS.themeName);
  const [fontFamily, setFontFamily] = useState<FontFamilyName>("system");
  const [fontScale, setFontScale] = useState("1.0");
  const [iconScale, setIconScale] = useState("1.0");
  const [density, setDensity] = useState<Density>("comfortable");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefs.data) {
      setThemeName(prefs.data.themeName as ThemeName);
      setFontFamily(prefs.data.fontFamily as FontFamilyName);
      setFontScale(prefs.data.fontScale);
      setIconScale(prefs.data.iconScale);
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

  /*
    Preview applies immediately; Save persists.

    The override argument is not optional decoration. `preview()` used to be
    called straight after `setThemeName(name)` and read `themeName` out of the
    render that was still on screen — React had not re-rendered yet — so every
    click previewed the PREVIOUS selection and the theme appeared to lag one
    step behind, or not to change at all on the first click.
  */
  const current = (over: Partial<ThemePrefs> = {}): ThemePrefs => ({
    themeName,
    fontFamily,
    fontScale,
    iconScale,
    density,
    dashboard: { widgets: {} },
    ...over,
  });
  const preview = (over: Partial<ThemePrefs> = {}) => setPrefs(current(over));
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
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(THEMES) as ThemeName[]).map((name) => {
            const t = THEMES[name];
            const active = themeName === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => { setThemeName(name); preview({ themeName: name }); }}
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
          <EntityField
            id="app-font"
            value={fontFamily}
            onChange={(v) => { setFontFamily(v as FontFamilyName); preview({ fontFamily: v as FontFamilyName }); }}
            placeholder="Typeface"
            searchPlaceholder="Search typefaces…"
            options={Object.entries(FONT_FAMILY_LABELS).map(([value, f]) => ({ value, label: f.label }))}
          />
          <p className="text-xs text-muted-foreground">
            {FONT_FAMILY_LABELS[fontFamily]?.hint}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="app-scale">Font size</label>
          <EntityField
            id="app-scale"
            value={fontScale}
            onChange={(v) => { setFontScale(v); preview({ fontScale: v }); }}
            placeholder="Text size"
            options={FONT_SCALES.map((s) => ({ value: s, label: `${Math.round(parseFloat(s) * 100)}%` }))}
          />
        </div>
      </div>

      {/*
        Icon size is its own control, next to type rather than folded into it.

        The two are genuinely independent: icons already grow with the font
        scale, because everything is rem-based — what this changes is how large
        a glyph is *relative to the words beside it*, which is the thing people
        mean when they say the icons are too small. The preview is live, and the
        row below is the reason it is worth previewing: it shows the same three
        glyph sizes the app actually uses, beside text, at the chosen setting.
      */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="app-icon-scale">Icon size</label>
          <EntityField
            id="app-icon-scale"
            value={iconScale}
            onChange={(v) => { setIconScale(v); preview({ iconScale: v }); }}
            placeholder="Icon size"
            options={ICON_SCALES.map((s) => ({ value: s, label: `${Math.round(parseFloat(s) * 100)}%` }))}
          />
          <p className="text-xs text-muted-foreground">
            Separate from font size — icons already grow with the type; this changes how
            large they are beside it.
          </p>
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium">Preview</span>
          <div className="flex h-8 items-center gap-3 rounded-lg border border-input px-2.5 text-sm">
            <span className="flex items-center gap-1.5"><Wrench className="size-3.5" aria-hidden />Tool</span>
            <span className="flex items-center gap-1.5"><Truck className="size-4" aria-hidden />Truck</span>
            <span className="flex items-center gap-1.5"><HardHat className="size-5" aria-hidden />Crew</span>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Density</label>
        <div className="grid grid-cols-2 gap-2 rounded-md border p-1" role="group" aria-label="Density">
          {(["comfortable", "compact"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => { setDensity(d); preview({ density: d }); }}
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
