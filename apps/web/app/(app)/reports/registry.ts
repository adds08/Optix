import {
  Boxes,
  CircleSlash,
  DollarSign,
  HardHat,
  MapPin,
  SearchX,
} from "lucide-react";

/* One place that knows what reports exist, so the hub and the report pages
   can never fall out of step. */

export type ReportMeta = {
  slug: string;
  title: string;
  group: string;
  description: string;
  headlineLabel: string;
  icon: React.ComponentType<{ className?: string }>;
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
    slug: "capital-by-project",
    title: "Capital by Project",
    group: "Finance",
    description:
      "Financial ownership — what each project actually paid for, regardless of where the tool sits today.",
    headlineLabel: "capital deployed",
    icon: DollarSign,
  },
];

export function reportBySlug(slug: string): ReportMeta | undefined {
  return REPORTS.find((r) => r.slug === slug);
}
