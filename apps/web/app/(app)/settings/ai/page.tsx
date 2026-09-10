"use client";

import { useState } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ErrorNote, TableSkeleton, PageHeader } from "@/components/sti/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateTime } from "@/lib/format";
import { SaveBar, useHydrateOnce, useTenantSettings } from "@/components/settings/tenant-settings";

/*
  The model that reads the chat, and the credential it uses.

  Split out of the combined settings page when Settings became a rail group:
  this is the one section a person opens with a key on the clipboard, and
  making them scroll past custody thresholds and notification toggles to reach
  it was the whole argument for separate routes.

  The API key is handled as write-only throughout. The page is never sent the
  stored value, only its last four characters, and leaving the field blank on
  save means "keep what is there" rather than "clear it".
*/

const PROVIDERS = [
  { label: "DigitalOcean", baseUrl: "https://inference.do-ai.run/v1" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { label: "Local", baseUrl: "http://localhost:8088/v1" },
];

export default function AiSettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const { settings, s, save, saved, error, setError } = useTenantSettings(() => setApiKey(""));

  const [llmEnabled, setLlmEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(15000);

  useHydrateOnce(s, (v) => {
    setLlmEnabled(!!v.llmEnabled);
    setBaseUrl(v.llmBaseUrl ?? "");
    setModel(v.llmModel ?? "");
    setTimeoutMs(v.llmTimeoutMs ?? 15000);
  });

  const utils = trpc.useUtils();
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
    return <ErrorNote message="These settings need the config.manage permission." />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI & API"
        hideTitle
        description="The model that reads chat messages into proposed custody actions — endpoint, model and key."
      />
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

      <SaveBar
        pending={save.isPending}
        saved={saved}
        error={error}
        updatedAt={s?.updatedAt}
        onSave={() => {
          setError(null);
          save.mutate({
            llmEnabled,
            llmBaseUrl: baseUrl || null,
            llmModel: model || null,
            llmTimeoutMs: timeoutMs,
            /* Only sent when the user typed one — otherwise the stored key
               would be cleared by saving any other field on this page. */
            ...(apiKey ? { llmApiKey: apiKey } : {}),
          });
        }}
      />
    </div>
  );
}
