"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { TableSkeleton } from "@/components/sti/page";
import { CapitalSplitWidget, StatusWidget, MovementsWidget } from "@/components/dashboard-widgets";

/*
  The graphical reports (docs/20, C2): three thin pages over the same
  `dashboard.charts` aggregate the Command Center widgets use. One query,
  three frames — a report is a widget with a nav entry, which is exactly how
  the widget registry keeps them in step.
*/

const SLUGS = {
  "capital-split": {
    title: "Capital split",
    body: "Who pays for the fleet: projects versus departments, by acquisition cost.",
    widget: CapitalSplitWidget,
  },
  "fleet-status": {
    title: "Fleet by status",
    body: "Where the fleet sits right now — available, assigned, maintenance, reserved, lost.",
    widget: StatusWidget,
  },
  movements: {
    title: "Movement rate",
    body: "Ledger writes per week for the last eight weeks — the register's heartbeat.",
    widget: MovementsWidget,
  },
} as const;

type Slug = keyof typeof SLUGS;

export default function ChartReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const meta = SLUGS[slug as Slug];
  /* The charts query is the shared dependency; rendering the widget mounts it. */
  const charts = trpc.dashboard.charts.useQuery();

  if (!meta) {
    return (
      <div className="flex flex-col gap-6">
        <Link href="/reports" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
          All reports
        </Link>
        <p className="text-sm text-muted-foreground">No such report.</p>
      </div>
    );
  }

  const Widget = meta.widget;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/reports"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All reports
      </Link>
      <p className="max-w-[62ch] text-sm text-muted-foreground">{meta.body}</p>
      {charts.isLoading ? <TableSkeleton cols={2} /> : <Widget />}
    </div>
  );
}
