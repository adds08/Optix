export const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", group: "Overview" },
  { href: "/assets", label: "Asset Register", icon: "Package", group: "Equipment", permission: "asset.read" },
  { href: "/assignments", label: "Assignments", icon: "ArrowLeftRight", group: "Equipment", permission: "assignment.read" },
  { href: "/vehicles", label: "Vehicles", icon: "Truck", group: "Equipment", permission: "vehicle.read" },
  { href: "/foremen", label: "Foremen", icon: "Users", group: "Admin", permission: "employee.read" },
  { href: "/audit", label: "Audit Trail", icon: "ScrollText", group: "Admin", permission: "audit.read" },
  { href: "/verification", label: "Verification", icon: "ClipboardCheck", group: "Admin", permission: "assignment.read" },
  { href: "/tasks", label: "Tasks", icon: "ListChecks", group: "Admin", permission: "assignment.read" },
];

export const STATUS_LABELS: Record<string, string> = {
  available: "Available", assigned: "Assigned", in_maintenance: "In Maintenance",
  reserved: "Reserved", lost: "Lost", pending_approval: "Pending",
  /* "On loan", not "Pending": the tool has moved and the register is right. What
     is outstanding is the desk looking at it, not the hand-off itself. */
  pending_verification: "On loan",
  active: "Active", completed: "Completed",
};

export const EVENT_LABELS: Record<string, string> = {
  assign: "Assign", return: "Return", transfer: "Transfer",
  repair_start: "Repair Start", lost: "Lost", status_change: "Status Change",
  reserve: "Reserve", purchase: "Purchase",
};

export const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-red-600 font-bold", high: "text-yellow-600 font-semibold",
  medium: "text-blue-600", low: "text-muted-foreground",
};
