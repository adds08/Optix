"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  Boxes,
  Download,
  HardHat,
  MapPin,
  MoreHorizontal,
  Pencil,
  Search,
  TriangleAlert,
  Truck,
  Undo2,
  UserPlus,
  Wrench,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { CUSTODIAN_ROLES, DEFAULT_HIGH_VALUE_THRESHOLD, formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, Metric } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { FacetGroup, FacetRow, ClearFacets, FilterPills } from "@/components/sti/facets";
import { FlagBadges, isHighValue, warrantyFlag } from "@/components/sti/flags";
import { ToolIcon } from "@/components/sti/tool-icon";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { AssetForm, type AssetEditable } from "@/components/asset-form";
import { AssignForm } from "@/components/assign-form";
import { TransferForm } from "@/components/transfer-form";
import { BulkMoveForm } from "@/components/bulk-move-form";
import { ContainerCustodyForm } from "@/components/container-custody-form";
import { VehicleForm, type VehicleEditable } from "@/components/vehicle-form";
import { PostingForm } from "@/components/posting-form";
import { EmployeeForm, type EmployeeEditable } from "@/components/employee-form";
import { SavedFilters } from "@/components/saved-filters";
import { usePermissions } from "@/components/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { FilterSheet } from "@/components/sti/data-table/filter-sheet";
import { downloadCsv } from "@/lib/csv";
import { exportAssetsToSpec } from "@/lib/export-assets";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  The Desk — every operation on one page.

  Three tabs, no hunting for a screen:
    Tools            — every tool with every column, inline assign / hand off /
                       return / repair / lost / edit, plus bulk move & return.
    Trucks & Trailers — who holds each unit, what it is hitched to, hand it over
                       or edit it in place.
    Foremen          — who is on which job and what they carry; move them to a
                       new project or edit their details.

  Everything writes through the same custody/ledger paths as the rest of the
  app, so a change made here is indistinguishable from one made anywhere else —
  same transactions, same audit trail.
*/

const STATUSES = ["available", "assigned", "in_maintenance", "reserved", "lost"] as const;
type FlagKey = "high_value" | "warranty" | "no_project";

const FLAG_LABELS: Record<FlagKey, string> = {
  high_value: "High value",
  warranty: "Warranty ending",
  no_project: "No project",
};

const TABS = [
  { key: "tools", label: "Tools", icon: Boxes },
  { key: "vehicles", label: "Trucks & Trailers", icon: Truck },
  { key: "foremen", label: "Foremen", icon: HardHat },
] as const;

function flagged(r: { currentProjectId?: string | null }, f: FlagKey): boolean {
  if (f === "high_value") return isHighValue(r as Parameters<typeof isHighValue>[0]);
  if (f === "warranty") return !!warrantyFlag(r as Parameters<typeof warrantyFlag>[0]);
  return !r.currentProjectId;
}

type Row = {
  id: string;
  tag: string | null;
  make?: string | null;
  modelNumber?: string | null;
  description?: string | null;
  serialNumber?: string | null;
  categoryName?: string | null;
  status?: string | null;
  acquisitionCost?: string | null;
  custodianId?: string | null;
  custodianName?: string | null;
  locationName?: string | null;
  currentProjectName?: string | null;
  owningDepartmentName?: string | null;
  owningProjectName?: string | null;
};

export default function DeskPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("tools");
  const { has } = usePermissions();
  const utils = trpc.useUtils();

  /* ---------- Tools tab ---------- */
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<string>("all");
  const [flags, setFlags] = useState<Set<FlagKey>>(new Set());
  const [project, setProject] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  /* One dialog at a time, driven by the row menu. */
  const [toolDialog, setToolDialog] = useState<{ kind: "assign" | "transfer" | "edit"; asset: Row } | null>(null);

  /* ---------- Trucks & Trailers tab ---------- */
  const [handing, setHanding] = useState<{
    id: string;
    name: string;
    custodianId?: string | null;
    custodianName?: string | null;
    toolCount: number;
  } | null>(null);
  const [editingVeh, setEditingVeh] = useState<VehicleEditable | null>(null);

  /* ---------- Foremen tab ---------- */
  const [moving, setMoving] = useState<{ id: string; name: string; projectId?: string | null } | null>(null);
  const [editingEmp, setEditingEmp] = useState<EmployeeEditable | null>(null);

  const list = trpc.asset.list.useQuery();
  const all = useMemo(() => list.data ?? [], [list.data]);
  const vehicles = trpc.vehicle.list.useQuery();
  const employees = trpc.employee.list.useQuery();
  const byForeman = trpc.report.byForeman.useQuery();

  /* Tools-aboard count, keyed by vehicle location. */
  const countByLocation = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of all) {
      if (!a.locationId) continue;
      m.set(a.locationId, (m.get(a.locationId) ?? 0) + 1);
    }
    return m;
  }, [all]);

  /* ---------- Tools filter + table ---------- */
  const scoped = useMemo(() => {
    if (project === "all") return all;
    return all.filter((r) => r.currentProjectId === project);
  }, [all, project]);

  const matches = useMemo(() => {
    return (r: (typeof all)[number], skip?: "category" | "status" | "flags") => {
      if (skip !== "category" && category !== "all" && (r.categoryName ?? "") !== category) return false;
      if (skip !== "status" && status !== "all" && r.status !== status) return false;
      if (skip !== "flags") {
        if (flags.has("high_value") && !isHighValue(r)) return false;
        if (flags.has("warranty") && !warrantyFlag(r)) return false;
        if (flags.has("no_project") && r.currentProjectId) return false;
      }
      return true;
    };
  }, [category, status, flags]);

  const filtered = useMemo(() => scoped.filter((r) => matches(r)), [scoped, matches]);

  const projectOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of all) {
      if (r.currentProjectId && r.currentProjectName) byId.set(r.currentProjectId, r.currentProjectName);
    }
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  const categories = useMemo(
    () => Array.from(new Set(all.map((r) => r.categoryName).filter((c): c is string => !!c))).sort(),
    [all],
  );

  const countBy = {
    category: (c: string) => scoped.filter((r) => (r.categoryName ?? "") === c && matches(r, "category")).length,
    anyCategory: () => scoped.filter((r) => matches(r, "category")).length,
    status: (s: string) => scoped.filter((r) => r.status === s && matches(r, "status")).length,
    anyStatus: () => scoped.filter((r) => matches(r, "status")).length,
    flag: (f: FlagKey) => scoped.filter((r) => flagged(r, f) && matches(r, "flags")).length,
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
  const filterCount = (category !== "all" ? 1 : 0) + (status !== "all" ? 1 : 0) + flags.size;

  const pills = [
    ...(category !== "all" ? [{ key: "cat", label: category, onRemove: () => setCategory("all") }] : []),
    ...(status !== "all" ? [{ key: "st", label: humanize(status), onRemove: () => setStatus("all") }] : []),
    ...Array.from(flags).map((f) => ({ key: f, label: FLAG_LABELS[f], onRemove: () => toggleFlag(f) })),
  ];

  const deskCurrent = useMemo(
    () => ({ project, category, status, flags: [...flags] }),
    [project, category, status, flags],
  );
  const applySaved = (f: Record<string, unknown>) => {
    setProject(typeof f.project === "string" ? f.project : "all");
    setCategory(typeof f.category === "string" ? f.category : "all");
    setStatus(typeof f.status === "string" ? f.status : "all");
    setFlags(
      new Set(
        Array.isArray(f.flags)
          ? (f.flags as unknown[]).filter((x): x is FlagKey => typeof x === "string" && x in FLAG_LABELS)
          : [],
      ),
    );
  };

  const editableFrom = (r: Row): AssetEditable => ({
    id: r.id,
    tag: r.tag ?? "",
    make: r.make,
    modelNumber: r.modelNumber,
    description: r.description,
    categoryName: r.categoryName,
    serialNumber: r.serialNumber,
    acquisitionCost: r.acquisitionCost,
  });

  const selectionRecord = useMemo(
    () => Object.fromEntries([...selectedIds].map((id) => [id, true])),
    [selectedIds],
  );
  const selectedLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of all) {
      if (selectedIds.has(r.id)) out[r.id] = r.tag ?? formatAssetModel(r) ?? "Untagged tool";
    }
    return out;
  }, [all, selectedIds]);

  const returnBulk = trpc.action.submit.useMutation({
    onSuccess: () => {
      utils.asset.list.invalidate();
      utils.assignment.list.invalidate();
      utils.transfer.list.invalidate();
      utils.dashboard.kpis.invalidate();
      utils.dashboard.pendingApprovals.invalidate();
      utils.dashboard.recentActivity.invalidate();
    },
  });

  const bulkReturn = async () => {
    const ids = [...selectedIds];
    setBulkError(null);
    try {
      for (let i = 0; i < ids.length; i += 50) {
        await returnBulk.mutateAsync({ type: "return", assetIds: ids.slice(i, i + 50) });
      }
      setSelectedIds(new Set());
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Could not return those tools. Try again.");
    }
  };

  const exportAll = () => {
    const rows = all.map((r) => ({
      tag: r.tag,
      make: r.make,
      modelNumber: r.modelNumber,
      description: r.description,
      categoryName: r.categoryName,
      serialNumber: r.serialNumber,
      quantity: r.quantity,
      acquisitionCost: r.acquisitionCost,
      acquisitionDate: r.acquisitionDate,
      warrantyExpiresOn: r.warrantyExpiresOn,
      condition: r.condition,
      otherRef: r.otherRef ?? null,
      locationName: r.locationName,
      owningProjectName: r.owningProjectName,
    }));
    downloadCsv(`stinventory-assets-export-${new Date().toISOString().slice(0, 10)}`, exportAssetsToSpec(rows));
  };

  const invalidateAll = () => {
    utils.asset.list.invalidate();
    utils.assignment.list.invalidate();
    utils.transfer.list.invalidate();
    utils.vehicle.list.invalidate();
    utils.location.list.invalidate();
    utils.employee.list.invalidate();
    utils.report.byForeman.invalidate();
    utils.dashboard.kpis.invalidate();
    utils.dashboard.pendingApprovals.invalidate();
    utils.dashboard.recentActivity.invalidate();
  };

  const rowAction = trpc.action.submit.useMutation({ onSuccess: invalidateAll });

  const TABLE_COLUMNS: ColumnDef<(typeof all)[number]>[] = useMemo(
    () => [
      col<(typeof all)[number]>({
        header: "Tag",
        accessorFn: (r) => r.tag ?? "",
        cell: (r) => (
          <Link href={`/tools/${r.id}`} className="hover:underline">
            <Tag>{r.tag ?? "Untagged"}</Tag>
          </Link>
        ),
      }),
      col<(typeof all)[number]>({
        header: "Tool",
        accessorFn: (r) => formatAssetModel(r),
        cell: (r) => (
          <Link href={`/tools/${r.id}`} className="flex items-center gap-2 font-medium hover:underline">
            <ToolIcon category={r.categoryName} className="size-4 shrink-0 text-muted-foreground" />
            {formatAssetModel(r) || "Untagged tool"}
          </Link>
        ),
      }),
      col<(typeof all)[number]>({
        header: "Category",
        accessorFn: (r) => r.categoryName ?? "",
        cell: (r) => r.categoryName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<(typeof all)[number]>({
        header: "Status",
        accessorFn: (r) => r.status,
        cell: (r) => <StatusPill status={r.status} />,
      }),
      col<(typeof all)[number]>({
        header: "Holder",
        accessorFn: (r) => r.custodianName ?? "",
        cell: (r) => r.custodianName ?? <span className="text-muted-foreground">In the yard</span>,
      }),
      col<(typeof all)[number]>({
        header: "Where",
        accessorFn: (r) => r.locationName ?? "",
        cell: (r) => r.locationName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<(typeof all)[number]>({
        header: "Project",
        accessorFn: (r) => r.currentProjectName ?? "",
        cell: (r) => r.currentProjectName ?? <span className="text-muted-foreground">—</span>,
      }),
      col<(typeof all)[number]>({
        header: "Cost",
        accessorFn: (r) => Number(r.acquisitionCost ?? 0),
        numeric: true,
        cell: (r) => (
          <span className={isHighValue(r) ? "font-semibold" : "text-muted-foreground"}>
            {money(r.acquisitionCost)}
          </span>
        ),
      }),
      col<(typeof all)[number]>({
        header: "Flags",
        sortable: false,
        cell: (r) => <FlagBadges asset={r} />,
      }),
      col<(typeof all)[number]>({
        header: "Serial",
        accessorFn: (r) => r.serialNumber ?? "",
        cell: (r) => (
          <span className="font-mono text-xs text-muted-foreground">{r.serialNumber ?? "—"}</span>
        ),
      }),
      col<(typeof all)[number]>({
        id: "actions",
        header: "",
        enableHiding: false,
        cell: (r) => {
          const a = r;
          const held = !!a.custodianId;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Actions for ${a.tag ?? "tool"}`}
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{a.tag ?? "Untagged tool"}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {held ? (
                  <>
                    {has("transfer.create") ? (
                      <DropdownMenuItem onSelect={() => setToolDialog({ kind: "transfer", asset: a })}>
                        <ArrowLeftRight /> Hand over to someone
                      </DropdownMenuItem>
                    ) : null}
                    {has("assignment.create") ? (
                      <DropdownMenuItem
                        onSelect={() => rowAction.mutate({ type: "return", assetIds: [a.id] })}
                      >
                        <Undo2 /> Return to yard
                      </DropdownMenuItem>
                    ) : null}
                  </>
                ) : has("assignment.create") ? (
                  <DropdownMenuItem onSelect={() => setToolDialog({ kind: "assign", asset: a })}>
                    <UserPlus /> Assign to someone
                  </DropdownMenuItem>
                ) : null}
                {has("asset.manage") ? (
                  <>
                    <DropdownMenuItem
                      onSelect={() => rowAction.mutate({ type: "repair", assetIds: [a.id] })}
                    >
                      <Wrench /> Send to repair
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => rowAction.mutate({ type: "lost", assetIds: [a.id] })}
                    >
                      <TriangleAlert /> Report lost
                    </DropdownMenuItem>
                  </>
                ) : null}
                <DropdownMenuItem onSelect={() => setToolDialog({ kind: "edit", asset: a })}>
                  <Pencil /> Edit details
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      }),
    ],
    [has, rowAction],
  );

  /* Everything shown — the desk is the place for the whole row. */
  const deskHidden = useMemo(
    () => Object.fromEntries(["Flags", "Serial"].map((h) => [h, false])),
    [],
  );

  const facetControls = (
    <>
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
        <FacetRow label={`High value (≥ ${money(DEFAULT_HIGH_VALUE_THRESHOLD)})`} count={countBy.flag("high_value")} active={flags.has("high_value")} onClick={() => toggleFlag("high_value")} />
        <FacetRow label="No project" count={countBy.flag("no_project")} active={flags.has("no_project")} onClick={() => toggleFlag("no_project")} />
        <FacetRow label="Warranty ending / expired" count={countBy.flag("warranty")} active={flags.has("warranty")} onClick={() => toggleFlag("warranty")} />
      </FacetGroup>
      {filtering ? <ClearFacets onClick={clearAll} /> : null}
    </>
  );

  /* ---------- KPIs ---------- */
  const activeForemen = (employees.data ?? []).filter(
    (e) =>
      e.employmentStatus === "active" &&
      CUSTODIAN_ROLES.includes(e.role as (typeof CUSTODIAN_ROLES)[number]),
  );
  const outWithSomeone = all.filter((a) => a.custodianId).length;
  const onWheels = all.filter((a) => a.locationType === "vehicle").length;

  const foremenRows = useMemo(() => {
    const held = new Map((byForeman.data ?? []).map((f) => [f.employeeId, f]));
    return activeForemen.map((e) => ({
      employeeId: e.id,
      name: e.name,
      projectName: e.primaryProjectName ?? null,
      projectId: e.primaryProjectId ?? null,
      assetCount: held.get(e.id)?.assetCount ?? 0,
      totalValue: held.get(e.id)?.totalValue ?? 0,
    }));
  }, [activeForemen, byForeman.data]);

  return (
    <div className="flex flex-col gap-6">
      {toolDialog?.kind === "assign" ? (
        <AssignForm open onClose={() => setToolDialog(null)} preselectedAssetId={toolDialog.asset.id} />
      ) : null}
      {toolDialog?.kind === "transfer" ? (
        <TransferForm
          open
          onClose={() => setToolDialog(null)}
          assetId={toolDialog.asset.id}
          assetTag={toolDialog.asset.tag ?? "Untagged tool"}
        />
      ) : null}
      {toolDialog?.kind === "edit" ? (
        <AssetForm open onClose={() => setToolDialog(null)} edit={editableFrom(toolDialog.asset)} />
      ) : null}
      {bulkOpen ? (
        <BulkMoveForm
          open
          onClose={() => setBulkOpen(false)}
          assetIds={[...selectedIds]}
          assetLabels={selectedLabels}
          onApplied={() => setSelectedIds(new Set())}
        />
      ) : null}
      {handing ? (
        <ContainerCustodyForm
          open
          onClose={() => setHanding(null)}
          locationId={handing.id}
          locationName={handing.name}
          currentCustodianId={handing.custodianId}
          currentCustodianName={handing.custodianName}
          toolCount={handing.toolCount}
        />
      ) : null}
      {editingVeh ? <VehicleForm open onClose={() => setEditingVeh(null)} edit={editingVeh} /> : null}
      {moving ? (
        <PostingForm
          open
          onClose={() => setMoving(null)}
          employeeId={moving.id}
          employeeName={moving.name}
          currentProjectId={moving.projectId}
        />
      ) : null}
      {editingEmp ? <EmployeeForm open onClose={() => setEditingEmp(null)} edit={editingEmp} /> : null}

      <PageHeader
        eyebrow="Operations"
        title="Desk"
        description="Everything on one page — tools, trucks, trailers, foremen. Change anything from here."
        actions={
          <>
            <ImportButton entity="asset" />
            <Button size="sm" variant="outline" onClick={exportAll} disabled={!all.length}>
              <Download className="size-4" aria-hidden />
              Export
            </Button>
            <CreateAction perm="asset.manage" label="New tool" Form={AssetForm} />
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Tools registered" value={all.length} loading={list.isLoading} />
        <Metric label="Out with foremen" value={outWithSomeone} loading={list.isLoading} />
        <Metric label="On trucks / trailers" value={onWheels} loading={list.isLoading} />
        <Metric label="Foremen carrying tools" value={foremenRows.filter((f) => f.assetCount > 0).length} loading={employees.isLoading || byForeman.isLoading} />
      </div>

      {/* Tab strip */}
      <div className="flex overflow-hidden rounded-sm border self-start" role="group" aria-label="Desk section">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs transition-colors",
                tab === t.key
                  ? "bg-muted font-medium text-foreground"
                  : "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "tools" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search tag, model or serial…"
                className="pl-8"
                aria-label="Search tools"
              />
            </div>
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
              aria-label="Filter by project"
              className="flex h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="all">All projects</option>
              {projectOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <FilterSheet title="Filter tools" activeCount={filterCount} onApply={() => {}} onClear={clearAll}>
              {facetControls}
            </FilterSheet>
            <span className="text-sm text-muted-foreground">
              <span className="tnum font-medium text-foreground">{filtered.length}</span> tools
            </span>
            <div className="ml-auto">
              <SavedFilters storageKey="desk-tools" current={deskCurrent} onApply={applySaved} hasActive={filtering} onClear={clearAll} />
            </div>
          </div>

          <FilterPills pills={pills} />

          {selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="text-sm font-medium">
                {selectedIds.size} tool{selectedIds.size === 1 ? "" : "s"} selected
              </span>
              <div className="ml-auto flex items-center gap-2">
                {has("transfer.create") ? (
                  <Button size="sm" onClick={() => { setBulkError(null); setBulkOpen(true); }}>
                    Move…
                  </Button>
                ) : null}
                {has("assignment.create") ? (
                  <Button size="sm" variant="outline" onClick={bulkReturn} disabled={returnBulk.isPending}>
                    {returnBulk.isPending ? "Returning…" : "Return to yard"}
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                  Clear
                </Button>
              </div>
              {bulkError ? <p className="w-full text-xs text-destructive">{bulkError}</p> : null}
            </div>
          ) : null}

          {list.isLoading ? (
            <TableSkeleton cols={8} />
          ) : list.isError ? (
            <ErrorNote message="The tool register could not be loaded. Check that the API is running, then reload." />
          ) : !filtered.length ? (
            <EmptyState icon={Boxes} title={filtering ? "No tools match" : "No tools registered yet"} description={filtering ? "Try a different search, or clear a filter." : "Import the fleet or register the first tool."} />
          ) : (
            <DataTable<(typeof all)[number]>
              mode="client"
              columns={TABLE_COLUMNS}
              rows={filtered}
              rowId={(r) => r.id}
              filterPredicate={matches}
              searchValue={q}
              onSearchChange={setQ}
              showToolbar={false}
              columnVisibilityInitial={deskHidden}
              enableSelection
              selection={selectionRecord}
              onSelectionChange={(sel) => setSelectedIds(new Set(Object.keys(sel)))}
              emptyTitle="No tools match"
              emptyDescription="Try a different search, or clear a filter."
            />
          )}
        </div>
      ) : null}

      {tab === "vehicles" ? (
        <div className="overflow-hidden rounded-md border">
          {vehicles.isLoading ? (
            <TableSkeleton cols={6} />
          ) : vehicles.isError ? (
            <ErrorNote message="Vehicles could not be loaded." />
          ) : !(vehicles.data ?? []).length ? (
            <EmptyState icon={Truck} title="No trucks or trailers" description="Add one to start assigning it to a foreman." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["Unit", "Type", "Held by", "Attached to", "Project", "Tools aboard", ""].map((h, i) => (
                      <th key={h || "actions"} className={cn("label-xs px-4 py-2.5", i >= 5 ? "text-right" : "text-left")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(vehicles.data ?? []).map((v) => (
                    <tr key={v.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2.5"><Tag>{v.unit}</Tag></td>
                      <td className="px-4 py-2.5 capitalize">{v.vehicleType}</td>
                      <td className="px-4 py-2.5">{v.foremanName ?? "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{v.attachedToUnit ? <Tag>{v.attachedToUnit}</Tag> : "—"}</td>
                      <td className="px-4 py-2.5">{v.projectName ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tnum">{v.locationId ? (countByLocation.get(v.locationId) ?? 0) : 0}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {has("location.manage") && v.locationId ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setHanding({
                                  id: v.locationId!,
                                  name: v.unit,
                                  custodianId: v.foremanEmployeeId,
                                  custodianName: v.foremanName,
                                  toolCount: v.locationId ? (countByLocation.get(v.locationId) ?? 0) : 0,
                                })
                              }
                            >
                              {v.foremanEmployeeId ? "Change" : "Hand over"}
                            </Button>
                          ) : null}
                          {has("vehicle.manage") ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setEditingVeh({
                                  id: v.id,
                                  unit: v.unit,
                                  vehicleType: v.vehicleType,
                                  plate: v.plate,
                                  makeModel: v.makeModel,
                                  ownershipType: v.ownershipType,
                                  projectId: v.projectId,
                                  attachedToVehicleId: v.attachedToVehicleId,
                                })
                              }
                            >
                              Edit
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === "foremen" ? (
        <div className="overflow-hidden rounded-md border">
          {employees.isLoading || byForeman.isLoading ? (
            <TableSkeleton cols={5} />
          ) : employees.isError || byForeman.isError ? (
            <ErrorNote message="Foremen could not be loaded." />
          ) : !foremenRows.length ? (
            <EmptyState icon={HardHat} title="No active foremen" description="Add foremen under People." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {["Name", "Job site", "Tools held", "Value carried", ""].map((h, i) => (
                      <th key={h || "actions"} className={cn("label-xs px-4 py-2.5", i >= 3 ? "text-right" : "text-left")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {foremenRows.map((f) => (
                    <tr key={f.employeeId} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2.5 font-medium">{f.name}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <MapPin className="size-3.5" aria-hidden />
                          {f.projectName ?? "No job assigned"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tnum">{f.assetCount}</td>
                      <td className="px-4 py-2.5 text-right tnum text-muted-foreground">{money(f.totalValue)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {has("employee.manage") ? (
                            <Button size="sm" variant="outline" onClick={() => setMoving({ id: f.employeeId, name: f.name, projectId: f.projectId })}>
                              Move to project
                            </Button>
                          ) : null}
                          {has("employee.manage") ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setEditingEmp({
                                  id: f.employeeId,
                                  name: f.name,
                                  role: (employees.data ?? []).find((e) => e.id === f.employeeId)?.role ?? "foreman",
                                })
                              }
                            >
                              Edit
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
