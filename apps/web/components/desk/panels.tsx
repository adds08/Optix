"use client";

import Link from "next/link";
import { ArrowRight, Handshake, Users, Wrench } from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { Tag, StatusPill } from "@/components/sti/status";
import { Skeleton } from "@/components/ui/skeleton";

/*
  The Release 1 Desk panels — SYSTEM_PLAN §6.5 (STI-502).

  On reuse (STI-502 AC 2, "reused, not duplicated"). Every panel here calls the
  SAME tRPC procedure as the full-page screen it corresponds to, so the two
  cannot disagree about what a user may see: the scoping lives in the procedure
  (STI-302's ladder, applied to the query), not in either renderer.

  What they deliberately do NOT do is embed the pages. `/jobsites` is 746 lines
  of a working screen with its own filters, dialogs and pickers; a dashboard
  panel is a card. Wrapping the page would either produce a page inside a card
  or force the page to grow a "compact" mode — a second layout to keep in step
  with the first, which is the drift AC 2 exists to prevent. Each panel is a
  summary over the shared query with a link to the real screen.

  None of these is a security boundary. Each procedure carries its own
  `requirePermission` and its own scope; the registry decides what to RENDER.
*/

function PanelShell({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {href ? (
          <Link href={href} className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            {linkLabel ?? "Open"} <ArrowRight className="size-3.5" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/* ---- tools.mine ------------------------------------------------------- */

export function MyToolsPanel() {
  const me = trpc.identity.me.useQuery();
  const employeeId = me.data?.employeeId ?? undefined;
  const tools = trpc.asset.list.useQuery({ custodianId: employeeId }, { enabled: !!employeeId });

  /*
    An account with no employee record holds no custody and never will — the
    two are separate on purpose (STI-303). Rendering "you are not linked to a
    field record" on the Office Administrator's desk forever is noise, not
    information, so the panel removes itself. The registry decides IF a panel
    may appear; a panel decides whether it has anything to say.
  */
  if (!me.isLoading && !employeeId) return null;

  const rows = tools.data ?? [];

  return (
    <PanelShell title="My Tools" href="/my-tools" linkLabel="All mine">
      {me.isLoading || tools.isLoading ? (
        <Skeleton className="h-24" />
      ) : !rows.length ? (
        <Quiet>Nothing in your custody right now.</Quiet>
      ) : (
        <>
          <Quiet>
            You are holding {rows.length} tool{rows.length === 1 ? "" : "s"}.
          </Quiet>
          <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
            {rows.slice(0, 5).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 bg-card px-3 py-2 text-sm">
                <Tag>{t.tag}</Tag>
                <span className="min-w-0 flex-1 truncate">{formatAssetModel(t) || "Untagged tool"}</span>
                <StatusPill status={t.status} />
              </li>
            ))}
          </ul>
        </>
      )}
    </PanelShell>
  );
}

/* ---- crew.tools ------------------------------------------------------- */

export function CrewToolsPanel() {
  /*
    `employee.myForemen` walks `reportsToEmployeeId` — the same edge
    `assets.view.crew` resolves through in scope.ts, so the people named here
    and the tools the ladder lets through are the same set by construction.

    `asset.list` is already narrowed to the crew for this actor, so counting
    per foreman needs no second scoped query and cannot disagree with the
    register.
  */
  const foremen = trpc.employee.myForemen.useQuery();
  const tools = trpc.asset.list.useQuery({});

  const countByCustodian = new Map<string, number>();
  for (const t of tools.data ?? []) {
    if (t.custodianId) countByCustodian.set(t.custodianId, (countByCustodian.get(t.custodianId) ?? 0) + 1);
  }

  const crew = foremen.data ?? [];

  return (
    <PanelShell title="Crew Tools" href="/jobsites" linkLabel="By jobsite">
      {foremen.isLoading || tools.isLoading ? (
        <Skeleton className="h-24" />
      ) : !crew.length ? (
        <Quiet>Nobody reports to you yet, so there is no crew to show.</Quiet>
      ) : (
        <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
          {crew.map((f) => (
            <li key={f.id} className="flex items-center gap-3 bg-card px-3 py-2 text-sm">
              <Users className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-muted-foreground">{countByCustodian.get(f.id) ?? 0} tools</span>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}

/* ---- tools.by_jobsite -------------------------------------------------- */

export function ToolsByJobsitePanel() {
  /*
    §6.5: "Tools-by-jobsite shows holder, truck and trailer against each tool."
    `asset.list` carries `currentTruckUnit` and `currentTrailerUnit` off the
    ACTIVE assignment (STI-203), which is why this panel can answer it without
    a second query.

    Both are null when NOTHING WAS RECORDED, which after STI-202's three-state
    rule is an absence rather than a claim of "no truck" — so an unrecorded rig
    renders as silence, never as an empty slot that reads like "none".
  */
  const tools = trpc.asset.list.useQuery({});
  const rows = tools.data ?? [];

  const byProject = new Map<string, { name: string; count: number }>();
  for (const t of rows) {
    const key = t.currentProjectId ?? "none";
    const name = t.currentProjectName ?? "No job — in the yard";
    const cur = byProject.get(key) ?? { name, count: 0 };
    cur.count += 1;
    byProject.set(key, cur);
  }
  const jobs = [...byProject.values()].sort((a, b) => b.count - a.count);

  const withRig = rows.filter((t) => t.currentTruckUnit || t.currentTrailerUnit).length;

  return (
    <PanelShell title="Tools by Jobsite" href="/jobsites" linkLabel="Open">
      {tools.isLoading ? (
        <Skeleton className="h-24" />
      ) : !jobs.length ? (
        <Quiet>No tools are visible to you yet.</Quiet>
      ) : (
        <>
          <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
            {jobs.slice(0, 5).map((j) => (
              <li key={j.name} className="flex items-center gap-3 bg-card px-3 py-2 text-sm">
                <Wrench className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{j.name}</span>
                <span className="shrink-0 text-muted-foreground">{j.count} tools</span>
              </li>
            ))}
          </ul>
          <Quiet>
            {withRig} of {rows.length} record the truck or trailer they ride in.
          </Quiet>
        </>
      )}
    </PanelShell>
  );
}

/* ---- desk.queue -------------------------------------------------------- */

export function DeskQueuePanel() {
  /*
    The STI-105 approval queue, which STI-206 taught to carry the rig — the
    desk gives a second signature, and consent to a movement you cannot fully
    see is weaker than it looks.
  */
  const pending = trpc.dashboard.pendingApprovals.useQuery();
  const rows = pending.data ?? [];

  return (
    <PanelShell title="Awaiting the desk" href="/custody?tab=queue" linkLabel="Approval queue">
      {pending.isLoading ? (
        <Skeleton className="h-24" />
      ) : !rows.length ? (
        <Quiet>Nothing is waiting for a signature.</Quiet>
      ) : (
        <ul className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
          {rows.slice(0, 5).map((r) => (
            <li key={`${r.type}-${r.id}`} className="flex flex-wrap items-center gap-3 bg-card px-3 py-2 text-sm">
              <Handshake className="size-4 shrink-0 text-muted-foreground" />
              <Tag>{r.assetTag}</Tag>
              <span className="min-w-0 flex-1 truncate">{r.assetModel}</span>
              <span className="shrink-0 text-muted-foreground">
                {/* Silence when no rig was recorded — see the three-state rule. */}
                {[r.truckUnit, r.trailerUnit].filter(Boolean).join(" + ") || r.custodianName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
