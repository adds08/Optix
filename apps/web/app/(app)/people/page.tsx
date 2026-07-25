"use client";

import { UserMinus, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, TableWrap, Metric } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { money } from "@/lib/format";

export default function PeoplePage() {
  const employees = trpc.employee.list.useQuery();
  const byForeman = trpc.report.byForeman.useQuery();
  const clearance = trpc.dashboard.clearanceQueue.useQuery();

  const rows = employees.data ?? [];
  const held = new Map((byForeman.data ?? []).map((f) => [f.employeeId, f]));
  const terminated = rows.filter((e) => e.employmentStatus === "terminated");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operations"
        title="People"
        description="Who can hold custody, and what they are still holding."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Active" value={rows.filter((e) => e.employmentStatus === "active").length} loading={employees.isLoading} />
        <Metric label="Terminated" value={terminated.length} loading={employees.isLoading} tone={terminated.length ? "warn" : "default"} />
        <Metric
          label="Held by terminated staff"
          value={clearance.data?.length ?? 0}
          loading={clearance.isLoading}
          tone={clearance.data?.length ? "crit" : "ok"}
          hint="blocks offboarding sign-off"
        />
      </div>

      {/* Clearance first — it's the thing with a deadline attached. */}
      {clearance.data?.length ? (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <UserMinus className="size-4 text-crit" />
            <h2 className="text-sm font-medium">HR clearance queue</h2>
          </div>
          <TableWrap className="border-crit/40">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-crit-bg/60">
                  {["Tag", "Model", "Last custodian", "Status", "Value"].map((h) => (
                    <th key={h} className="label-xs px-4 py-2.5 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clearance.data.map((c, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2.5"><Tag>{c.tag}</Tag></td>
                    <td className="px-4 py-2.5 font-medium">{c.modelName}</td>
                    <td className="px-4 py-2.5">{c.custodianName ?? "—"}</td>
                    <td className="px-4 py-2.5"><StatusPill status={c.status} /></td>
                    <td className="px-4 py-2.5 tnum">{money(c.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="text-sm text-muted-foreground">
            Each of these must be returned, transferred, or marked lost before offboarding is
            signed off. The blocking gate itself is specified but not yet built.
          </p>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Everyone</h2>
        {employees.isLoading ? (
          <TableSkeleton cols={5} />
        ) : employees.isError ? (
          <ErrorNote message="People could not be loaded." />
        ) : !rows.length ? (
          <EmptyState icon={Users} title="No people on file" />
        ) : (
          <TableWrap>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {["Name", "Role", "Primary project", "Status", "Tools held", "Value held"].map((h, i) => (
                    <th key={h} className={`label-xs px-4 py-2.5 ${i > 3 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const f = held.get(e.id);
                  return (
                    <tr key={e.id} className="border-b last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2.5 font-medium">{e.name}</td>
                      <td className="px-4 py-2.5">{humanize(e.role)}</td>
                      <td className="px-4 py-2.5">{e.primaryProjectName ?? "—"}</td>
                      <td className="px-4 py-2.5"><StatusPill status={e.employmentStatus} /></td>
                      <td className="px-4 py-2.5 text-right tnum">{f ? Number(f.assetCount) : 0}</td>
                      <td className="px-4 py-2.5 text-right tnum">{f ? money(f.totalValue) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
    </div>
  );
}
