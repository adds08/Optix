"use client";

import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, Check, Leaf, Loader2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader, ErrorNote, TableSkeleton, EmptyState } from "@/components/sti/page";
import { SyncFromButton } from "@/components/sync-from-button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/*
  Settings -> Integrations. Systems Optix reads FROM.

  A CARD GRID, not a stack of panels, because more of these are coming — this
  codebase's own comments already name Mark 85 and FoundationSoft alongside
  BambooHR. Adding the second one should be one entry in `INTEGRATIONS` below
  and nothing else: no new component, no new layout decision, no third opinion
  about where a status label goes.

  The TRIGGER also sits on `/people`, beside Import, because that is where
  somebody is standing when they want it. Two homes for one action was the
  user's explicit call (2026-09-07) and the split is the right one:
  configuration and "what did the last run do" belong with the admin surfaces,
  the button belongs where the people are.

  ONLY BUILT INTEGRATIONS GET A CARD. There is deliberately no greyed-out
  "Mark 85 — coming soon" tile: a card for something that does not exist is the
  same defect as `tenant_settings.sms_enabled`, a control that advertises a
  capability the system does not have. When one is built, it gets a card.

  The icon is a lucide glyph on a neutral tile, never a vendor logo. We do not
  hold BambooHR's artwork, and `--brand-navy`/`--brand-yellow` belong to the
  Optix mark alone (see `.claude/rules/web.md`) — so nothing here is painted in
  a brand colour, ours or theirs.
*/

type IntegrationStatus = "installed" | "configured_elsewhere";

type Integration = {
  key: string;
  name: string;
  /* One line. What it pulls, in the yard's words rather than the API's. */
  blurb: string;
  icon: ComponentType<{ className?: string }>;
  status: IntegrationStatus;
  /* The action for this card. Kept as a node so a future integration with a
     different verb — "Connect", "Authorise" — does not have to pretend to be a
     sync. */
  action: ReactNode;
};

const INTEGRATIONS: Integration[] = [
  {
    key: "bamboohr",
    name: "BambooHR",
    blurb:
      "Pulls people — names, badge numbers, work email, division, department and who reports to whom.",
    /* A leaf for bamboo. A nod, not their mark. */
    icon: Leaf,
    status: "installed",
    action: <SyncFromButton />,
  },
];

const STATUS_LABEL: Record<IntegrationStatus, string> = {
  installed: "Installed",
  configured_elsewhere: "Needs setup",
};

function IntegrationCard({ integration }: { integration: Integration }) {
  const Icon = integration.icon;
  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20">
      <div className="flex items-start gap-3">
        {/* Fixed-size tile so every card's title starts at the same x however
            long the name is, and so a future integration with a wider glyph
            cannot shift the row. */}
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-sm font-semibold tracking-tight">
              {integration.name}
            </h3>
            <Badge variant={integration.status === "installed" ? "ok" : "outline"}>
              {integration.status === "installed" ? (
                <Check aria-hidden />
              ) : (
                <AlertTriangle aria-hidden />
              )}
              {STATUS_LABEL[integration.status]}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{integration.blurb}</p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        <strong className="font-semibold text-foreground">Read-only.</strong> Optix never
        writes anything back.
      </p>

      {/* `mt-auto` so the action sits on the card's floor whatever the blurb's
          length — cards in a grid with actions at different heights read as
          misaligned rather than as varied. */}
      <div className="mt-auto flex items-center justify-end">{integration.action}</div>
    </li>
  );
}

const STATUS_TONE: Record<string, string> = {
  done: "text-ok",
  failed: "text-crit",
  running: "text-warn",
  queued: "text-muted-foreground",
};

function when(v: string | Date | null | undefined) {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toLocaleString();
}

export default function IntegrationsSettingsPage() {
  const history = trpc.sync.history.useQuery({ limit: 10 });
  const latest = trpc.sync.latest.useQuery(undefined, {
    /* Poll only while something is in flight — a screen that polls forever
       keeps a laptop awake for nothing. Same shape as the chat page. */
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "queued" || s === "running" ? 2000 : false;
    },
  });

  const busy = latest.data?.status === "queued" || latest.data?.status === "running";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Integrations"
        description="Systems Optix reads from, and what the last read changed."
      />

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {INTEGRATIONS.map((i) => (
          <IntegrationCard key={i.key} integration={i} />
        ))}
      </ul>

      {/*
        BambooHR's own terms, below the grid rather than inside its card.

        These are the three things somebody needs to know BEFORE pressing the
        button, and each is a decision rather than a limitation. They do not go
        in the card because a card carrying five lines of policy stops being
        scannable, and the grid's whole job is to be scanned. If a second
        integration lands with rules of its own, this section grows a heading
        per integration or moves into the card's own detail view — whichever,
        it is a decision for then and not a structure to guess at now.
      */}
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-sm font-semibold tracking-tight">
          What a BambooHR sync does
        </h2>
        <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          <li className="flex items-start gap-1.5">
            <Check className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden />
            <span>
              <strong className="font-medium text-foreground">New people are added.</strong>{" "}
              Invitations are not sent — giving somebody a login stays a separate, deliberate
              act.
            </span>
          </li>
          <li className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
            <span>
              <strong className="font-medium text-foreground">
                Nobody is ever deactivated.
              </strong>{" "}
              Someone no longer active in BambooHR is flagged for you to deal with, because a
              person holding tools is not an import&apos;s decision.
            </span>
          </li>
          <li className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
            <span>
              <strong className="font-medium text-foreground">
                Badge numbers and names are never overwritten.
              </strong>{" "}
              A difference is reported and left for you — a name is how two people get merged
              by mistake.
            </span>
          </li>
        </ul>
        <p className="rounded-[3px] border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Credentials come from the server environment
          (<code className="font-mono">BAMBOOHR_COMPANY_DOMAIN</code> and{" "}
          <code className="font-mono">BAMBOOHR_API_KEY</code>) and cannot be edited here yet.
          Leaving either empty disables the sync.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-sm font-semibold tracking-tight">Recent runs</h2>

        {history.isLoading && <TableSkeleton rows={3} cols={4} />}
        {history.error && <ErrorNote message={history.error.message} />}

        {history.data && history.data.length === 0 && (
          <EmptyState
            title="Nothing has been synced yet"
            description="Use Sync from on the card above. Preview reads BambooHR and writes nothing, so it is safe to run first."
          />
        )}

        {history.data && history.data.length > 0 && (
          <ul className="flex flex-col divide-y overflow-hidden rounded-lg border bg-card">
            {history.data.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-xs"
              >
                <span className="w-40 shrink-0 text-muted-foreground">{when(r.createdAt)}</span>
                <span className="w-16 shrink-0 font-medium capitalize">{r.mode}</span>
                <span
                  className={cn(
                    "flex w-24 shrink-0 items-center gap-1 font-medium capitalize",
                    STATUS_TONE[r.status] ?? "text-muted-foreground",
                  )}
                >
                  {r.status === "running" || r.status === "queued" ? (
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                  ) : r.status === "failed" ? (
                    <X className="size-3" aria-hidden />
                  ) : (
                    <Check className="size-3" aria-hidden />
                  )}
                  {r.status}
                </span>
                {r.status === "failed" ? (
                  <span className="min-w-0 flex-1 truncate text-crit" title={r.errorNote ?? ""}>
                    {r.errorNote ?? "Failed"}
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 font-mono tabular-nums text-muted-foreground">
                    +{r.createdCount} added · {r.updatedCount} updated · {r.skippedCount}{" "}
                    unchanged
                    {r.flaggedCount > 0 ? ` · ${r.flaggedCount} flagged` : ""}
                    {r.refusedCount > 0 ? ` · ${r.refusedCount} refused` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {busy ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            A run is in progress — this list updates on its own.
          </p>
        ) : null}
      </section>
    </div>
  );
}
