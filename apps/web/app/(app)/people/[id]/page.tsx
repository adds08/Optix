"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, HardHat, Truck } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { PostingForm } from "@/components/posting-form";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { money, shortDate } from "@/lib/format";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/*
  One person: what they are holding right now, and every job they have held it on.

  This is the screen the custody model was built for. Because tools follow the
  foreman rather than the site, the answer to "what was working on Legacy West
  in March?" is not stored anywhere — it is this posting history crossed with
  the tools in this person's custody. Putting both on one page is what makes
  that reconstruction a glance instead of a query.
*/
export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const person = trpc.employee.get.useQuery({ id });
  const postings = trpc.employee.postings.useQuery({ employeeId: id });
  const held = trpc.asset.list.useQuery({ custodianId: id });
  /*
    Trucks and trailers, not small tools — a different table, `vehicle`, and a
    different custody field (`foremanEmployeeId`, mirroring
    `location.custodianEmployeeId` on the vehicle's own location row, per that
    column's comment). `vehicle.list` has no per-custodian filter server-side —
    it scopes by project visibility, not by person — so the whole visible fleet
    comes down and this page narrows it, exactly the client-side pattern
    `.claude/rules/web.md` already uses for the register's own filters.
  */
  const vehicles = trpc.vehicle.list.useQuery();
  const [moving, setMoving] = useState(false);
  /* No bulk action reads either of these yet — turned on for consistency
     with the other registers. */
  const [heldSelected, setHeldSelected] = useState<Record<string, boolean>>({});
  const [postingsSelected, setPostingsSelected] = useState<Record<string, boolean>>({});
  const [equipmentSelected, setEquipmentSelected] = useState<Record<string, boolean>>({});
  /*
    One tab strip for everything this page shows about the person, rather than
    a tabbed pair sitting above a third, always-visible table below it — asked
    for directly: "add everything to such tab, like Job history, Small Tools
    assigned, equipment assigned and so on".

    Tools and Equipment are further gated on `role.canHoldCustody` —
    `roleCanHoldCustody` below — because "not all roles have this anyway", also
    said directly. A PM or an office admin cannot be named a custodian by
    anything in this system, so their two tabs would always render the empty
    state; that is not a state worth a tab, it is noise on every PM's page.
    Job history has no such gate: `employeeProjectAssignment` is written for a
    posting regardless of custody, so anyone who has ever been moved through
    this screen has one.
  */
  const [custodyTab, setCustodyTab] = useState<"tools" | "equipment" | "history">("tools");

  const p = person.data;
  const tools = held.data ?? [];
  const value = tools.reduce((sum, t) => sum + Number(t.acquisitionCost ?? 0), 0);
  const equipment = useMemo(
    () => (vehicles.data ?? []).filter((v) => v.foremanEmployeeId === id),
    [vehicles.data, id],
  );

  type ToolRow = (typeof tools)[number];
  type PostingRow = NonNullable<(typeof postings.data)>[number];
  type EquipmentRow = (typeof equipment)[number];

  /* Default false (never gate on an undefined value): a role that has not
     loaded yet must not flash the custody tabs and then yank them away once
     `roleCanHoldCustody` arrives, which is worse than the reverse. */
  const canHoldCustody = p?.roleCanHoldCustody ?? false;

  /* Switch the default tab ONCE, the moment every query this decision needs
     has actually answered — not on every render, or a person with neither
     tool nor truck would get yanked back to "tools" the instant a background
     refetch resolves. Lands on Job history for anyone whose role cannot hold
     custody at all, since Tools/Equipment are not even offered to them. */
  const [defaulted, setDefaulted] = useState(false);
  useEffect(() => {
    if (defaulted || person.isLoading || held.isLoading || vehicles.isLoading) return;
    if (!canHoldCustody) setCustodyTab("history");
    else if (!tools.length && equipment.length) setCustodyTab("equipment");
    setDefaulted(true);
  }, [defaulted, person.isLoading, held.isLoading, vehicles.isLoading, canHoldCustody, tools.length, equipment.length]);

  const HELD_COLUMNS: ColumnDef<ToolRow>[] = useMemo(
    () => [
      /* THE tool's code, not the manufacturer's serial — same rule as every
         other register (`docs/architecture/02-identity-naming.md`). Renders
         `—` for a tool nobody has labelled yet, which is a normal state. */
      col<ToolRow>({ header: "Code", accessorFn: (t) => t.code ?? "", width: "7rem", cell: (t) => <Link href={`/tools/${t.id}`} className="hover:underline">{t.code ? <Tag>{t.code}</Tag> : <span className="text-muted-foreground">—</span>}</Link> }),
      col<ToolRow>({ header: "Model", accessorFn: (t) => formatAssetModel(t), cell: (t) => <span className="font-medium">{formatAssetModel(t) || "Untagged tool"}</span> }),
      col<ToolRow>({ header: "On project", accessorFn: (t) => t.currentProjectName ?? "", cell: (t) => t.currentProjectName ?? "—" }),
      col<ToolRow>({ header: "Charged to", accessorFn: (t) => t.owningDepartmentName ?? t.owningProjectName ?? "", cell: (t) => <span className="text-muted-foreground">{t.owningDepartmentName ?? t.owningProjectName ?? "—"}</span> }),
      col<ToolRow>({ header: "Status", accessorFn: (t) => t.status, width: "8rem", cell: (t) => <StatusPill status={t.status} /> }),
      col<ToolRow>({ header: "Value", accessorFn: (t) => Number(t.acquisitionCost ?? 0), numeric: true, width: "7rem", cell: (t) => <span className="tnum">{money(t.acquisitionCost)}</span> }),
    ],
    [],
  );

  const EQUIPMENT_COLUMNS: ColumnDef<EquipmentRow>[] = useMemo(
    () => [
      /* Code leads, exactly the small-tools convention — the same rename that
         made `asset.code` honest applies here (`vehicle.code`). */
      col<EquipmentRow>({ header: "Code", accessorFn: (v) => v.code ?? "", width: "7rem", cell: (v) => <Link href={`/equipment/${v.id}`} className="hover:underline">{v.code ? <Tag>{v.code}</Tag> : <span className="text-muted-foreground">—</span>}</Link> }),
      col<EquipmentRow>({ header: "Unit", accessorFn: (v) => v.unit ?? "", width: "7rem", cell: (v) => v.unit ?? <span className="text-muted-foreground">—</span> }),
      col<EquipmentRow>({ header: "Description", accessorFn: (v) => v.description ?? v.makeModel ?? "", cell: (v) => <span className="font-medium">{v.description ?? v.makeModel ?? "—"}</span> }),
      col<EquipmentRow>({ header: "On project", accessorFn: (v) => v.projectName ?? "", cell: (v) => v.projectName ?? "—" }),
      col<EquipmentRow>({ header: "Status", accessorFn: (v) => v.status, width: "8rem", cell: (v) => <StatusPill status={v.status} /> }),
    ],
    [],
  );

  const POSTING_COLUMNS: ColumnDef<PostingRow>[] = useMemo(
    () => [
      col<PostingRow>({ header: "Project", accessorFn: (r) => r.projectName ?? "", cell: (r) => <span className="font-medium">{r.projectName ?? "—"}</span> }),
      col<PostingRow>({ header: "Project Code", accessorFn: (r) => r.projectExternalId ?? "", width: "8rem", cell: (r) => (r.projectExternalId ? <Tag>{r.projectExternalId}</Tag> : "—") }),
      col<PostingRow>({ header: "From", accessorFn: (r) => r.startedOn ?? "", width: "8rem", cell: (r) => shortDate(r.startedOn) }),
      col<PostingRow>({ header: "To", accessorFn: (r) => r.endedOn ?? "", width: "8rem", cell: (r) => (r.endedOn ? shortDate(r.endedOn) : <span className="text-ok">current</span>) }),
      col<PostingRow>({ header: "Note", accessorFn: (r) => r.note ?? "", cell: (r) => <span className="text-muted-foreground">{r.note ?? "—"}</span> }),
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/people"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        People
      </Link>

      {person.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-96" />
        </div>
      ) : person.isError ? (
        <ErrorNote message="This person could not be loaded. Check that the API is running, then reload." />
      ) : !p ? (
        <EmptyState
          title="No such person"
          description="This record does not exist in your tenant, or it was removed."
          action={
            <Link href="/people" className="text-sm font-medium text-primary hover:underline">
              Back to People
            </Link>
          }
        />
      ) : (
        <>
          <PageHeader
            eyebrow={humanize(p.role)}
            title={p.name}
            description={
              p.externalId ? `Employee ${p.externalId}` : undefined
            }
            actions={
              <div className="flex flex-wrap items-center gap-3">
                <Can perm="employee.manage">
                  <Button size="sm" onClick={() => setMoving(true)}>
                    <HardHat className="size-4" aria-hidden />
                    Move to a project
                  </Button>
                </Can>
                <StatusPill status={p.employmentStatus} className="text-xs" />
              </div>
            }
          />
          {moving ? (
            <PostingForm
              open={moving}
              onClose={() => setMoving(false)}
              employeeId={id}
              employeeName={p.name}
              currentProjectId={p.primaryProjectId}
            />
          ) : null}

          <dl className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 lg:grid-cols-5">
            <Field
              label="On project"
              value={p.primaryProjectName ?? <span className="text-muted-foreground">unposted</span>}
            />
            <Field label="Reports to" value={p.reportsToName ?? <span className="text-muted-foreground">—</span>} />
            <Field label="Tools held" value={held.isLoading ? "…" : String(tools.length)} />
            <Field
              label="Value held"
              value={held.isLoading ? "…" : money(value)}
              hint="sum of acquisition cost"
            />
            <Field label="Equipment held" value={vehicles.isLoading ? "…" : String(equipment.length)} />
          </dl>

          {p.employmentStatus === "terminated" && tools.length ? (
            <p className="rounded-md border border-crit/30 bg-crit-bg px-3 py-2 text-sm text-crit">
              This person is terminated and still holds {tools.length}{" "}
              {tools.length === 1 ? "tool" : "tools"}. Stated as a fact, not a gate: nothing
              blocks an offboarding, and the ledger keeps the history either way.
            </p>
          ) : null}

          {/*
            One tab strip for everything the page has about this person, not a
            tabbed pair with a third table always visible underneath. Tools and
            Equipment are two different tables (`asset` vs `vehicle`) with two
            different custody fields; Job history is `employeeProjectAssignment`
            and applies whether or not the person can hold custody at all.

            Tools/Equipment are OMITTED, not disabled, for a role that cannot
            hold custody (`roleCanHoldCustody`) — "not all roles have this
            anyway". A tab that always opens on an empty state is not a
            feature, it is a click that goes nowhere, on every PM's page.

            Equipment was absent entirely until 2026-09-07: this page never
            queried `vehicle`, so a foreman's own trailer never showed up here
            even though `/equipment` already named him its custodian.
          */}
          <section className="flex flex-col gap-3">
            <Tabs value={custodyTab} onValueChange={(v) => setCustodyTab(v as typeof custodyTab)}>
              <TabsList variant="default">
                {canHoldCustody ? (
                  <>
                    <TabsTrigger value="tools">
                      Tools <span className="tnum opacity-75">{held.isLoading ? "…" : tools.length}</span>
                    </TabsTrigger>
                    <TabsTrigger value="equipment">
                      Equipment <span className="tnum opacity-75">{vehicles.isLoading ? "…" : equipment.length}</span>
                    </TabsTrigger>
                  </>
                ) : null}
                <TabsTrigger value="history">
                  Job history <span className="tnum opacity-75">{postings.isLoading ? "…" : postings.data?.length ?? 0}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {custodyTab === "tools" && canHoldCustody ? (
              held.isLoading ? (
                <TableSkeleton cols={5} />
              ) : held.isError ? (
                <ErrorNote message="Their tools could not be loaded." />
              ) : !tools.length ? (
                <EmptyState icon={Boxes} title="Holding nothing" description="No tool in the register names this person as custodian." />
              ) : (
                <DataTable<ToolRow>
                  mode="client"
                  columns={HELD_COLUMNS}
                  rows={tools}
                  rowId={(t) => t.id}
                  searchPlaceholder="Search their tools…"
                  enableSelection
                  selection={heldSelected}
                  onSelectionChange={setHeldSelected}
                />
              )
            ) : custodyTab === "equipment" && canHoldCustody ? (
              vehicles.isLoading ? (
                <TableSkeleton cols={5} />
              ) : vehicles.isError ? (
                <ErrorNote message="Their equipment could not be loaded." />
              ) : !equipment.length ? (
                <EmptyState icon={Truck} title="Hauling nothing" description="No truck or trailer in the register names this person as custodian." />
              ) : (
                <DataTable<EquipmentRow>
                  mode="client"
                  columns={EQUIPMENT_COLUMNS}
                  rows={equipment}
                  rowId={(v) => v.id}
                  searchPlaceholder="Search their equipment…"
                  enableSelection
                  selection={equipmentSelected}
                  onSelectionChange={setEquipmentSelected}
                />
              )
            ) : postings.isLoading ? (
              <TableSkeleton rows={3} cols={4} />
            ) : postings.isError ? (
              <ErrorNote message="The job history could not be loaded." />
            ) : !postings.data?.length ? (
              <EmptyState
                icon={HardHat}
                title="No postings recorded"
                description="Their job history starts the first time they are moved through this screen."
              />
            ) : (
              <DataTable<PostingRow>
                mode="client"
                columns={POSTING_COLUMNS}
                rows={postings.data}
                rowId={(r) => r.id}
                searchPlaceholder="Search job history…"
                enableSelection
                selection={postingsSelected}
                onSelectionChange={setPostingsSelected}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-card p-4">
      <dt className="label-xs">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}
