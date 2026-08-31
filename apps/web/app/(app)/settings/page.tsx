"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SaveBar, useHydrateOnce, useTenantSettings } from "@/components/settings/tenant-settings";
import { BRANDING_LAYOUT_MODES, type BrandingLayoutMode } from "@stinventory/types";
import { EntityField } from "@/components/ui/entity-picker";

/*
  Tenant configuration: the operational decisions that used to be reachable
  only by whoever held the SSH key.

  What is left here after Settings became a rail group is what has no better
  home — the custody threshold, the notification channels and (since the
  invite/reset build) the SMTP relay those channels actually send through.
  The chat parser moved to `settings/ai`, appearance and monitor pace to
  `settings/appearance`, and accounts and roles are their own rows under the
  same group.
*/
export default function SettingsPage() {
  const utils = trpc.useUtils();
  /* Branding renders in the sidebar footer and the account menu on every
     screen, both reading `identity.me` rather than `settings.get` — a save
     here has to invalidate that too, or the change is real but invisible
     until the next hard reload. */
  const { settings, s, save, saved, error, setError } = useTenantSettings(() => {
    utils.identity.me.invalidate();
  });

  const [threshold, setThreshold] = useState(5000);
  const [escalateDays, setEscalateDays] = useState(3);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);

  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  /* Write-only, like the LLM key on settings/ai: the server never sends a
     password back, so this starts blank and "leave the stored one alone"
     means literally leaving the field empty. */
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpPassHint, setSmtpPassHint] = useState<string | null>(null);

  const [brandingName, setBrandingName] = useState("");
  const [brandingLayoutMode, setBrandingLayoutMode] = useState<BrandingLayoutMode>("icon_and_text");

  useHydrateOnce(s, (v) => {
    setThreshold(Number(v.highValueThreshold ?? 5000));
    setEscalateDays(Number(v.overdueEscalateAfterDays ?? 3));
    setEmailEnabled(!!v.emailEnabled);
    setSmsEnabled(!!v.smsEnabled);
    setSmtpHost(v.smtpHost ?? "");
    setSmtpPort(v.smtpPort ?? 587);
    setSmtpUser(v.smtpUser ?? "");
    setSmtpFrom(v.smtpFrom ?? "");
    setSmtpPassHint(v.smtpPassHint ?? null);
    setBrandingName(v.brandingName ?? "");
    setBrandingLayoutMode((v.brandingLayoutMode as BrandingLayoutMode) ?? "icon_and_text");
  });

  const [testTo, setTestTo] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const testEmail = trpc.settings.testEmail.useMutation({
    onSuccess: (res) =>
      setTestResult(
        res.ok
          ? { ok: true, message: `Sent to ${testTo}. Check that inbox.` }
          : { ok: false, message: res.error },
      ),
    onError: (e) => setTestResult({ ok: false, message: e.data?.userMessage ?? e.message }),
  });

  if (settings.isLoading) return <TableSkeleton rows={6} cols={2} />;
  if (settings.isError) {
    return <ErrorNote message="These settings need the config.manage permission." />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ---- branding ---- */}
      <section className="flex flex-col gap-4 rounded-md border bg-card p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Branding</h2>
          <p className="text-sm text-muted-foreground">
            Shown in the sidebar and the account menu. Leave the name blank to show your
            organisation's registered name as-is.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Display name</label>
            <Input
              value={brandingName}
              onChange={(e) => setBrandingName(e.target.value)}
              placeholder="Your organisation's name"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Sidebar layout</label>
            <EntityField
              value={brandingLayoutMode}
              onChange={(v) => setBrandingLayoutMode(v as BrandingLayoutMode)}
              placeholder="How the mark is shown"
              options={BRANDING_LAYOUT_MODES.map((m) => ({
                value: m,
                label: m === "icon_and_text" ? "Icon and name" : "Icon only",
              }))}
            />
          </div>
        </div>
      </section>

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
            In-app alerts are always on. Email is delivered through the relay configured below,
            or through this server's own default when none is set here. SMS has no provider wired
            up yet — the toggle is a placeholder for when one is.
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

      {/* ---- email delivery ---- */}
      <section className="flex flex-col gap-4 rounded-md border bg-card p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Email delivery (SMTP)</h2>
          <p className="text-sm text-muted-foreground">
            Where invites, password resets and desk alerts are actually sent from. Leave every
            field blank to use this server's own default relay, if one is set — a host entered
            here overrides it entirely rather than filling in gaps.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <label className="text-sm font-medium">Host</label>
            <Input
              placeholder="smtp.example.com"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Port</label>
            <Input
              type="number"
              value={smtpPort}
              onChange={(e) => setSmtpPort(Number(e.target.value))}
              min={1}
              max={65535}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">From address</label>
            <Input
              placeholder='Optix <no-reply@example.com>'
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Username</label>
            <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Password</label>
            <Input
              type="password"
              value={smtpPass}
              placeholder={smtpPassHint ? `Saved, ending in ${smtpPassHint}` : "Not set"}
              onChange={(e) => setSmtpPass(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Never shown once saved. Leave blank to keep it; clear the host above and save to
              drop back to the server default.
            </p>
          </div>
        </div>

        {s?.smtpLastCheckedAt ? (
          <p className="text-xs text-muted-foreground">
            Last test {s.smtpLastCheckOk ? "succeeded" : "failed"} —{" "}
            {new Date(s.smtpLastCheckedAt).toLocaleString()}
            {s.smtpLastCheckOk ? "" : `: ${s.smtpLastCheckError}`}
          </p>
        ) : null}

        <div className="flex flex-wrap items-end gap-2 border-t pt-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Send a test email to</label>
            <Input
              type="email"
              className="w-64"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!testTo || testEmail.isPending}
            onClick={() => {
              setTestResult(null);
              testEmail.mutate({ to: testTo });
            }}
          >
            {testEmail.isPending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
            Send test email
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Tests whatever is currently SAVED, not what is still typed above — save first if you
          just changed something.
        </p>
        {testResult ? (
          <p className={`text-sm ${testResult.ok ? "text-ok" : "text-crit"}`}>{testResult.message}</p>
        ) : null}
      </section>

      <SaveBar
        pending={save.isPending}
        saved={saved}
        error={error}
        updatedAt={s?.updatedAt}
        onSave={() => {
          setError(null);
          save.mutate({
            brandingName: brandingName.trim() || null,
            brandingLayoutMode,
            highValueThreshold: threshold,
            overdueEscalateAfterDays: escalateDays,
            emailEnabled,
            smsEnabled,
            smtpHost: smtpHost.trim() || null,
            smtpPort,
            smtpUser: smtpUser.trim() || null,
            smtpFrom: smtpFrom.trim() || null,
            ...(smtpPass ? { smtpPass } : {}),
          });
        }}
      />
    </div>
  );
}
