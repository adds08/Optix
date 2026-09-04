"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, CheckCircle2, Wrench } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote, EmptyState, PageHeader } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { useJobScope } from "@/components/job-scope";
import { usePermissions } from "@/components/use-permissions";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";
import { shortDate, relative, idName } from "@/lib/format";

/*
  Assignments and transfers on one screen. Splitting them across two pages
  makes people navigate to answer a single question — "who has what, and
  what is moving" is one thought, not two.

  The Approval queue tab is the desk's half of the custody gate
  (`custodyOutcome`, packages/domain/src/rules.ts): a change worth the tenant's
  threshold or more is parked as `pending_approval` and nothing is written until
  someone signs it here. There is no verify control and no recipient
  accept/reject — the borrow/`pending_verification` flow was removed on
  2026-08-09 (see the rationale comments in routers/transfer.ts and rules.ts),
  and SYSTEM_PLAN §3 is a verification model, not an acceptance model: the
  receiving foreman is never asked to accept.
*/
export default function CustodyPage() {
  const [tab, setTab] = useState<"held" | "moving" | "queue">("held");
  /* Deep link from the home page's "Work the queue" cards. Read once on mount
     instead of useSearchParams, which would force a Suspense boundary around an
     otherwise self-contained client page. */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "queue") setTab("queue");
  }, []);

  const assignments = trpc.assignment.list.useQuery();
  const transfers = trpc.transfer.list.useQuery();
  /* The same query the home-page count reads, so approving here and the count
     dropping there are one invalidation, not two screens agreeing by luck. */
  const approvals = trpc.dashboard.pendingApprovals.useQuery();

  /* The two approve permissions are deliberately checked per row kind because
     the backend checks them per procedure — assignment.approve gates
     assignment rows, transfer.approve gates transfer rows. */
  const { has } = usePermissions();
  const canApprove = { assignment: has("assignment.approve"), transfer: has("transfer.approve") };

  const utils = trpc.useUtils();
  const [actionError, setActionError] = useState("");
  /* No bulk action reads any of these yet — turned on for consistency with
     the other registers. */
  const [heldSelected, setHeldSelected] = useState<Record<string, boolean>>({});
  const [movingSelected, setMovingSelected] = useState<Record<string, boolean>>({});
  const [queueSelected, setQueueSelected] = useState<Record<string, boolean>>({});
  /* On success the row leaves the queue because the queries refetch — the list
     is never edited locally, the server stays the only source of truth. */
  const acted = () => {
    setActionError("");
    utils.dashboard.pendingApprovals.invalidate();
    utils.assignment.list.invalidate();
    utils.transfer.list.invalidate();
    utils.asset.list.invalidate();
  };
  const failed = (e: { message: string }) => setActionError(e.message);
  const approveAssignment = trpc.assignment.approve.useMutation({ onSuccess: acted, onError: failed });
  const declineAssignment = trpc.assignment.decline.useMutation({ onSuccess: acted, onError: failed });
  const approveTransfer = trpc.transfer.approve.useMutation({ onSuccess: acted, onError: failed });
  const declineTransfer = trpc.transfer.decline.useMutation({ onSuccess: acted, onError: failed });
  const busy =
    approveAssignment.isPending || declineAssignment.isPending || approveTransfer.isPending || declineTransfer.isPending;

  /* System-wide project scope: a scoped user sees only custody on their jobs. */
  const { projectIds: scopeProjects } = useJobScope();
  const scoped = (a: { projectId?: string | null }) =>
    !scopeProjects || (a.projectId ? scopeProjects.has(a.projectId) : false);

  const active = (assignments.data ?? []).filter(
    (a) => a.status === "active" && scoped(a),
  );
  const inFlight = (transfers.data ?? []).filter((t) => t.status !== "completed" && t.status !== "cancelled");

  type HeldRow = (typeof active)[number];
  type TransferRow = NonNullable<(typeof transfers.data)>[number];
  type QueueRow = NonNullable<(typeof approvals.data)>[number];

  const queue = approvals.data ?? [];
  /* pendingApprovals carries names but not asset ids; the two list queries
     already on this page do, so the tag link is a lookup, not a new query. */
  const assetIdFor = (r: QueueRow) =>
    r.type === "assignment"
      ? assignments.data?.find((a) => a.id === r.id)?.assetId
      : transfers.data?.find((t) => t.id === r.id)?.assetId;

  const HELD_COLUMNS: ColumnDef<HeldRow>[] = useMemo(
    () => [
      col<HeldRow>({ header: "Code", accessorFn: (a) => a.tag ?? "", width: "6rem", cell: (a) => <Link href={`/tools/${a.assetId}`}><Tag>{a.tag}</Tag></Link> }),
      col<HeldRow>({ header: "Model", accessorFn: (a) => a.modelName ?? "", cell: (a) => <span className="font-medium">{a.modelName}</span> }),
      /* Person code before the name, same convention as every other identity
         on the board — the code is the stable key the desk knows. */
      col<HeldRow>({ header: "Held by", accessorFn: (a) => idName(a.custodianExternalId, a.custodianName), cell: (a) => (a.custodianName ? idName(a.custodianExternalId, a.custodianName) : "—") }),
      col<HeldRow>({ header: "Project", accessorFn: (a) => a.projectName ?? "", cell: (a) => (a.projectName ? idName(a.projectExternalId, a.projectName) : "—") }),
      col<HeldRow>({ header: "Rides in", accessorFn: (a) => a.locationName ?? "", cell: (a) => a.locationName ?? "—" }),
      col<HeldRow>({
        header: "Since",
        accessorFn: (a) => a.startDate ?? "",
        width: "8rem",
        cell: (a) => (a.startDate ? <span className="text-muted-foreground">{shortDate(a.startDate)}</span> : "—"),
      }),
      col<HeldRow>({
        header: "Status",
        accessorFn: (a) => a.status,
        width: "8rem",
        cell: (a) => <StatusPill status={a.status} />,
      }),
    ],
    [],
  );

  const MOVING_COLUMNS: ColumnDef<TransferRow>[] = useMemo(
    () => [
      col<TransferRow>({ header: "Code", accessorFn: (t) => t.tag ?? "", width: "6rem", cell: (t) => <Link href={`/tools/${t.assetId}`}><Tag>{t.tag}</Tag></Link> }),
      col<TransferRow>({ header: "Model", accessorFn: (t) => t.modelName ?? "", cell: (t) => <span className="font-medium">{t.modelName}</span> }),
      col<TransferRow>({ header: "Reason", accessorFn: (t) => String(t.reason ?? "").replace(/_/g, " "), cell: (t) => <span className="capitalize">{String(t.reason).replace(/_/g, " ")}</span> }),
      col<TransferRow>({ header: "Status", accessorFn: (t) => t.status, width: "9rem", cell: (t) => <StatusPill status={t.status} /> }),
      col<TransferRow>({ header: "Requested", accessorFn: (t) => (t.createdAt ? t.createdAt.toISOString() : ""), width: "8rem", cell: (t) => <span className="text-muted-foreground">{shortDate(t.createdAt)}</span> }),
      col<TransferRow>({ header: "Completed", accessorFn: (t) => (t.completedAt ? t.completedAt.toISOString() : ""), width: "8rem", cell: (t) => <span className="text-muted-foreground">{t.completedAt ? shortDate(t.completedAt) : "—"}</span> }),
    ],
    [],
  );

  /* Not memoised: the action cells close over permission and pending state,
     and a stale closure here is a button that fires with old state. */
  const QUEUE_COLUMNS: ColumnDef<QueueRow>[] = [
    col<QueueRow>({
      header: "Kind",
      accessorFn: (r) => r.type,
      width: "7rem",
      cell: (r) => <span className="capitalize">{r.type}</span>,
    }),
    col<QueueRow>({
      header: "Code",
      accessorFn: (r) => r.assetTag ?? "",
      width: "6rem",
      cell: (r) => {
        const assetId = assetIdFor(r);
        return assetId ? (
          <Link href={`/tools/${assetId}`}><Tag>{r.assetTag}</Tag></Link>
        ) : (
          <Tag>{r.assetTag}</Tag>
        );
      },
    }),
    col<QueueRow>({ header: "Model", accessorFn: (r) => r.assetModel ?? "", cell: (r) => <span className="font-medium">{r.assetModel}</span> }),
    col<QueueRow>({
      header: "Proposed change",
      accessorFn: (r) => r.custodianName ?? "",
      cell: (r) =>
        r.type === "transfer" ? (
          <span>{r.fromName ?? "—"} → {r.custodianName ?? "—"}</span>
        ) : (
          <span>issue to {r.custodianName ?? "—"}</span>
        ),
    }),
    col<QueueRow>({
      /* STI-206: the rig this movement goes out in. Same phrasing as the
         jobsite table's "Rides in" — one vocabulary for one fact, rather than
         inventing a third name for it here.

         A row with nothing recorded renders EMPTY, not "—" and not "no truck".
         After STI-202's three-state rule an absent vehicle is "this movement
         never said", which is different from "affirmatively no truck", and a
         dash reads like the latter. */
      header: "Rides in",
      accessorFn: (r) => [r.truckUnit, r.trailerUnit].filter(Boolean).join(" "),
      width: "11rem",
      sortable: false,
      cell: (r) => {
        if (!r.truckUnit && !r.trailerUnit) return null;
        return (
          <span className="text-muted-foreground">
            {r.truckUnit ? (
              <span>
                {r.truckUnit}
                {/* Company vs personal matters here specifically: the desk is
                    signing off company property moving on someone's own
                    truck. It is also the distinction the departure path keys
                    off. */}
                {r.truckOwnership === "personal_allowance" ? (
                  <span className="ml-1 rounded bg-warn-bg px-1 text-[10px] font-medium text-warn">
                    personal
                  </span>
                ) : null}
              </span>
            ) : null}
            {r.truckUnit && r.trailerUnit ? " · " : null}
            {r.trailerUnit ?? null}
          </span>
        );
      },
    }),
    col<QueueRow>({
      header: "Requested",
      accessorFn: (r) => (r.createdAt ? new Date(r.createdAt).toISOString() : ""),
      width: "8rem",
      cell: (r) => <span className="text-muted-foreground">{relative(r.createdAt)}</span>,
    }),
    col<QueueRow>({ header: "Status", accessorFn: (r) => r.status, width: "9rem", cell: (r) => <StatusPill status={r.status} /> }),
    col<QueueRow>({
      header: "",
      id: "actions",
      sortable: false,
      width: "12rem",
      cell: (r) => {
        /* Gated per kind because the backend gates per procedure. A user
           without the matching approve permission gets no controls at all —
           the queue stays readable so the desk can still answer "what is
           waiting", but only a signer can act. */
        if (!canApprove[r.type as "assignment" | "transfer"]) return null;
        const approve = () =>
          r.type === "assignment" ? approveAssignment.mutate({ id: r.id }) : approveTransfer.mutate({ id: r.id });
        const decline = () =>
          r.type === "assignment" ? declineAssignment.mutate({ id: r.id }) : declineTransfer.mutate({ id: r.id });
        return (
          <div className="flex justify-end gap-2">
            <Button size="sm" disabled={busy} onClick={approve}>Approve</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={decline}>Decline</Button>
          </div>
        );
      },
    }),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={ArrowLeftRight} title="Custody" hideTitle />
      {/* Counts ride on the tabs, so there is no card row here repeating them
          back. In-motion gets one line of text because it is not a tab of its
          own. Radix owns the tablist roles and roving focus (arrow keys move
          between tabs); the old hand-rolled pills had neither. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList variant="default">
            <TabsTrigger value="held">
              Held <span className="tnum opacity-75">{active.length}</span>
            </TabsTrigger>
            <TabsTrigger value="moving">
              Moving <span className="tnum opacity-75">{transfers.data?.length ?? 0}</span>
            </TabsTrigger>
            <TabsTrigger value="queue">
              Approval queue <span className="tnum opacity-75">{queue.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-sm text-muted-foreground">
          <span className="tnum">{inFlight.length}</span> in motion
        </p>
      </div>

      {tab === "held" ? (
        assignments.isLoading ? (
          <TableSkeleton cols={6} />
        ) : assignments.isError ? (
          <ErrorNote message="Assignments could not be loaded." />
        ) : !active.length ? (
          <EmptyState icon={Wrench} title="No tool is currently out" description="Everything is in the yard." />
        ) : (
          <DataTable<HeldRow>
            mode="client"
            columns={HELD_COLUMNS}
            rows={active}
            rowId={(a) => a.id}
            searchPlaceholder="Search held tools…"
            enableSelection
            selection={heldSelected}
            onSelectionChange={setHeldSelected}
          />
        )
      ) : tab === "moving" ? (
        transfers.isLoading ? (
          <TableSkeleton cols={5} />
        ) : transfers.isError ? (
          <ErrorNote message="Transfers could not be loaded." />
        ) : !transfers.data?.length ? (
          <EmptyState icon={ArrowLeftRight} title="No transfers recorded" />
        ) : (
          <DataTable<TransferRow>
            mode="client"
            columns={MOVING_COLUMNS}
            rows={transfers.data}
            rowId={(t) => t.id}
            searchPlaceholder="Search transfers…"
            enableSelection
            selection={movingSelected}
            onSelectionChange={setMovingSelected}
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {/* What a pending row *is* has to be said on the screen, not assumed:
              a desk operator who thinks these already happened will sign them
              as paperwork. Nothing in this queue has touched the register. */}
          <p className="max-w-3xl text-sm text-muted-foreground">
            Nothing here has happened yet. Each row is a proposed custody change — an{" "}
            <span className="font-medium text-foreground">assignment</span> issues a tool to a custodian, a{" "}
            <span className="font-medium text-foreground">transfer</span> moves it between custodians — parked because the
            tool&apos;s value meets the approval threshold. <span className="font-medium text-foreground">Approve</span> is the
            second signature: it commits the change and closes the previous holder&apos;s custody.{" "}
            <span className="font-medium text-foreground">Decline</span> records the refusal and the tool stays exactly where
            it is.
          </p>
          {actionError ? <ErrorNote message={actionError} /> : null}
          {approvals.isLoading ? (
            <TableSkeleton cols={6} />
          ) : approvals.isError ? (
            <ErrorNote message="The approval queue could not be loaded." />
          ) : !queue.length ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nothing is waiting for a signature"
              description="No custody change is parked for approval."
            />
          ) : (
            <DataTable<QueueRow>
              mode="client"
              columns={QUEUE_COLUMNS}
              rows={queue}
              rowId={(r) => r.id}
              searchPlaceholder="Search the queue…"
              enableSelection
              selection={queueSelected}
              onSelectionChange={setQueueSelected}
            />
          )}
        </div>
      )}
    </div>
  );
}
