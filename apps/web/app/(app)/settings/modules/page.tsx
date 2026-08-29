"use client";

import { trpc } from "@/lib/trpc";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { FEATURE_STATES, type FeatureState } from "@stinventory/types";
import { DESK_NAV, FIELD_NAV, isSettingsItemId, type NavItem } from "@/components/sti/nav-config";

/*
  ADR-13 (docs/06-decisions.md) made concrete: one row per feature key, a
  select for its state, applied immediately — the same "no Apply, no draft"
  choice the column menu's filters make, for the same reason: this is a
  handful of selects over data already in memory, not a form with a save step
  worth guarding against.

  Settings rows are left out of the list entirely rather than shown
  disabled — `applyFeatureStates` already refuses to act on a stored row
  naming one, so offering a control that can never do anything would just be
  a lie the screen tells.
*/

const STATE_LABELS: Record<FeatureState, string> = {
  enabled: "Enabled",
  beta: "Beta",
  upcoming: "Upcoming",
  hidden: "Hidden",
};

/* Every nav item across both layouts, deduped by id — a foreman's Alerts and
   a desk role's Reports are both real keys even though only one layout ever
   shows either to a given person. Settings rows excluded (see above). */
function allNavKeys(): NavItem[] {
  const seen = new Map<string, NavItem>();
  for (const group of [...FIELD_NAV, ...DESK_NAV]) {
    for (const item of group.items) {
      if (!isSettingsItemId(item.id) && !seen.has(item.id)) seen.set(item.id, item);
    }
  }
  return [...seen.values()];
}

/* In-page keys that are not nav items at all — currently just the one. A
   second arrives the same way this one did: named here, with a one-line
   description of what flipping it actually changes. */
const IN_PAGE_KEYS: { key: string; label: string; description: string }[] = [
  { key: "import.ai", label: "AI Import", description: "The \"AI Import\" item in every register's Import menu." },
];

export default function ModulesSettingsPage() {
  const utils = trpc.useUtils();
  const states = trpc.feature.states.useQuery();
  const set = trpc.feature.set.useMutation({
    onSuccess: () => {
      utils.feature.states.invalidate();
    },
  });

  if (states.isLoading) return <TableSkeleton rows={6} cols={2} />;
  if (states.isError) {
    return <ErrorNote message="These settings need the config.manage permission." />;
  }

  const stateOf = (key: string): FeatureState => (states.data?.[key] as FeatureState) ?? "enabled";

  const Row = ({ label, keyName, description }: { label: string; keyName: string; description?: string }) => (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-0">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
      <select
        value={stateOf(keyName)}
        onChange={(e) => set.mutate({ key: keyName, state: e.target.value as FeatureState })}
        disabled={set.isPending}
        className="flex h-8 w-36 shrink-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {FEATURE_STATES.map((s) => (
          <option key={s} value={s}>{STATE_LABELS[s]}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2 rounded-md border bg-card p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">Navigation</h2>
          <p className="text-sm text-muted-foreground">
            Hiding a module removes it from the rail and the sidebar — nothing it protects with a
            permission is affected, and a direct link redirects home. Settings is never listed
            here; it cannot be hidden.
          </p>
        </div>
        <div className="flex flex-col">
          {allNavKeys().map((n) => (
            <Row key={n.id} label={n.label} keyName={n.id} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2 rounded-md border bg-card p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">In-page features</h2>
          <p className="text-sm text-muted-foreground">
            Capabilities inside a screen rather than a screen of their own.
          </p>
        </div>
        <div className="flex flex-col">
          {IN_PAGE_KEYS.map((f) => (
            <Row key={f.key} label={f.label} keyName={f.key} description={f.description} />
          ))}
        </div>
      </section>
    </div>
  );
}
