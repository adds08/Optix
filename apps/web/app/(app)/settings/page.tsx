"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader, ErrorNote, TableSkeleton } from "@/components/sti/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppearanceSettings } from "@/components/appearance-settings";
import { dateTime } from "@/lib/format";

/*
  Tenant configuration.

  These are operational decisions — what counts as high value, which model
  reads the chat — that used to be reachable only by whoever held the SSH key.
  Putting them here is the difference between the equipment manager owning them
  and filing a ticket.

  The API key is handled as write-only throughout. The page is never sent the
  stored value, only its last four characters, and leaving the field blank on
  save means "keep what is there" rather than "clear it".
*/

const PROVIDERS = [
  { label: "DigitalOcean", baseUrl: "https://inference.do-ai.run/v1" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { label: "Local", baseUrl: "http://localhost:8088/v1" },
];

export default function SettingsPage() {
  const utils = trpc.useUtils();
  const settings = trpc.settings.get.useQuery();
  const s = settings.data;

  const [llmEnabled, setLlmEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(15000);

  const [threshold, setThreshold] = useState(5000);
  const [escalateDays, setEscalateDays] = useState(3);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(false);

  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    Populate from the server exactly once.

    This used to depend on `s` alone, which looks right and is not: react-query
    refetches on window focus by default, and every refetch produced a fresh
    object, re-ran this effect and stamped the saved values back over whatever
    was half-typed. Switching to another tab and back — or to the terminal to
    copy an API key, which is precisely what this page is for — silently
    emptied the fields.

    A ref rather than state because the guard must not itself cause a render,
    and it must be set in the same pass that does the hydrating.
  */
  const hydrated = useRef(false);
  useEffect(() => {
    if (!s || hydrated.current) return;
    hydrated.current = true;
    setLlmEnabled(!!s.llmEnabled);
    setBaseUrl(s.llmBaseUrl ?? "");
    setModel(s.llmModel ?? "");
    setTimeoutMs(s.llmTimeoutMs ?? 15000);
    setThreshold(Number(s.highValueThreshold ?? 5000));
    setEscalateDays(Number(s.overdueEscalateAfterDays ?? 3));
    setEmailEnabled(!!s.emailEnabled);
    setSmsEnabled(!!s.smsEnabled);
  }, [s]);

  const save = trpc.settings.update.useMutation({
    onSuccess: () => {
      setError(null);
      setSaved(true);
      setApiKey("");
      utils.settings.get.invalidate();
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (e) => setError(e.message),
  });

  const test = trpc.settings.testLlm.useMutation({
    onSuccess: () => utils.settings.get.invalidate(),
  });
  const result = test.data;

  /* Every field the test needs. A stored key counts — the input is blank on
     load by design, and requiring it to be retyped to run a test would be a
     reason to keep keys in a text file. */
  const canTest = !!(baseUrl.trim() && model.trim() && (apiKey.trim() || s?.llmApiKeyHint));

  if (settings.isLoading) return <TableSkeleton rows={8} cols={2} />;
  if (settings.isError) {
    return <ErrorNote message="Settings could not be loaded. This page needs the config.manage permission." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operations"
        title="Settings"
        description="Configuration that belongs to the equipment desk rather than to a deployment."
      />

      {/* ---- LLM ---- */}
      <section className="flex flex-col gap-4 rounded-md border bg-card p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Chat parser</h2>
          <p className="text-sm text-muted-foreground">
            The model that turns a foreman&apos;s sentence into a proposed custody action. Any
            OpenAI-compatible endpoint works — DigitalOcean inference, OpenAI, or a model on
            your own hardware. Without one, messages are still captured and queued; they just
            wait for the desk to read them.
          </p>
        </div>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={llmEnabled}
            onChange={(e) => setLlmEnabled(e.target.checked)}
            className="mt-0.5 size-4"
          />
          <span className="text-sm">
            Use a model to read chat messages
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Turn this off to stop calls being made at all — useful if you are being billed
              per token and want to pause it.
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Base URL</label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://inference.do-ai.run/v1"
            />
            {/* Typing this from memory is how you get a silent 404 that reads
                as an authentication problem. */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Use:</span>
              {PROVIDERS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setBaseUrl(p.baseUrl)}
                  className="rounded border px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Must end in <code>/v1</code>.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Model</label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="llama3.3-70b-instruct"
            />
            <p className="text-xs text-muted-foreground">
              Exactly as the provider names it — a wrong name fails the same way a wrong key does.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">API key</label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={s?.llmApiKeyHint ? `Stored — ${s.llmApiKeyHint}` : "Paste the key"}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            {s?.llmApiKeyHint
              ? "A key is stored. Leave blank to keep it, type a new one to replace it, or clear it below."
              : "Encrypted before it is stored, and never sent back to this page."}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Timeout (ms)</label>
            <Input
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
              min={1000}
              max={120000}
            />
          </div>
        </div>

        {/* What the last real attempt proved, rather than what was saved. */}
        {s?.llmLastCheckedAt ? (
          <p
            className={`flex items-center gap-1.5 text-xs ${s.llmLastCheckOk ? "text-ok" : "text-crit"}`}
          >
            {s.llmLastCheckOk ? <Check className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
            {s.llmLastCheckOk ? "Last checked" : "Last check failed"} {dateTime(s.llmLastCheckedAt)}
            {s.llmLastCheckError ? ` — ${s.llmLastCheckError}` : ""}
          </p>
        ) : null}

        {/*
          The result of the test, spelled out rather than reduced to a tick.

          A green "connected" told you the key was live and nothing else, which
          is the least interesting of the things that can be wrong. What the
          desk needs to know is whether the model can turn a sentence into an
          action — so the reading below is the parse itself.
        */}
        {test.isPending ? (
          <p className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Parsing a sample message…
          </p>
        ) : test.error ? (
          <p className="rounded-md border border-crit/30 bg-crit-bg px-3 py-2 text-sm text-crit">
            {test.error.message}
          </p>
        ) : result ? (
          <div
            className={`flex flex-col gap-2 rounded-md border px-3 py-2.5 text-sm ${
              result.ok ? "border-ok/30 bg-ok-bg" : "border-crit/30 bg-crit-bg"
            }`}
          >
            <p className={`flex items-center gap-1.5 font-medium ${result.ok ? "text-ok" : "text-crit"}`}>
              {result.ok ? <Check className="size-4" /> : <TriangleAlert className="size-4" />}
              {result.ok ? `Working — parsed in ${result.ms}ms` : (result.error ?? "Failed")}
            </p>
            {result.detail ? (
              <p className="text-xs text-muted-foreground">{result.detail}</p>
            ) : null}
            {result.ok ? (
              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[7rem_1fr]">
                <dt className="text-muted-foreground">Sent</dt>
                <dd className="italic">&ldquo;{result.message}&rdquo;</dd>
                <dt className="text-muted-foreground">Understood as</dt>
                <dd>
                  <span className="font-medium">{result.intent}</span>
                  {result.confidence !== null
                    ? ` (${Math.round(result.confidence * 100)}% confident)`
                    : ""}
                </dd>
                {result.assets.length ? (
                  <>
                    <dt className="text-muted-foreground">Tool</dt>
                    <dd>{result.assets.join(", ")}</dd>
                  </>
                ) : null}
                {result.custodian ? (
                  <>
                    <dt className="text-muted-foreground">Person</dt>
                    <dd>{result.custodian}</dd>
                  </>
                ) : null}
                {result.project ? (
                  <>
                    <dt className="text-muted-foreground">Project</dt>
                    <dd>{result.project}</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={test.isPending || !canTest}
            onClick={() =>
              /* Tests what is on screen, so a key can be checked before it is
                 committed — and before the page is left, which is when a
                 mistyped one used to become somebody else's problem. */
              test.mutate({
                baseUrl: baseUrl || undefined,
                model: model || undefined,
                apiKey: apiKey || undefined,
              })
            }
          >
            {test.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Test connection
          </Button>
          {s?.llmApiKeyHint ? (
            <Button
              variant="outline"
              onClick={() => save.mutate({ llmApiKey: "" })}
              disabled={save.isPending}
            >
              Clear key
            </Button>
          ) : null}
          {/* A greyed-out button with no reason is the same as a broken one. */}
          {!canTest ? (
            <span className="text-xs text-muted-foreground">
              Needs a base URL, a model and a key first.
            </span>
          ) : null}
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

      {/* ---- appearance ---- */}
      {/* Appearance saves through its own preferences.set — it is a per-user
          preference, not tenant config, and mixing the two save buttons would
          make the tenant Save silently overwrite the theme. */}
      <AppearanceSettings />

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

      {error ? <ErrorNote message={error} /> : null}

      <div className="flex items-center gap-3">
        <Button
          disabled={save.isPending}
          onClick={() => {
            setError(null);
            save.mutate({
              llmEnabled,
              llmBaseUrl: baseUrl || null,
              llmModel: model || null,
              llmTimeoutMs: timeoutMs,
              /* Only sent when the user typed one — otherwise the stored key
                 would be cleared by saving any other field on this page. */
              ...(apiKey ? { llmApiKey: apiKey } : {}),
              highValueThreshold: threshold,
              overdueEscalateAfterDays: escalateDays,
              emailEnabled,
              smsEnabled,
            });
          }}
        >
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          Save
        </Button>
        {saved ? (
          <span className="flex items-center gap-1.5 text-sm text-ok">
            <Check className="size-4" /> Saved
          </span>
        ) : null}
        {s?.updatedAt ? (
          <span className="text-xs text-muted-foreground">Last changed {dateTime(s.updatedAt)}</span>
        ) : null}
      </div>
    </div>
  );
}
