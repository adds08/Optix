"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, LayoutGrid, Rows3 } from "lucide-react";
import { DEFAULT_HIGH_VALUE_THRESHOLD } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, TableWrap } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { FacetRail, FacetGroup, FacetRow, ClearFacets, FilterPills } from "@/components/sti/facets";
import { FlagBadges, isHighValue, warrantyFlag } from "@/components/sti/flags";
import { AssetCard } from "@/components/sti/asset-card";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { AssetForm, type AssetEditable } from "@/components/asset-form";
import { AssetActions } from "@/components/asset-actions";
import { RowActions } from "@/components/sti/row-actions";
import { Input } from "@/components/ui/input";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUSES = ["available", "assigned", "in_maintenance", "reserved", "lost"] as const;
type FlagKey = "high_value" | "warranty";

/*
  Only `search` is sent to the API. Category, status and flags are applied here
  on the client, because the facet counts have to be computed from the unfiltered
  set — asking the server for one status would throw away the numbers needed to
  label every other option. Worth revisiting if a tenant's fleet outgrows a
  single fetch; `asset.list` already accepts the filters when that day comes.
*/
export default function ToolsPage() {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<string>("all");
  const [flags, setFlags] = useState<Set<FlagKey>>(new Set());
  const [mode, setMode] = useState<"cards" | "table">("cards");
  /* The tool being edited, if any. */
  const [editing, setEditing] = useState<AssetEditable | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const utils = trpc.useUtils();

  const remove = trpc.asset.delete.useMutation({
    onSuccess: () => {
      setFailed(null);
      utils.asset.list.invalidate();
      utils.dashboard.kpis.invalidate();
    },
    /* The router refuses anything carrying history and says what to do
       instead. That sentence is the useful part — show it on the row. */
    onError: (e, vars) => setFailed({ id: vars.id, message: e.message }),
  });

  const list = trpc.asset.list.useQuery({ search: q.trim() || undefined });
  const all = useMemo(() => list.data ?? [], [list.data]);

  const matches = useMemo(() => {
    /* `skip` lifts one filter so a facet can count its own options. */
    return (r: (typeof all)[number], skip?: "category" | "status" | "flags") => {
      if (skip !== "category" && category !== "all" && (r.categoryName ?? "") !== category) return false;
      if (skip !== "status" && status !== "all" && r.status !== status) return false;
      if (skip !== "flags") {
        if (flags.has("high_value") && !isHighValue(r)) return false;
        if (flags.has("warranty") && !warrantyFlag(r)) return false;
      }
      return true;
    };
  }, [category, status, flags]);

  const rows = useMemo(() => all.filter((r) => matches(r)), [all, matches]);

  const categories = useMemo(
    () => Array.from(new Set(all.map((r) => r.categoryName).filter((c): c is string => !!c))).sort(),
    [all],
  );

  const countBy = {
    category: (c: string) => all.filter((r) => (r.categoryName ?? "") === c && matches(r, "category")).length,
    anyCategory: () => all.filter((r) => matches(r, "category")).length,
    status: (s: string) => all.filter((r) => r.status === s && matches(r, "status")).length,
    anyStatus: () => all.filter((r) => matches(r, "status")).length,
    flag: (f: FlagKey) =>
      all.filter((r) => (f === "high_value" ? isHighValue(r) : !!warrantyFlag(r)) && matches(r, "flags")).length,
  };

  const toggleFlag = (f: FlagKey) =>
    setFlags((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const clearAll = () => {
    setCategory("all");
    setStatus("all");
    setFlags(new Set());
  };

  const filtering = category !== "all" || status !== "all" || flags.size > 0;

  const pills = [
    ...(category !== "all" ? [{ key: "cat", label: category, onRemove: () => setCategory("all") }] : []),
    ...(status !== "all" ? [{ key: "st", label: humanize(status), onRemove: () => setStatus("all") }] : []),
    ...Array.from(flags).map((f) => ({
      key: f,
      label: f === "high_value" ? "High value" : "Warranty ending",
      onRemove: () => toggleFlag(f),
    })),
  ];

  const rowActionsFor = (r: (typeof all)[number]) => (
    <RowActions
      perm="asset.manage"
      label={r.tag}
      /* Assign / Transfer / Return, the same control the detail
         page uses — so acting on a tool no longer means opening
         it first. */
      extra={<AssetActions assetId={r.id} assetTag={r.tag} heldBySomeone={!!r.custodianId} />}
      onEdit={() =>
        setEditing({
          id: r.id,
          tag: r.tag,
          modelName: r.modelName,
          categoryName: r.categoryName,
          serialNumber: r.serialNumber,
          quantity: r.quantity,
          acquisitionCost: r.acquisitionCost,
          acquisitionDate: r.acquisitionDate,
          condition: r.condition,
          owningProjectId: r.owningProjectId,
        })
      }
      onDelete={() => remove.mutate({ id: r.id })}
      deleting={remove.isPending}
      error={failed?.id === r.id ? failed.message : null}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {editing ? <AssetForm open onClose={() => setEditing(null)} edit={editing} /> : null}
      <PageHeader
        eyebrow="Equipment"
        title="Tool Register"
        description="Every serialized tool and bulk line the company owns. Open one to see its full custody chain."
        actions={
          <>
            <ImportButton entity="asset" />
            <CreateAction perm="asset.manage" label="New tool" Form={AssetForm} />
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[13rem_1fr] lg:items-start">
        <FacetRail className="lg:sticky lg:top-4">
          <FacetGroup title="Category">
            <FacetRow label="All categories" count={countBy.anyCategory()} active={category === "all"} onClick={() => setCategory("all")} />
            {categories.map((c) => (
              <FacetRow key={c} label={c} count={countBy.category(c)} active={category === c} indent onClick={() => setCategory(c)} />
            ))}
          </FacetGroup>

          <FacetGroup title="Status">
            <FacetRow label="Any status" count={countBy.anyStatus()} active={status === "all"} onClick={() => setStatus("all")} />
            {STATUSES.map((s) => (
              <FacetRow key={s} label={humanize(s)} count={countBy.status(s)} active={status === s} indent onClick={() => setStatus(s)} />
            ))}
          </FacetGroup>

          <FacetGroup title="Flags">
            <FacetRow
              label={`High value (≥ ${money(DEFAULT_HIGH_VALUE_THRESHOLD)})`}
              count={countBy.flag("high_value")}
              active={flags.has("high_value")}
              onClick={() => toggleFlag("high_value")}
            />
            <FacetRow
              label="Warranty ending / expired"
              count={countBy.flag("warranty")}
              active={flags.has("warranty")}
              onClick={() => toggleFlag("warranty")}
            />
          </FacetGroup>

          {filtering ? <ClearFacets onClick={clearAll} /> : null}
        </FacetRail>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by tag, model or serial…"
              className="max-w-sm"
              aria-label="Search tools"
            />
            <span className="text-sm text-muted-foreground">
              <span className="tnum font-medium text-foreground">{rows.length}</span>
              {rows.length !== all.length ? <> of <span className="tnum">{all.length}</span></> : null} tools
            </span>

            <div className="ml-auto flex overflow-hidden rounded-sm border" role="group" aria-label="View mode">
              {([["cards", "Cards", LayoutGrid], ["table", "Table", Rows3]] as const).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMode(k)}
                  aria-pressed={mode === k}
                  /* A segmented control, not a call to action. Which view you
                     are in is minor state; a filled brand button gave it more
                     weight than the tools it was showing. */
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors",
                    mode === k
                      ? "bg-muted font-medium text-foreground"
                      : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <FilterPills pills={pills} />

          {list.isLoading ? (
            <TableSkeleton cols={6} />
          ) : list.isError ? (
            <ErrorNote message="The tool register could not be loaded. Check that the API is running, then reload." />
          ) : !rows.length ? (
            <EmptyState
              icon={Boxes}
              title={q || filtering ? "No tools match" : "No tools registered yet"}
              description={
                q || filtering
                  ? "Try a different search, or clear a filter in the left rail."
                  : "Import the existing fleet, or register the first tool to start the custody chain."
              }
            />
          ) : mode === "cards" ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {rows.map((r) => (
                <AssetCard key={r.id} row={r} actions={rowActionsFor(r)} />
              ))}
            </div>
          ) : (
            <TableWrap>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["Tag", "Model", "Status", "Flags", "Held by", "On project", "Location", "Cost", ""].map((h, i) => (
                      <th key={h || "actions"} className={cn("label-xs px-4 py-2.5 text-left", i >= 7 && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const heavy = isHighValue(r);
                    return (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/40">
                        {/* The same quiet edge the card uses, so the two views
                            agree about what "expensive" looks like. */}
                        <td className={cn("px-4 py-2.5", heavy && "shadow-[inset_2px_0_0_var(--primary)]")}>
                          <Link href={`/tools/${r.id}`} className="hover:underline">
                            <Tag>{r.tag}</Tag>
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <Link href={`/tools/${r.id}`} className="font-medium hover:underline">
                            {r.modelName}
                          </Link>
                          {r.categoryName ? (
                            <span className="block text-xs text-muted-foreground">{r.categoryName}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
                        <td className="px-4 py-2.5"><FlagBadges asset={r} /></td>
                        <td className="px-4 py-2.5">
                          {r.custodianName ?? <span className="text-muted-foreground">In warehouse</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {r.currentProjectName ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {r.locationName ?? <span className="text-muted-foreground">—</span>}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-2.5 text-right tnum",
                            heavy ? "font-semibold" : "text-muted-foreground",
                          )}
                        >
                          {money(r.acquisitionCost)}
                        </td>
                        <td className="px-4 py-2.5">{rowActionsFor(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </div>
      </div>
    </div>
  );
}
