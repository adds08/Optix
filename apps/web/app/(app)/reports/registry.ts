import {
  Activity,
  BarChart3,
  Boxes,
  ChartArea,
  CircleSlash,
  DollarSign,
  HardHat,
  MapPin,
  PieChart,
  SearchX,
  Tag as TagIcon,
  Wrench,
} from "lucide-react";

/* One place that knows what reports exist, so the hub and the report pages
   can never fall out of step. `path` lets chart reports and the audit trail
   live under their own routes while staying in the same hub. */

export type ReportMeta = {
  slug: string;
  title: string;
  group: string;
  description: string;
  headlineLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  path?: string;
};

export const REPORTS: ReportMeta[] = [
  {
    slug: "asset-register",
    title: "Asset Register",
    group: "Inventory",
    description:
      "Every tool the company owns, with who holds it, where it is, and which project paid for it.",
    headlineLabel: "assets on the books",
    icon: Boxes,
  },
  {
    slug: "by-project",
    title: "Assets by Project",
    group: "Operations",
    description:
      "What each job site is currently holding — operational custody, not who was billed.",
    headlineLabel: "projects holding tools",
    icon: MapPin,
  },
  {
    slug: "by-foreman",
    title: "Assets by Foreman",
    group: "Operations",
    description:
      "Custody per person, across every project they work. The offboarding conversation starts here.",
    headlineLabel: "foremen holding tools",
    icon: HardHat,
  },
  {
    slug: "by-mechanic",
    title: "Assets by Mechanic",
    group: "Operations",
    description:
      "Shop custody — tools held by the mechanics, which are charged to a department rather than to any job.",
    headlineLabel: "mechanics holding tools",
    icon: Wrench,
  },
  {
    slug: "idle",
    title: "Idle Assets",
    group: "Utilization",
    description:
      "Available and sitting. Check this before approving a purchase request for something already owned.",
    headlineLabel: "tools sitting idle",
    icon: CircleSlash,
  },
  {
    slug: "lost",
    title: "Lost Assets",
    group: "Exceptions",
    description:
      "Marked missing and not yet found or written off, with the last known custodian and what it cost.",
    headlineLabel: "written down",
    icon: SearchX,
  },
  {
    slug: "needs-tag",
    title: "Needs a Tag",
    group: "Exceptions",
    description:
      "Every tool nobody has labelled yet. The worklist for whoever is holding the label gun.",
    headlineLabel: "tools without a label",
    icon: TagIcon,
  },
  {
    slug: "capital-by-project",
    title: "Capital by Project",
    group: "Finance",
    description:
      "Financial ownership — what each project actually paid for, regardless of where the tool sits today.",
    headlineLabel: "capital deployed",
    icon: DollarSign,
  },
  {
    slug: "capital-by-department",
    title: "Capital by Department",
    group: "Finance",
    description:
      "The other half of who pays for the fleet — tools charged to a department (like Repair & Maintenance) rather than to a job.",
    headlineLabel: "shop capital",
    icon: DollarSign,
  },
  {
    slug: "capital-split",
    title: "Capital Split",
    group: "Charts",
    description: "Projects versus departments, by acquisition cost.",
    headlineLabel: "who pays",
    icon: PieChart,
    path: "/reports/charts/capital-split",
  },
  {
    slug: "fleet-status",
    title: "Fleet by Status",
    group: "Charts",
    description: "The fleet's current distribution across statuses.",
    headlineLabel: "fleet shape",
    icon: BarChart3,
    path: "/reports/charts/fleet-status",
  },
  {
    slug: "movements",
    title: "Movement Rate",
    group: "Charts",
    description: "Ledger writes per week — the register's heartbeat.",
    headlineLabel: "activity rate",
    icon: ChartArea,
    path: "/reports/charts/movements",
  },
  {
    slug: "audit-trail",
    title: "Audit Trail",
    group: "Logs",
    description:
      "Every ledger write, searchable and paged. The single history for activity and logs.",
    headlineLabel: "ledger events",
    icon: Activity,
    path: "/reports/audit-trail",
  },
];

export function reportBySlug(slug: string): ReportMeta | undefined {
  return REPORTS.find((r) => r.slug === slug);
}
