"use client";

import { PageHeader } from "@/components/sti/page";
import { AppearanceSettings } from "@/components/appearance-settings";
import { MonitorSettings } from "@/components/monitor-settings";

/*
  The viewer's own settings, and the reason Settings is not gated as a group.

  These need no permission at all: appearance saves through `preferences.set`,
  which writes the caller's own row, and the monitor pace never leaves
  localStorage. On the old combined page they had to be smuggled past a
  `settings.get` 403 with a `personal` escape hatch, or a foreman could not
  change their own font size. As their own route under a group whose rows are
  filtered individually that falls out of the routing instead of being defended
  in a render branch — this page never asks the server for tenant config, so
  there is nothing to be refused.
*/
export default function AppearanceSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Appearance"
        hideTitle
        description="Your own theme, type and density — followed to any browser you sign in on. The wall monitor's pace is set per screen."
      />
      <AppearanceSettings />
      <MonitorSettings />
    </div>
  );
}
