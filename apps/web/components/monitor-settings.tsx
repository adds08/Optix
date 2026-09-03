"use client";

import { useEffect, useState } from "react";
import { MonitorPlay } from "lucide-react";
import {
  DEFAULT_MONITOR_PREFS,
  PACE_OPTIONS,
  readMonitorPrefs,
  writeMonitorPrefs,
} from "@/lib/monitor-prefs";
import { dwellFor } from "@/components/sti/monitor/project-monitor";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/*
  Project monitor pace.

  Deliberately NOT part of AppearanceSettings, and deliberately not saved
  through preferences.set: appearance follows the person to whatever browser
  they sign in on, which is exactly the wrong behaviour for the pace of a screen
  bolted to a wall. See lib/monitor-prefs.ts.

  There is no Save button because there is nothing to save to — the write lands
  in localStorage on click, and a board open in another tab picks it up through
  the storage event.
*/

/* A job the reader can picture, so the seconds mean something. Twenty tools is
   a busy crew's worth and lands mid-range rather than on the cap. */
const SAMPLE_ROWS = 20;

export function MonitorSettings() {
  const [pace, setPace] = useState(DEFAULT_MONITOR_PREFS.pace);

  /* Mount, not render: the server cannot read localStorage, and painting the
     stored value straight into the markup is a hydration mismatch on every
     device that has ever been tuned. */
  useEffect(() => setPace(readMonitorPrefs().pace), []);

  function choose(value: string) {
    const next = Number(value);
    setPace(next);
    writeMonitorPrefs({ pace: next });
  }

  const seconds = Math.round(dwellFor(SAMPLE_ROWS, pace) / 1000);

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4 lg:p-6">
      <div className="flex items-start gap-3">
        <MonitorPlay className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <h2 className="font-semibold">Project monitor</h2>
          <p className="text-sm text-muted-foreground">
            How long the dashboard holds each job before moving on, and therefore how fast its
            list crawls. Saved on this device only — a shop TV and a laptop can be set
            differently, and nothing here reaches the server.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">Pace</span>
        <ToggleGroup
          type="single"
          value={String(pace)}
          onValueChange={(v) => v && choose(v)}
          variant="outline"
          spacing={1}
          className="w-full flex-wrap"
        >
          {PACE_OPTIONS.map((o) => (
            <ToggleGroupItem key={o.value} value={String(o.value)} title={o.hint || undefined}>
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-sm text-muted-foreground">
          A job with {SAMPLE_ROWS} tools stays on screen for{" "}
          <span className="font-mono font-semibold text-foreground tnum">{seconds}s</span>.
        </p>
      </div>
    </section>
  );
}
