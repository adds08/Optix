"use client";

import { useState } from "react";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { Input } from "@/components/ui/input";
import { SaveBar, useHydrateOnce, useTenantSettings } from "@/components/settings/tenant-settings";

/*
  Tenant configuration: the operational decisions that used to be reachable
  only by whoever held the SSH key.

  What is left here after Settings became a rail group is what has no better
  home — the custody threshold and the notification channels. The chat parser
  moved to `settings/ai`, appearance and monitor pace to `settings/appearance`,
  and accounts and roles are their own rows under the same group.
*/
export default function SettingsPage() {
  const { settings, s, save, saved, error, setError } = useTenantSettings();

  const [threshold, setThreshold] = useState(5000);
  const [escalateDays, setEscalateDays] = useState(3);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);

  useHydrateOnce(s, (v) => {
    setThreshold(Number(v.highValueThreshold ?? 5000));
    setEscalateDays(Number(v.overdueEscalateAfterDays ?? 3));
    setEmailEnabled(!!v.emailEnabled);
    setSmsEnabled(!!v.smsEnabled);
  });

  if (settings.isLoading) return <TableSkeleton rows={6} cols={2} />;
  if (settings.isError) {
    return <ErrorNote message="These settings need the config.manage permission." />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ---- custody ---- */}
      <section className="flex flex-col gap-4 rounded-md border bg-card p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Custody</h2>
          <p className="text-sm text-muted-foreground">
            The threshold is used in two places that must agree: a tool at or above it is
            badged in the register, and handing it over needs a second signature.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">High-value threshold</label>
            <Input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              min={0}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Chase an overdue loan after (days)</label>
            <Input
              type="number"
              value={escalateDays}
              onChange={(e) => setEscalateDays(Number(e.target.value))}
              min={0}
              max={365}
            />
          </div>
        </div>
      </section>

      {/* ---- notifications ---- */}
      <section className="flex flex-col gap-4 rounded-md border bg-card p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Notifications</h2>
          <p className="text-sm text-muted-foreground">
            In-app alerts are always on. These control whether they are also delivered
            outside the app — both need credentials configured on the server.
          </p>
        </div>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmailEnabled(e.target.checked)} className="size-4" />
          Email
        </label>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" checked={smsEnabled} onChange={(e) => setSmsEnabled(e.target.checked)} className="size-4" />
          SMS
        </label>
      </section>

      <SaveBar
        pending={save.isPending}
        saved={saved}
        error={error}
        updatedAt={s?.updatedAt}
        onSave={() => {
          setError(null);
          save.mutate({
            highValueThreshold: threshold,
            overdueEscalateAfterDays: escalateDays,
            emailEnabled,
            smsEnabled,
          });
        }}
      />
    </div>
  );
}
