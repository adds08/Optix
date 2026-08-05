"use client";

import { use } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote, Metric } from "@/components/sti/page";
import { ReportTable, type Col } from "@/components/sti/report-table";
import { StatusPill, Tag } from "@/components/sti/status";
import { money, num } from "@/lib/format";
import { reportBySlug } from "../registry";

export default function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const meta = reportBySlug(slug);
  if (!meta) notFound();

  /* All queries are declared unconditionally — hooks rules — but only the
     one this page needs is enabled, so exactly one request goes out. */
  const on = (s: string) => ({ enabled: slug === s });
  const register = trpc.report.assetRegister.useQuery(undefined, on("asset-register"));
  const byProject = trpc.report.byProject.useQuery(undefined, on("by-project"));
  const byForeman = trpc.report.byForeman.useQuery(undefined, on("by-foreman"));
  const byMechanic = trpc.report.byMechanic.useQuery(undefined, on("by-mechanic"));
  const idle = trpc.report.idle.useQuery(undefined, on("idle"));
  const lost = trpc.report.lost.useQuery(undefined, on("lost"));
  const capital = trpc.report.capitalByProject.useQuery(undefined, on("capital-by-project"));
  const capitalDept = trpc.report.capitalByDepartment.useQuery(undefined, on("capital-by-department"));
  const needsTag = trpc.report.needsTag.useQuery(undefined, on("needs-tag"));

  const active = {
    "asset-register": register,
    "by-project": byProject,
    "by-foreman": byForeman,
    "by-mechanic": byMechanic,
    idle,
    lost,
    "capital-by-project": capital,
    "capital-by-department": capitalDept,
    "needs-tag": needsTag,
  }[slug];

  const back = (
    <Link
      href="/reports"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      All reports
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      {back}
      {active?.isLoading ? (
        <TableSkeleton />
      ) : active?.isError ? (
        <ErrorNote message="This report could not be loaded. Check that the API is running, then reload." />
      ) : (
        <Body
          slug={slug}
          data={{ register, byProject, byForeman, byMechanic, idle, lost, capital, capitalDept, needsTag }}
        />
      )}
    </div>
  );
}

type Q<T> = { data?: T };
type Bundle = {
  register: Q<RegisterRow[]>;
  byProject: Q<ProjectRow[]>;
  byForeman: Q<ForemanRow[]>;
  byMechanic: Q<MechanicRow[]>;
  idle: Q<IdleRow[]>;
  lost: Q<LostRow[]>;
  capital: Q<CapitalRow[]>;
  capitalDept: Q<CapitalDeptRow[]>;
  needsTag: Q<NeedsTagRow[]>;
};

type RegisterRow = {
  id: string; tag: string | null; make: string | null; modelNumber: string | null;
  description: string | null; otherRef: string | null; categoryName: string | null;
  serialNumber: string | null; status: string; condition: string | null;
  acquisitionCost: string | null; custodianName: string | null;
  currentProjectName: string | null; locationName: string | null;
  owningProjectName: string | null; owningDepartmentName: string | null;
};
type ProjectRow = { projectId: string; projectName: string; assetCount: number; totalValue: string };
type ForemanRow = { employeeId: string; foremanName: string; assetCount: number; totalValue: string; projectCount: number };
type MechanicRow = { employeeId: string; mechanicName: string; assetCount: number; totalValue: string };
type IdleRow = { tag: string | null; make: string | null; modelNumber: string | null; description: string | null; categoryName: string | null; locationName: string | null; acquisitionCost: string | null };
type LostRow = { tag: string | null; make: string | null; modelNumber: string | null; description: string | null; acquisitionCost: string | null; custodianName: string | null };
type CapitalRow = { projectId: string; projectName: string; assetCount: number; capitalValue: string };
type CapitalDeptRow = { departmentId: string; departmentName: string; assetCount: number; capitalValue: string };
type NeedsTagRow = { tag: string | null; make: string | null; modelNumber: string | null; description: string | null; serialNumber: string | null; categoryName: string | null; locationName: string | null; acquisitionCost: string | null };

const tagCell = (t: string | null) => <Tag>{t}</Tag>;

function Body({ slug, data }: { slug: string; data: Bundle }) {
  if (slug === "asset-register") {
    const rows = data.register.data ?? [];
    const cols: Col<RegisterRow>[] = [
      { key: "tag", header: "Tag", cell: (r) => tagCell(r.tag), width: "110px" },
      /* One joined model column on screen — three separate ones would crowd the
         table. The CSV export below still carries all three raw. */
      { key: "make", header: "Model", value: (r) => formatAssetModel(r), cell: (r) => formatAssetModel(r) || <span className="text-muted-foreground">Untagged tool</span> },
      { key: "categoryName", header: "Category" },
      { key: "status", header: "Status", cell: (r) => <StatusPill status={r.status} />, width: "130px" },
      { key: "custodianName", header: "Held by", value: (r) => r.custodianName ?? "In warehouse", cell: (r) => r.custodianName ?? <span className="text-muted-foreground">In warehouse</span> },
      { key: "currentProjectName", header: "On project" },
      { key: "locationName", header: "Location" },
      { key: "owningProjectName", header: "Charged to", value: (r) => r.owningDepartmentName ?? r.owningProjectName ?? "", cell: (r) => r.owningDepartmentName ?? r.owningProjectName ?? <span className="text-muted-foreground">—</span> },
      { key: "acquisitionCost", header: "Cost", numeric: true, value: (r) => Number(r.acquisitionCost ?? 0), cell: (r) => money(r.acquisitionCost) },
    ];
    const total = rows.reduce((s, r) => s + Number(r.acquisitionCost ?? 0), 0);
    return (
      <>
        <Summary items={[
          { label: "Assets", value: num(rows.length) },
          { label: "Fleet value", value: money(total) },
          { label: "In warehouse", value: num(rows.filter((r) => !r.custodianName).length) },
          { label: "Out with a custodian", value: num(rows.filter((r) => r.custodianName).length) },
        ]} />
        <ReportTable rows={rows} cols={cols} filename="asset-register"
          emptyTitle="No assets registered yet"
          emptyDescription="Import the fleet or add the first tool from the Tool Register." />
      </>
    );
  }

  if (slug === "by-project") {
    const rows = (data.byProject.data ?? []).filter((r) => Number(r.assetCount) > 0);
    const cols: Col<ProjectRow>[] = [
      { key: "projectName", header: "Project" },
      { key: "assetCount", header: "Assets", numeric: true, value: (r) => Number(r.assetCount) },
      { key: "totalValue", header: "Value on site", numeric: true, value: (r) => Number(r.totalValue), cell: (r) => money(r.totalValue) },
    ];
    return (
      <>
        <Summary items={[
          { label: "Projects holding tools", value: num(rows.length) },
          { label: "Assets deployed", value: num(rows.reduce((s, r) => s + Number(r.assetCount), 0)) },
          { label: "Value on site", value: money(rows.reduce((s, r) => s + Number(r.totalValue), 0)) },
        ]} />
        <ReportTable rows={rows} cols={cols} filename="assets-by-project"
          emptyTitle="No project currently holds a tool" />
      </>
    );
  }

  if (slug === "by-foreman") {
    const rows = (data.byForeman.data ?? []).filter((r) => Number(r.assetCount) > 0);
    const cols: Col<ForemanRow>[] = [
      { key: "foremanName", header: "Foreman" },
      { key: "assetCount", header: "Assets held", numeric: true, value: (r) => Number(r.assetCount) },
      { key: "projectCount", header: "Across projects", numeric: true, value: (r) => Number(r.projectCount) },
      { key: "totalValue", header: "Value held", numeric: true, value: (r) => Number(r.totalValue), cell: (r) => money(r.totalValue) },
    ];
    const multi = rows.filter((r) => Number(r.projectCount) > 1).length;
    return (
      <>
        <Summary items={[
          { label: "Foremen holding tools", value: num(rows.length) },
          { label: "On more than one project", value: num(multi), tone: multi ? "warn" : "default" },
          { label: "Value in the field", value: money(rows.reduce((s, r) => s + Number(r.totalValue), 0)) },
        ]} />
        <ReportTable rows={rows} cols={cols} filename="assets-by-foreman"
          emptyTitle="No foreman currently holds a tool" />
      </>
    );
  }

  if (slug === "by-mechanic") {
    const rows = (data.byMechanic.data ?? []).filter((r) => Number(r.assetCount) > 0);
    const cols: Col<MechanicRow>[] = [
      { key: "mechanicName", header: "Mechanic" },
      { key: "assetCount", header: "Assets held", numeric: true, value: (r) => Number(r.assetCount) },
      { key: "totalValue", header: "Value in the shop", numeric: true, value: (r) => Number(r.totalValue), cell: (r) => money(r.totalValue) },
    ];
    return (
      <>
        <Summary items={[
          { label: "Mechanics holding tools", value: num(rows.length) },
          { label: "Shop value", value: money(rows.reduce((s, r) => s + Number(r.totalValue), 0)) },
        ]} />
        <ReportTable rows={rows} cols={cols} filename="assets-by-mechanic"
          emptyTitle="No mechanic currently holds a tool" />
      </>
    );
  }

  if (slug === "idle") {
    const rows = data.idle.data ?? [];
    const cols: Col<IdleRow>[] = [
      { key: "tag", header: "Tag", cell: (r) => tagCell(r.tag), width: "110px" },
      { key: "make", header: "Model", value: (r) => formatAssetModel(r), cell: (r) => formatAssetModel(r) || <span className="text-muted-foreground">Untagged tool</span> },
      { key: "categoryName", header: "Category" },
      { key: "locationName", header: "Sitting at" },
      { key: "acquisitionCost", header: "Cost", numeric: true, value: (r) => Number(r.acquisitionCost ?? 0), cell: (r) => money(r.acquisitionCost) },
    ];
    return (
      <>
        <Summary items={[
          { label: "Idle tools", value: num(rows.length) },
          { label: "Idle capital", value: money(rows.reduce((s, r) => s + Number(r.acquisitionCost ?? 0), 0)), tone: "warn" },
        ]} />
        <ReportTable rows={rows} cols={cols} filename="idle-assets"
          emptyTitle="Nothing is sitting idle"
          emptyDescription="Every tool is assigned, in transit, or in maintenance." />
      </>
    );
  }

  if (slug === "lost") {
    const rows = data.lost.data ?? [];
    const cols: Col<LostRow>[] = [
      { key: "tag", header: "Tag", cell: (r) => tagCell(r.tag), width: "110px" },
      { key: "make", header: "Model", value: (r) => formatAssetModel(r), cell: (r) => formatAssetModel(r) || <span className="text-muted-foreground">Untagged tool</span> },
      { key: "custodianName", header: "Last custodian", value: (r) => r.custodianName ?? "Unknown" },
      { key: "acquisitionCost", header: "Write-down", numeric: true, value: (r) => Number(r.acquisitionCost ?? 0), cell: (r) => money(r.acquisitionCost) },
    ];
    return (
      <>
        <Summary items={[
          { label: "Tools missing", value: num(rows.length), tone: rows.length ? "crit" : "ok" },
          { label: "Total write-down", value: money(rows.reduce((s, r) => s + Number(r.acquisitionCost ?? 0), 0)), tone: rows.length ? "crit" : "ok" },
        ]} />
        <ReportTable rows={rows} cols={cols} filename="lost-assets"
          emptyTitle="Nothing is marked lost"
          emptyDescription="Every tool is accounted for against a custodian or a location." />
      </>
    );
  }

  if (slug === "needs-tag") {
    const rows = data.needsTag.data ?? [];
    const cols: Col<NeedsTagRow>[] = [
      { key: "make", header: "Tool", value: (r) => formatAssetModel(r), cell: (r) => formatAssetModel(r) || <span className="text-muted-foreground">Untagged tool</span> },
      { key: "serialNumber", header: "Serial", value: (r) => r.serialNumber ?? "", cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.serialNumber ?? "—"}</span> },
      { key: "categoryName", header: "Category" },
      { key: "locationName", header: "Sitting at" },
      { key: "acquisitionCost", header: "Cost", numeric: true, value: (r) => Number(r.acquisitionCost ?? 0), cell: (r) => money(r.acquisitionCost) },
    ];
    return (
      <>
        <Summary items={[
          { label: "Tools needing a label", value: num(rows.length), tone: rows.length ? "warn" : "ok" },
          { label: "With a serial", value: num(rows.filter((r) => r.serialNumber).length), hint: "identifiable without a tag" },
        ]} />
        <p className="text-sm text-muted-foreground">
          This is the worklist for whoever is holding the label gun. A tool gets a tag the
          moment somebody has written the number on it — the register never invents one.
        </p>
        <ReportTable rows={rows} cols={cols} filename="needs-tag"
          emptyTitle="Every tool is tagged"
          emptyDescription="Nothing is waiting for a label." />
      </>
    );
  }

  if (slug === "capital-by-department") {
    const rows = (data.capitalDept.data ?? []).filter((r) => Number(r.assetCount) > 0);
    const cols: Col<CapitalDeptRow>[] = [
      { key: "departmentName", header: "Department (financial owner)" },
      { key: "assetCount", header: "Assets purchased", numeric: true, value: (r) => Number(r.assetCount) },
      { key: "capitalValue", header: "Capital", numeric: true, value: (r) => Number(r.capitalValue), cell: (r) => money(r.capitalValue) },
    ];
    return (
      <>
        <Summary items={[
          { label: "Departments with capital", value: num(rows.length) },
          { label: "Shop capital", value: money(rows.reduce((s, r) => s + Number(r.capitalValue), 0)) },
        ]} />
        <p className="text-sm text-muted-foreground">
          What the shop paid for directly — tools charged to a department rather than to a
          project. Compare with Capital by Project for the full split of the fleet.
        </p>
        <ReportTable rows={rows} cols={cols} filename="capital-by-department"
          emptyTitle="No capital recorded against a department" />
      </>
    );
  }

  const rows = (data.capital.data ?? []).filter((r) => Number(r.assetCount) > 0);
  const cols: Col<CapitalRow>[] = [
    { key: "projectName", header: "Project (financial owner)" },
    { key: "assetCount", header: "Assets purchased", numeric: true, value: (r) => Number(r.assetCount) },
    { key: "capitalValue", header: "Capital", numeric: true, value: (r) => Number(r.capitalValue), cell: (r) => money(r.capitalValue) },
  ];
  return (
    <>
      <Summary items={[
        { label: "Projects with capital", value: num(rows.length) },
        { label: "Total capital", value: money(rows.reduce((s, r) => s + Number(r.capitalValue), 0)) },
      ]} />
      <p className="text-sm text-muted-foreground">
        This is who <em>paid</em>, not who is using it. A tool bought by Legacy West and now on
        Trinity Bridge is counted here against Legacy West — compare with Assets by Project to see
        the gap.
      </p>
      <ReportTable rows={rows} cols={cols} filename="capital-by-project"
        emptyTitle="No capital recorded against a project" />
    </>
  );
}

function Summary({
  items,
}: {
  items: { label: string; value: string; tone?: "default" | "warn" | "crit" | "ok"; hint?: string }[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((i) => (
        <Metric key={i.label} label={i.label} value={i.value} tone={i.tone} hint={i.hint} />
      ))}
    </div>
  );
}
