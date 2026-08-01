"use client";

import { useEffect, useState } from "react";
import { CloudSun, Star, Sun, Sunset } from "lucide-react";
import { cn } from "@/lib/utils";

/*
  The greeting + weather bar (docs/20, B2) — the only place weather lives.

  One compact gradient row: time-of-day greeting, condition icon, temperature,
  and the yard's free variables (Open-Meteo, no key, no geolocation prompt).
  The star sets this view as the dashboard's default tab, so the bar carries
  both the human touch and the one preference the desk actually cares about.

  The fetch degrades silently — a yard on bad signal must not see a broken
  dashboard because the weather API was unreachable.
*/

const YARD = { city: "Dallas", lat: 32.7767, lng: -96.797 };

const WEATHER_CODES: Record<number, string> = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Icy fog", 51: "Drizzle", 61: "Rain", 63: "Rain", 71: "Snow", 80: "Showers", 95: "Storm",
};

type Weather = { temp: number; code: number; label: string; wind: number; humidity: number };

export function GreetingBar({
  firstName,
  isDefault,
  onSetDefault,
}: {
  firstName: string;
  isDefault: boolean;
  onSetDefault: () => void;
}) {
  const [w, setW] = useState<Weather | null>(null);

  useEffect(() => {
    let live = true;
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${YARD.lat}&longitude=${YARD.lng}&current_weather=true&temperature_unit=fahrenheit`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("weather fetch failed"))))
      .then((j) => {
        if (!live || !j?.current_weather) return;
        const cw = j.current_weather as { temperature: number; weathercode: number; windspeed: number };
        setW({
          temp: Math.round(cw.temperature),
          code: cw.weathercode,
          label: WEATHER_CODES[cw.weathercode] ?? "—",
          wind: Math.round(cw.windspeed),
          humidity: 0,
        });
      })
      .catch(() => { /* silent degradation — see above */ });
    return () => { live = false; };
  }, []);

  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const Icon = h < 12 ? Sun : h < 17 ? Sun : Sunset;

  return (
    <div className="relative overflow-hidden rounded-md border bg-gradient-to-r from-primary/15 via-accent/25 to-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Icon className="size-6 text-warn" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm text-muted-foreground">{part}</span>
            <span className="text-xl font-semibold tracking-tight">Hello {firstName}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {w ? (
            <div className="flex items-center gap-2.5">
              <CloudSun className="size-7 text-warn" />
              <div className="flex flex-col leading-tight">
                <span className="tnum text-xl font-semibold">{w.temp}°F</span>
                <span className="text-xs text-muted-foreground">
                  {w.label} · {YARD.city} · wind {w.wind} mph
                </span>
              </div>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Checking the yard weather…</span>
          )}

          {/* The default-view star: this bar (and its tab) is the starred view.
              Filled when it is, outline when it is not. */}
          <button
            type="button"
            onClick={onSetDefault}
            aria-pressed={isDefault}
            aria-label={isDefault ? "Fleet view is your default" : "Make the fleet view your default"}
            title={isDefault ? "Your default view" : "Make this your default view"}
            className="grid size-8 place-items-center rounded-md transition-colors hover:bg-accent"
          >
            <Star className={cn("size-5", isDefault ? "fill-warn text-warn" : "text-muted-foreground")} />
          </button>
        </div>
      </div>
    </div>
  );
}
