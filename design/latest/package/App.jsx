const { useEffect, useMemo, useRef, useState } = React;

/*
  STInventory — single-file React app.

  Structure follows the real app, not an invention:

    primary rail      48px icon column — one mark per nav GROUP (Overview,
                      Equipment, Insight, Entity), the way app-shell.tsx's
                      collapsed sidebar reads
    secondary sidebar the job scope selector (ProjectSwitcher) at its head,
                      then that group's rows, each carrying its real `perm`
    content           one scroll region under a h-14 top bar

  Tools by Jobsite mirrors apps/web/app/(app)/jobsites/page.tsx: job → crew →
  tool, plus the Equipment Yard and "Not assigned to any project" cards, loose
  tool selection with "Assign to foreman…", and the filter sheet + pills.

  Only the UI/UX differs from upstream — the model and the actions are theirs.
*/

const mono = "'JetBrains Mono',ui-monospace,monospace";

function useTheme(mode) {
  return useMemo(
    () =>
      mode === "dark"
        ? {
            bg: "#090B0E", rail: "#060809", sidebar: "#0B0E12", panel: "#0D1015",
            card: "#11151A", cardAlt: "#0E1218", surface4: "#12161C", surface5: "#141A21", surface7: "#1A1F26",
            line: "#232A32", line2: "#1B2027", line3: "#2A323B",
            text: "#EAEDEF", text2: "#A6AEB6", text3: "#8A939C", heading: "#FFFFFF",
            accent: "#7FB0E4", accentBg: "#162233", accentFg: "#C8DFFA",
            ok: "#4FA97A", warn: "#E4A13B", crit: "#D2694A",
            warnBg: "rgba(228,161,59,.11)", warnBorder: "rgba(228,161,59,.3)",
            primaryTint: "rgba(127,176,228,.055)", mutedTint: "rgba(166,174,182,.05)", accentTint: "rgba(127,176,228,.1)",
            rowA: "#0A0D11", rowB: "#0C1014",
            railText: "#8A939C", railActiveBg: "#162233", railActiveFg: "#C8DFFA",
            logoBg: "#7FB0E4", logoFg: "#090B0E", overlay: "rgba(0,0,0,.55)",
          }
        : {
            bg: "#F4F5F7", rail: "#12161B", sidebar: "#FFFFFF", panel: "#FFFFFF",
            card: "#FFFFFF", cardAlt: "#F8F9FA", surface4: "#F0F1F4", surface5: "#E8E9EC", surface7: "#E4E6EA",
            line: "#D8DBE0", line2: "#E0E3E8", line3: "#C8CCD2",
            text: "#1A1E24", text2: "#505860", text3: "#6E7681", heading: "#0F1216",
            accent: "#3A6E9E", accentBg: "#E8F0F8", accentFg: "#1E3A54",
            ok: "#2F7D52", warn: "#B37A18", crit: "#B8492A",
            warnBg: "rgba(179,122,24,.1)", warnBorder: "rgba(179,122,24,.32)",
            primaryTint: "rgba(58,110,158,.05)", mutedTint: "rgba(80,88,96,.05)", accentTint: "rgba(58,110,158,.09)",
            rowA: "#FFFFFF", rowB: "#F7F8FA",
            /* The rail stays dark in light mode, so it carries its own tokens. */
            railText: "#98A1AA", railActiveBg: "rgba(127,176,228,.18)", railActiveFg: "#B9D6F5",
            logoBg: "#7FB0E4", logoFg: "#0F1216", overlay: "rgba(20,24,28,.35)",
          },
    [mode],
  );
}

// ---------------------------------------------------------------- domain data

/* Job groups — the left pane of the scope selector. "All your projects" is a
   permanent, un-editable scope and is not in this list. */
const JOB_GROUPS = [
  { id: "g1", name: "North Texas Water", projectIds: ["p1", "p3"] },
  { id: "g2", name: "Levee & Flood Control", projectIds: ["p2"] },
  { id: "g3", name: "2026 Capital Program", projectIds: ["p1", "p2", "p4"] },
];

const PROJECTS = [
  {
    id: "p1", code: "JOB 22018", name: "Legacy West Utilities", city: "Plano, TX", status: "Active",
    crews: [
      {
        id: "c1", foreman: "Alejandro Capuchino", role: "foreman", truck: "TR-118", trailer: "TE-006", updated: "2h ago",
        tools: [
          { tag: "ST-00137", name: "DeWalt DCD996 Hammer Drill", cat: "Power tool", condition: "Good", status: "assigned", value: 320 },
          { tag: "ST-00241", name: "Milwaukee M18 Sawzall", cat: "Power tool", condition: "Good", status: "assigned", value: 280 },
          { tag: "ST-00355", name: "Bosch Bulldog Rotary Hammer", cat: "Power tool", condition: "Good", status: "assigned", value: 430 },
          { tag: "ST-00412", name: "Wacker WP1550 Plate Compactor", cat: "Compaction", condition: "Fair", status: "assigned", value: 2100 },
          { tag: "ST-00498", name: "Stihl TS420 Cutquik", cat: "Cutting", condition: "Good", status: "assigned", value: 1100 },
          { tag: "ST-00521", name: "Honda EB2200i Generator", cat: "Generator", condition: "Good", status: "assigned", value: 1300 },
        ],
      },
      {
        id: "c2", foreman: "Jobani Abarca", role: "foreman", truck: "TR-104", trailer: null, updated: "20m ago",
        tools: [
          { tag: "ST-00301", name: "Makita 7-1/4in Circular Saw", cat: "Power tool", condition: "Good", status: "assigned", value: 210 },
          { tag: "ST-00477", name: "DeWalt 20V Angle Grinder", cat: "Power tool", condition: "Fair", status: "assigned", value: 190 },
          { tag: "ST-00544", name: "Klein Electrician Tool Set", cat: "Hand tool", condition: "Good", status: "assigned", value: 290 },
          { tag: "ST-00619", name: "Werner 24ft Extension Ladder", cat: "Access", condition: "Good", status: "assigned", value: 380 },
        ],
      },
    ],
    loose: [
      { tag: "ST-00902", name: "Milwaukee M18 Site Light", cat: "Site", condition: "Good", status: "available", value: 220, where: "On site — south gate" },
      { tag: "ST-00913", name: "Ridgid Pipe Wrench Set", cat: "Hand tool", condition: "Good", status: "available", value: 340, where: "On site — trailer pad" },
    ],
  },
  {
    id: "p2", code: "JOB 22104", name: "Trinity River Levee Ph 2", city: "Dallas, TX", status: "Active",
    crews: [
      {
        id: "c3", foreman: "Miguel Torres", role: "foreman", truck: "TR-102", trailer: "TE-002", updated: "40m ago",
        tools: [
          { tag: "ST-00102", name: "DeWalt DCD996 Hammer Drill", cat: "Power tool", condition: "Good", status: "assigned", value: 320 },
          { tag: "ST-00209", name: "Husqvarna K770 Demo Saw", cat: "Cutting", condition: "Fair", status: "assigned", value: 1250 },
          { tag: "ST-00314", name: "Wacker WP1550 Plate Compactor", cat: "Compaction", condition: "Good", status: "assigned", value: 2100 },
          { tag: "ST-00648", name: "Stihl TS420 Cutquik", cat: "Cutting", condition: "Needs service", status: "in_maintenance", value: 1100 },
          { tag: "ST-00751", name: "Milwaukee M18 Sawzall", cat: "Power tool", condition: "Good", status: "assigned", value: 280 },
        ],
      },
      {
        id: "c4", foreman: "Ruben Delgado", role: "foreman", truck: "TR-127", trailer: "TE-011", updated: "3h ago",
        tools: [
          { tag: "ST-00118", name: "Milwaukee M18 Impact Driver", cat: "Power tool", condition: "Good", status: "assigned", value: 240 },
          { tag: "ST-00225", name: "DeWalt 20V Angle Grinder", cat: "Power tool", condition: "Good", status: "assigned", value: 190 },
          { tag: "ST-00337", name: "Makita 7-1/4in Circular Saw", cat: "Power tool", condition: "Fair", status: "assigned", value: 210 },
        ],
      },
      {
        id: "c5", foreman: "Beto Aldana", role: "foreman", truck: null, trailer: "TE-004", updated: "1h ago",
        tools: [
          { tag: "ST-00163", name: "Werner 24ft Extension Ladder", cat: "Access", condition: "Good", status: "assigned", value: 380 },
          { tag: "ST-00278", name: "Bosch GRL2000-40HVK Laser", cat: "Survey", condition: "Good", status: "assigned", value: 1400 },
          { tag: "ST-00506", name: "Milwaukee M18 Site Light", cat: "Site", condition: "Fair", status: "assigned", value: 220 },
        ],
      },
    ],
    loose: [
      { tag: "ST-00944", name: "Multiquip 2in Trash Pump", cat: "Pump", condition: "Good", status: "available", value: 900, where: "On site — levee toe" },
    ],
  },
  {
    id: "p3", code: "JOB 21877", name: "DFW Water Main Ph 2", city: "Irving, TX", status: "Active",
    crews: [
      {
        id: "c6", foreman: "Sergio Nunez", role: "foreman", truck: "TR-131", trailer: "TE-009", updated: "5h ago",
        tools: [
          { tag: "ST-00144", name: "Bosch Bulldog Rotary Hammer", cat: "Power tool", condition: "Good", status: "assigned", value: 430 },
          { tag: "ST-00257", name: "DeWalt DCD996 Hammer Drill", cat: "Power tool", condition: "Fair", status: "assigned", value: 320 },
          { tag: "ST-00368", name: "Stihl TS420 Cutquik", cat: "Cutting", condition: "Good", status: "assigned", value: 1100 },
          { tag: "ST-00581", name: "Greenlee Cable Puller", cat: "Pipe", condition: "Good", status: "assigned", value: 780 },
        ],
      },
      {
        id: "c7", foreman: "Hector Villalobos", role: "foreman", truck: "TR-115", trailer: null, updated: "1d ago",
        tools: [
          { tag: "ST-00196", name: "Milwaukee M18 Sawzall", cat: "Power tool", condition: "Good", status: "assigned", value: 280 },
          { tag: "ST-00308", name: "Wacker WP1550 Plate Compactor", cat: "Compaction", condition: "Good", status: "assigned", value: 2100 },
        ],
      },
      {
        id: "c8", foreman: "Danny Okafor", role: "foreman", truck: null, trailer: null, updated: "stale · 4d", stale: true,
        tools: [
          { tag: "ST-00127", name: "DeWalt 20V Angle Grinder", cat: "Power tool", condition: "Needs service", status: "in_maintenance", value: 190 },
          { tag: "ST-00238", name: "Ridgid Pipe Wrench Set", cat: "Hand tool", condition: "Good", status: "assigned", value: 340 },
        ],
      },
    ],
    loose: [],
  },
  {
    id: "p4", code: "JOB 22205", name: "Cedar Hill WWTP Expansion", city: "Cedar Hill, TX", status: "Upcoming",
    crews: [
      {
        id: "c9", foreman: "Fernando Morales", role: "foreman", truck: "TR-109", trailer: "TE-014", updated: "25m ago",
        tools: [
          { tag: "ST-00153", name: "DeWalt DCD996 Hammer Drill", cat: "Power tool", condition: "Good", status: "assigned", value: 320 },
          { tag: "ST-00266", name: "Milwaukee M18 Sawzall", cat: "Power tool", condition: "Good", status: "assigned", value: 280 },
          { tag: "ST-00379", name: "Stihl TS420 Cutquik", cat: "Cutting", condition: "Good", status: "assigned", value: 1100 },
        ],
      },
      {
        id: "c10", foreman: "Luis Garza", role: "foreman", truck: null, trailer: "TE-021", updated: "2h ago",
        tools: [
          { tag: "ST-00201", name: "Bosch Bulldog Rotary Hammer", cat: "Power tool", condition: "Fair", status: "assigned", value: 430 },
          { tag: "ST-00316", name: "Multiquip 2in Trash Pump", cat: "Pump", condition: "Good", status: "assigned", value: 900 },
        ],
      },
    ],
    loose: [],
  },
];

/* The yard card's tools and the project-less foremen, both pinned below the
   job cards the way the real page pins them. */
const YARD_TOOLS = [
  { tag: "ST-00412", name: "Wacker WP1550 Plate Compactor", cat: "Compaction", condition: "Good", status: "available", value: 2100, where: "Dallas Yard" },
  { tag: "ST-00355", name: "Bosch GRL2000-40HVK Laser", cat: "Survey", condition: "Good", status: "available", value: 1400, where: "Dallas Yard" },
  { tag: "ST-00298", name: "Multiquip 2in Trash Pump", cat: "Pump", condition: "Fair", status: "available", value: 900, where: "Dallas Yard" },
  { tag: "ST-00476", name: "Stihl TS420 Cutquik", cat: "Cutting", condition: "Good", status: "available", value: 1100, where: "Regional Warehouse — Houston" },
  { tag: "ST-00521", name: "Miller Bobcat 260 Welder", cat: "Welding", condition: "Good", status: "available", value: 4200, where: "Dallas Yard" },
  { tag: "ST-00233", name: "Ridgid 300 Pipe Threader", cat: "Pipe", condition: "Needs service", status: "in_maintenance", value: 3100, where: "Irving Yard" },
];

const NOJOB_CREWS = [
  { id: "c11", foreman: "Dave Whitaker", role: "mechanic", truck: "TR-140", trailer: null, updated: "6h ago",
    tools: [
      { tag: "ST-00688", name: "Miller Bobcat 260 Welder", cat: "Welding", condition: "Good", status: "assigned", value: 4200 },
      { tag: "ST-00691", name: "Klein Electrician Tool Set", cat: "Hand tool", condition: "Good", status: "assigned", value: 290 },
    ],
  },
];

const YARD = "__yard";
const NOJOB = "__nojob";

const money = (n) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`);
const humanize = (s) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const shortName = (full) => {
  const [first, ...rest] = full.split(" ");
  return `${first[0]}. ${rest.join(" ")}`;
};
const condColor = (c, t) => (c === "Good" ? t.ok : c === "Fair" ? t.warn : t.crit);
const toolsOf = (p) => p.crews.flatMap((c) => c.tools.map((x) => ({ ...x, foreman: shortName(c.foreman) })));

// ---------------------------------------------------------------- nav

/*
  Mirrors DESK_NAV in apps/web/components/sti/nav-config.ts (synced 2026-08-23).
  `perm` is carried so rows filter the way app-sidebar.tsx filters them.
  Project Monitor is OUR proposal — it has no upstream route.
*/
const NAV = [
  {
    group: "Overview", icon: "▦",
    items: [
      { key: "desk", href: "/desk", label: "Desk" },
      { key: "dashboard", href: "/home", label: "Dashboard" },
    ],
  },
  {
    group: "Equipment", icon: "▤",
    items: [
      { key: "jobsites", href: "/jobsites", label: "Tools by Jobsite", perm: "asset.read" },
      { key: "custody", href: "/custody", label: "Custody", perm: "assignment.read" },
      { key: "map", href: "/map", label: "Fleet & Small Tools Map", perm: "location.read" },
    ],
  },
  {
    group: "Insight", icon: "◫",
    items: [
      { key: "reports", href: "/reports", label: "Reports & Logs", perm: "report.read" },
      { key: "activity", href: "/activity", label: "Activity", perm: "asset.read" },
    ],
  },
  {
    group: "Entity", icon: "▥",
    items: [
      { key: "tools", href: "/tools", label: "Tool Register", perm: "asset.read" },
      { key: "inbox", href: "/inbox", label: "Inbox", perm: "assignment.read", badge: 4 },
      { key: "people", href: "/people", label: "People", perm: "employee.read" },
      { key: "projects", href: "/projects", label: "Projects / Jobs", perm: "project.read" },
      { key: "settings", href: "/settings", label: "Settings", perm: "config.manage" },
    ],
  },
];

const DESIGNED = new Set(["dashboard", "jobsites"]);

// ---------------------------------------------------------------- app

function App() {
  const [mode, setMode] = useState("dark");
  const [page, setPage] = useState("jobsites");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  /* Job scope is system-wide (useJobScope upstream): a group, a single job,
     or neither, which means all your projects. */
  const [scope, setScope] = useState({ groupId: "", projectId: "" });
  const t = useTheme(mode);

  const activeGroup = NAV.find((g) => g.items.some((i) => i.key === page)) ?? NAV[0];
  const current = NAV.flatMap((g) => g.items).find((i) => i.key === page);

  const scopedProjects = useMemo(() => {
    if (scope.projectId) return PROJECTS.filter((p) => p.id === scope.projectId);
    if (scope.groupId) {
      const g = JOB_GROUPS.find((x) => x.id === scope.groupId);
      return PROJECTS.filter((p) => g?.projectIds.includes(p.id));
    }
    return PROJECTS;
  }, [scope]);

  return (
    <div style={{ display: "flex", height: "100vh", background: t.bg, color: t.text, fontFamily: "'Inter Tight',system-ui,sans-serif", overflow: "hidden" }}>
      <style>{`@keyframes pageIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        input::placeholder{color:${t.text3}}`}</style>

      {/* ---------- primary rail: one mark per nav group ---------- */}
      <nav style={{ width: 52, flex: "none", background: t.rail, display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 0", gap: 4 }}>
        <div style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 7, background: t.logoBg, color: t.logoFg, fontFamily: mono, fontWeight: 800, fontSize: 10, marginBottom: 10 }}>
          ST
        </div>
        {NAV.map((g) => {
          const on = g.group === activeGroup.group;
          return (
            <button
              key={g.group}
              title={g.group}
              onClick={() => {
                setPage(g.items[0].key);
                setSidebarOpen(true);
              }}
              style={{
                position: "relative", display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 7,
                border: "none", cursor: "pointer", fontSize: 15, transition: "background .16s, color .16s",
                background: on ? t.railActiveBg : "transparent", color: on ? t.railActiveFg : t.railText,
              }}
            >
              {/* leading-edge marker, the way app-sidebar.tsx marks the active row */}
              <span style={{ position: "absolute", left: -8, top: "50%", transform: "translateY(-50%)", width: 3, height: 16, borderRadius: "0 3px 3px 0", background: t.accent, opacity: on ? 1 : 0, transition: "opacity .16s" }} />
              {g.icon}
            </button>
          );
        })}
        {!sidebarOpen && (
          <button
            title="Job scope"
            onClick={() => setSidebarOpen(true)}
            style={{ display: "grid", placeItems: "center", width: 36, height: 36, marginTop: 8, borderRadius: 7, border: `1px solid ${t.railText}33`, cursor: "pointer", background: "transparent", color: t.railActiveFg, fontSize: 14 }}
          >
            ▣
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setMode(mode === "dark" ? "light" : "dark")}
          title="Toggle theme"
          style={{ display: "grid", placeItems: "center", width: 36, height: 36, borderRadius: 7, border: "none", cursor: "pointer", background: "transparent", color: t.railText, fontSize: 14 }}
        >
          {mode === "dark" ? "☀" : "🌙"}
        </button>
      </nav>

      {/* ---------- secondary sidebar: scope selector + this group's rows ---------- */}
      <aside
        style={{
          width: sidebarOpen ? 236 : 0, minWidth: 0, flex: "none", background: t.sidebar,
          borderRight: sidebarOpen ? `1px solid ${t.line}` : "none",
          display: "flex", flexDirection: "column", overflow: "hidden",
          transition: "width .18s ease",
        }}
      >
        <div style={{ height: 52, flex: "none", display: "flex", alignItems: "center", padding: "0 8px", borderBottom: `1px solid ${t.line}` }}>
          <ScopeSwitcher t={t} scope={scope} onChange={setScope} />
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "10px 8px" }}>
          <div style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: ".16em", color: t.text3, padding: "0 8px 7px" }}>
            {activeGroup.group.toUpperCase()}
          </div>
          {activeGroup.items.map((n) => {
            const on = page === n.key;
            return (
              <button
                key={n.key}
                onClick={() => setPage(n.key)}
                style={{
                  position: "relative", display: "flex", alignItems: "center", gap: 8, width: "100%", height: 32,
                  padding: "0 10px", marginBottom: 2, borderRadius: 5, border: "none", cursor: "pointer",
                  fontSize: 12.5, fontWeight: on ? 650 : 500, fontFamily: "inherit", textAlign: "left",
                  transition: "background .14s, color .14s",
                  background: on ? t.accentBg : "transparent", color: on ? t.accentFg : t.text2,
                }}
              >
                <span style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 16, borderRadius: "0 3px 3px 0", background: t.accent, opacity: on ? 1 : 0 }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</span>
                {n.proposed && (
                  <span style={{ fontFamily: mono, fontSize: 7.5, letterSpacing: ".1em", color: t.text3, border: `1px solid ${t.line3}`, borderRadius: 2, padding: "1px 4px" }}>NEW</span>
                )}
                {n.badge && (
                  <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, color: t.accent }}>{n.badge}</span>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      {/* ---------- content ---------- */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header style={{ flex: "none", display: "flex", alignItems: "center", gap: 12, height: 52, padding: "0 20px", background: t.panel, borderBottom: `1px solid ${t.line}` }}>
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            style={{ display: "grid", placeItems: "center", width: 28, height: 28, marginLeft: -4, borderRadius: 5, border: "none", background: "transparent", color: t.text3, cursor: "pointer", fontSize: 14 }}
          >
            {sidebarOpen ? "◧" : "▸"}
          </button>
          <span style={{ fontSize: 13.5, fontWeight: 650, color: t.heading }}>{current?.label ?? ""}</span>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 11px", borderRadius: 4, border: `1px solid ${t.line}`, background: t.surface4, color: t.text3, fontSize: 12 }}>
            Search tools, jobs, people…
          </div>
          <div style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: "50%", background: t.accentBg, color: t.accentFg, fontSize: 10.5, fontWeight: 700 }}>DM</div>
        </header>

        <main key={page} style={{ flex: 1, minHeight: 0, display: "flex", animation: "pageIn .22s ease-out" }}>
          {page === "dashboard" && <Dashboard t={t} projects={scopedProjects} />}
          {page === "jobsites" && <ToolsByJobsite t={t} projects={scopedProjects} scoped={!!(scope.groupId || scope.projectId)} />}
          {!DESIGNED.has(page) && <Placeholder t={t} label={current?.label} href={current?.href} />}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- scope switcher

/*
  Two panes in ONE panel, matching project-switcher.tsx: scopes on the left
  ("All your projects" + job groups), the jobs inside the highlighted scope on
  the right. Picking anything applies system-wide.
*/
function ScopeSwitcher({ t, scope, onChange }) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState({ kind: "all" });
  const [groupQuery, setGroupQuery] = useState("");
  const [jobQuery, setJobQuery] = useState("");

  const group = JOB_GROUPS.find((g) => g.id === scope.groupId);
  const project = PROJECTS.find((p) => p.id === scope.projectId);
  const label = project ? `${project.code} · ${project.name}` : group ? group.name : "All your projects";
  const count = project ? 1 : group ? group.projectIds.length : PROJECTS.length;

  const paneGroup = pane.kind === "group" ? JOB_GROUPS.find((g) => g.id === pane.id) : null;
  const paneJobs = (pane.kind === "all" ? PROJECTS : PROJECTS.filter((p) => paneGroup?.projectIds.includes(p.id))).filter(
    (p) => !jobQuery.trim() || `${p.code} ${p.name} ${p.city}`.toLowerCase().includes(jobQuery.trim().toLowerCase()),
  );
  const visibleGroups = JOB_GROUPS.filter((g) => !groupQuery.trim() || g.name.toLowerCase().includes(groupQuery.trim().toLowerCase()));

  const close = () => {
    setOpen(false);
    setGroupQuery("");
    setJobQuery("");
    setPane({ kind: "all" });
  };
  const pick = (next) => {
    onChange(next);
    close();
  };

  const row = (active, highlighted) => ({
    display: "flex", alignItems: "center", gap: 8, width: "100%", height: 30, padding: "0 8px",
    borderRadius: 4, border: "none", cursor: "pointer", fontSize: 12.5, fontFamily: "inherit", textAlign: "left",
    background: active || highlighted ? t.accentBg : "transparent",
    color: active || highlighted ? t.accentFg : t.text2,
  });
  const paneHead = { display: "flex", alignItems: "center", gap: 8, height: 34, flex: "none", padding: "0 10px", borderBottom: `1px solid ${t.line}` };
  const searchInput = { flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: t.text, fontSize: 12, fontFamily: "inherit" };
  const sectionLabel = { fontFamily: mono, fontSize: 8.5, letterSpacing: ".14em", color: t.text3, padding: "10px 8px 5px" };

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={`${label} — ${count} job${count === 1 ? "" : "s"}`}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%", height: 38, padding: "0 8px",
          borderRadius: 6, border: "none", cursor: "pointer", background: open ? t.surface4 : "transparent", fontFamily: "inherit",
        }}
      >
        <span style={{ display: "grid", placeItems: "center", width: 22, height: 22, flex: "none", borderRadius: 5, background: t.accent, color: t.logoFg, fontSize: 11 }}>▣</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: 12.5, fontWeight: 650, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </span>
        <span style={{ flex: "none", fontFamily: mono, fontSize: 10, fontWeight: 600, color: t.accentFg, background: t.accentBg, borderRadius: 3, padding: "1px 5px" }}>{count}</span>
        <span style={{ flex: "none", color: t.text3, fontSize: 10 }}>⇅</span>
      </button>

      {open && (
        <>
          <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
          <div style={{ position: "absolute", top: 42, left: 0, zIndex: 61, display: "flex", height: 340, width: 480, borderRadius: 6, border: `1px solid ${t.line3}`, background: t.panel, boxShadow: "0 18px 48px rgba(0,0,0,.45)", overflow: "hidden" }}>
            {/* left pane — scopes */}
            <div style={{ width: 190, flex: "none", display: "flex", flexDirection: "column", borderRight: `1px solid ${t.line}` }}>
              <div style={paneHead}>
                <span style={{ color: t.text3, fontSize: 11 }}>⌕</span>
                <input value={groupQuery} onChange={(e) => setGroupQuery(e.target.value)} placeholder="Search groups…" style={searchInput} />
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 4 }}>
                <div style={sectionLabel}>JOBS</div>
                <button onClick={() => setPane({ kind: "all" })} style={row(!scope.groupId && !scope.projectId, pane.kind === "all")}>
                  <span style={{ width: 12, flex: "none", color: t.accent, opacity: !scope.groupId && !scope.projectId ? 1 : 0 }}>✓</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>All your projects</span>
                  <span style={{ fontFamily: mono, fontSize: 10.5, color: t.text3 }}>{PROJECTS.length}</span>
                  <span style={{ color: t.text3, fontSize: 10 }}>›</span>
                </button>

                <div style={sectionLabel}>JOB GROUPS</div>
                {visibleGroups.map((g) => (
                  <button key={g.id} onClick={() => setPane({ kind: "group", id: g.id })} style={row(scope.groupId === g.id && !scope.projectId, pane.kind === "group" && pane.id === g.id)}>
                    <span style={{ width: 12, flex: "none", color: t.accent, opacity: scope.groupId === g.id && !scope.projectId ? 1 : 0 }}>✓</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{g.name}</span>
                    <span style={{ fontFamily: mono, fontSize: 10.5, color: t.text3 }}>{g.projectIds.length}</span>
                    <span style={{ color: t.text3, fontSize: 10 }}>›</span>
                  </button>
                ))}
                {!visibleGroups.length && <div style={{ padding: "4px 8px", fontSize: 12, color: t.text3 }}>No group matches your search.</div>}
              </div>
              <div style={{ flex: "none", borderTop: `1px solid ${t.line}`, padding: 4 }}>
                <button style={{ ...row(false, false), color: t.accent, fontWeight: 600 }}>+ Create new group</button>
              </div>
            </div>

            {/* right pane — jobs in that scope */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <div style={paneHead}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 650, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pane.kind === "all" ? "All your projects" : paneGroup?.name}
                </span>
                <span style={{ fontFamily: mono, fontSize: 10.5, color: t.text3 }}>{pane.kind === "all" ? PROJECTS.length : paneGroup?.projectIds.length ?? 0}</span>
                {paneGroup && (
                  <button title="Edit group" style={{ display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: 4, border: `1px solid ${t.line3}`, background: "transparent", color: t.text3, cursor: "pointer", fontSize: 10 }}>✎</button>
                )}
              </div>
              <div style={paneHead}>
                <span style={{ color: t.text3, fontSize: 11 }}>⌕</span>
                <input value={jobQuery} onChange={(e) => setJobQuery(e.target.value)} placeholder="Search jobs…" style={searchInput} />
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 4 }}>
                <button
                  onClick={() => (pane.kind === "all" ? pick({ groupId: "", projectId: "" }) : pick({ groupId: paneGroup.id, projectId: "" }))}
                  style={row(pane.kind === "all" ? !scope.groupId && !scope.projectId : scope.groupId === paneGroup?.id && !scope.projectId, false)}
                >
                  <span style={{ width: 12, flex: "none", color: t.accent, opacity: pane.kind === "all" ? (!scope.groupId && !scope.projectId ? 1 : 0) : scope.groupId === paneGroup?.id && !scope.projectId ? 1 : 0 }}>✓</span>
                  <span style={{ fontWeight: 600 }}>{pane.kind === "all" ? "Show all projects" : "Show all in this group"}</span>
                </button>
                <div style={sectionLabel}>INDIVIDUAL JOBS</div>
                {paneJobs.map((p) => (
                  <button key={p.id} onClick={() => pick({ groupId: pane.kind === "group" ? paneGroup.id : "", projectId: p.id })} style={row(scope.projectId === p.id, false)}>
                    <span style={{ width: 12, flex: "none", color: t.accent, opacity: scope.projectId === p.id ? 1 : 0 }}>✓</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <span style={{ fontFamily: mono, fontSize: 11, color: t.accent }}>{p.code}</span>
                      <span style={{ color: t.text3 }}> · </span>
                      {p.name}
                    </span>
                  </button>
                ))}
                {!paneJobs.length && <div style={{ padding: "4px 8px", fontSize: 12, color: t.text3 }}>{jobQuery ? `No jobs match “${jobQuery}”.` : "No jobs in this group yet."}</div>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- tools by jobsite

function ToolsByJobsite({ t, projects, scoped }) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState({ foreman: "", status: "", category: "", gap: "" });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [collapseAll, setCollapseAll] = useState(false);
  const [openCards, setOpenCards] = useState({});
  const [openCrews, setOpenCrews] = useState({});
  const [selectedLoose, setSelectedLoose] = useState({});
  const [menuFor, setMenuFor] = useState(null);
  const [toast, setToast] = useState(null);

  const anyFilter = !!(q.trim() || filters.foreman || filters.status || filters.category || filters.gap);
  const sheetCount = [filters.foreman, filters.status, filters.category, filters.gap].filter(Boolean).length;
  const clearFilters = () => {
    setQ("");
    setFilters({ foreman: "", status: "", category: "", gap: "" });
  };

  const hit = (text) => !q.trim() || text.toLowerCase().includes(q.trim().toLowerCase());
  const toolOk = (x) => (!filters.status || x.status === filters.status) && (!filters.category || x.cat === filters.category);

  const allForemen = [...PROJECTS.flatMap((p) => p.crews), ...NOJOB_CREWS];
  const categories = [...new Set([...PROJECTS.flatMap((p) => [...toolsOf(p), ...p.loose]), ...YARD_TOOLS].map((x) => x.cat))].sort();

  /* jobs → crews → tools, then the two pinned cards */
  const cards = useMemo(() => {
    const out = projects.map((p) => {
      const jobHit = hit(`${p.name} ${p.code} ${p.city}`);
      const crews = p.crews
        .filter((c) => !filters.foreman || c.id === filters.foreman)
        .map((c) => ({
          ...c,
          rigged: !!c.truck && !!c.trailer,
          tools: c.tools.filter((x) => (jobHit || hit(`${x.tag} ${x.name} ${c.foreman} ${c.truck ?? ""} ${c.trailer ?? ""}`)) && toolOk(x)),
        }));
      const loose = filters.foreman ? [] : p.loose.filter((x) => (jobHit || hit(`${x.tag} ${x.name}`)) && toolOk(x));
      const toolCount = crews.reduce((n, c) => n + c.tools.length, 0) + loose.length;
      const noTruck = crews.filter((c) => !c.truck).length;
      return {
        id: p.id, name: p.name, code: p.code, city: p.city, isJob: true, icon: "▤",
        crews, loose, toolCount,
        value: crews.reduce((n, c) => n + c.tools.reduce((m, x) => m + x.value, 0), 0) + loose.reduce((n, x) => n + x.value, 0),
        gaps: crews.length === 0 ? ["no crew"] : noTruck ? [`${noTruck} crew${noTruck === 1 ? "" : "s"} without a truck`] : [],
        tint: t.primaryTint,
      };
    });

    /* The yard and the not-assigned group only appear unscoped, exactly as
       upstream gates them. */
    if (!scoped && !filters.foreman) {
      const yard = YARD_TOOLS.filter((x) => hit(`${x.tag} ${x.name} ${x.where} yard`) && toolOk(x));
      out.push({
        id: YARD, name: "Equipment Yard", code: "URB-YARD", isJob: false, icon: "▧",
        crews: [], loose: yard, toolCount: yard.length,
        value: yard.reduce((n, x) => n + x.value, 0), gaps: [], tint: t.mutedTint,
      });
    }
    if (!scoped) {
      const crews = NOJOB_CREWS.filter((c) => !filters.foreman || c.id === filters.foreman).map((c) => ({
        ...c, rigged: !!c.truck && !!c.trailer,
        tools: c.tools.filter((x) => hit(`${x.tag} ${x.name} ${c.foreman}`) && toolOk(x)),
      }));
      out.push({
        id: NOJOB, name: "Not assigned to any project", code: null, isJob: false, icon: "◔",
        crews, loose: [], toolCount: crews.reduce((n, c) => n + c.tools.length, 0),
        value: crews.reduce((n, c) => n + c.tools.reduce((m, x) => m + x.value, 0), 0), gaps: [], tint: t.accentTint,
      });
    }

    return out.filter((c) => {
      if (c.id === NOJOB) return true; // pinned, survives every filter
      if (filters.gap === "no_crew" && c.crews.length) return false;
      if (filters.gap === "no_truck" && !c.crews.some((x) => !x.truck)) return false;
      if (filters.gap === "no_trailer" && !c.crews.some((x) => !x.trailer)) return false;
      if (anyFilter && c.toolCount === 0 && c.crews.length === 0) return false;
      return true;
    });
  }, [projects, scoped, q, filters, anyFilter, t]);

  const shownTools = cards.reduce((n, c) => n + c.toolCount, 0);
  const shownCrews = cards.reduce((n, c) => n + c.crews.length, 0);
  const crewsWithoutTruck = cards.reduce((n, c) => n + c.crews.filter((x) => !x.truck).length, 0);

  const fire = (msg) => {
    setToast(msg);
    setMenuFor(null);
    setTimeout(() => setToast(null), 2600);
  };

  const pills = [
    filters.foreman && { key: "foreman", label: allForemen.find((f) => f.id === filters.foreman)?.foreman ?? "Foreman", clear: () => setFilters((f) => ({ ...f, foreman: "" })) },
    filters.status && { key: "status", label: humanize(filters.status), clear: () => setFilters((f) => ({ ...f, status: "" })) },
    filters.category && { key: "category", label: filters.category, clear: () => setFilters((f) => ({ ...f, category: "" })) },
    filters.gap && { key: "gap", label: { no_crew: "No crew", no_truck: "No truck", no_trailer: "No trailer" }[filters.gap], clear: () => setFilters((f) => ({ ...f, gap: "" })) },
  ].filter(Boolean);

  const btn = (variant) => ({
    display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 11px", borderRadius: 4, cursor: "pointer",
    fontSize: 12, fontWeight: 600, fontFamily: "inherit",
    border: `1px solid ${variant === "ghost" ? "transparent" : t.line}`,
    background: variant === "ghost" ? "transparent" : t.surface4,
    color: variant === "primary" ? t.accent : t.text2,
  });

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "16px 20px 40px" }} onClick={() => setMenuFor(null)}>
      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 90, padding: "10px 16px", borderRadius: 6, background: t.panel, border: `1px solid ${t.line3}`, color: t.text, fontSize: 12.5, boxShadow: "0 14px 34px rgba(0,0,0,.4)" }}>
          {toast}
        </div>
      )}

      {/* ---- one filter bar ---- */}
      <section style={{ display: "flex", flexDirection: "column", gap: 9, borderRadius: 6, border: `1px solid ${t.line}`, background: t.card, padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: t.text3, fontSize: 12 }}>⌕</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search everything — job, foreman, truck, trailer, serial or tool…"
              style={{ width: "100%", height: 32, padding: "0 10px 0 28px", borderRadius: 4, border: `1px solid ${t.line}`, background: t.surface4, color: t.text, fontSize: 12.5, fontFamily: "inherit", outline: "none" }}
            />
          </div>
          <button onClick={() => setSheetOpen(true)} style={btn()}>
            ☰ Filter{sheetCount ? <span style={{ fontFamily: mono, fontSize: 10, color: t.accent }}>{sheetCount}</span> : null}
          </button>
          <button onClick={() => setCollapseAll((v) => !v)} style={btn()}>
            {collapseAll ? "⌄ Expand all" : "⌃ Collapse all"}
          </button>
        </div>

        {pills.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {pills.map((p) => (
              <button key={p.key} onClick={p.clear} style={{ display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 8px", borderRadius: 12, border: `1px solid ${t.line3}`, background: t.surface4, color: t.text2, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
                {p.label} <span style={{ color: t.text3 }}>×</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, fontSize: 12.5, color: t.text3 }}>
          <span style={{ fontFamily: mono }}>
            {shownTools} tool{shownTools === 1 ? "" : "s"} · {shownCrews} crew{shownCrews === 1 ? "" : "s"} · {cards.length} card{cards.length === 1 ? "" : "s"}
          </span>
          {crewsWithoutTruck > 0 && (
            <button
              onClick={() => setFilters((f) => ({ ...f, gap: f.gap === "no_truck" ? "" : "no_truck" }))}
              style={{ fontFamily: mono, borderRadius: 12, padding: "2px 8px", border: "none", cursor: "pointer", fontWeight: 600, color: t.warn, background: filters.gap === "no_truck" ? t.warnBg : "transparent" }}
            >
              {crewsWithoutTruck} without a truck
            </button>
          )}
          {anyFilter && (
            <button onClick={clearFilters} style={{ ...btn("ghost"), height: 22, padding: "0 6px", color: t.accent }}>Clear filters</button>
          )}
        </div>
      </section>

      {sheetOpen && (
        <FilterSheet
          t={t}
          filters={filters}
          setFilters={setFilters}
          onClose={() => setSheetOpen(false)}
          onClear={clearFilters}
          foremen={allForemen}
          categories={categories}
        />
      )}

      {/* ---- cards ---- */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {!cards.length && (
          <div style={{ padding: "60px 0", textAlign: "center", color: t.text3, fontSize: 13.5 }}>
            Nothing matches those filters — clear one, or search for a different unit.
          </div>
        )}

        {cards.map((card) => {
          const open = collapseAll ? openCards[card.id] ?? false : openCards[card.id] ?? true;
          const sel = selectedLoose[card.id] ?? new Set();
          return (
            <section key={card.id} style={{ borderRadius: 6, border: `1px solid ${t.line}`, background: t.card, overflow: "visible" }}>
              <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 12px", background: card.tint, borderRadius: "6px 6px 0 0" }}>
                <span style={{ display: "grid", placeItems: "center", width: 34, height: 34, flex: "none", borderRadius: 8, background: card.isJob ? t.accentBg : t.surface5, color: card.isJob ? t.accent : t.text3, fontSize: 15 }}>
                  {card.icon}
                </span>
                <span style={{ display: "flex", flex: 1, minWidth: 160, flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 650, color: t.heading, letterSpacing: "-.015em" }}>{card.name}</span>
                  {card.code && (
                    <span style={{ fontFamily: mono, fontSize: 10.5, color: t.text3, border: `1px solid ${t.line3}`, background: t.surface4, borderRadius: 3, padding: "2px 6px" }}>{card.code}</span>
                  )}
                  <span style={{ fontSize: 12.5, color: t.text3 }}>
                    {card.isJob ? (card.crews.length ? `${card.crews.length} crew${card.crews.length === 1 ? "" : "s"}` : "no crew yet") : "between jobs"}
                  </span>
                  {card.gaps.length > 0 && (
                    <span style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 12, background: t.warnBg, padding: "2px 9px", fontSize: 11.5, fontWeight: 600, color: t.warn }}>
                      ⚠ {card.gaps.join(" · ")}
                    </span>
                  )}
                </span>
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "block", borderRadius: 5, border: `1px solid ${t.line}`, background: t.surface4, padding: "1px 8px", fontSize: 11.5, color: t.text3 }}>
                      <span style={{ fontFamily: mono, fontWeight: 700, color: t.text }}>{card.toolCount}</span> tool{card.toolCount === 1 ? "" : "s"}
                    </span>
                    <span style={{ display: "block", fontFamily: mono, fontSize: 10.5, color: t.text3, marginTop: 2 }}>{money(card.value)}</span>
                  </span>
                  {card.isJob && (
                    <button onClick={() => fire(`Add crew — pick a foreman and their truck/trailer for ${card.code}`)} style={{ ...btn("primary"), borderStyle: "dashed", height: 28 }}>
                      + Add crew
                    </button>
                  )}
                  <div style={{ position: "relative" }}>
                    <button
                      aria-label="Jobsite actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuFor(menuFor === card.id ? null : card.id);
                      }}
                      style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 4, border: `1px solid ${t.line}`, background: t.surface4, color: t.text2, cursor: "pointer" }}
                    >
                      ⋮
                    </button>
                    {menuFor === card.id && (
                      <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 0, top: 32, zIndex: 50, width: 240, borderRadius: 6, border: `1px solid ${t.line3}`, background: t.panel, padding: 4, boxShadow: "0 16px 40px rgba(0,0,0,.45)" }}>
                        {card.isJob && (
                          <button onClick={() => fire(`Add a foreman and truck/trailer to ${card.code}`)} style={{ display: "block", width: "100%", padding: "7px 9px", borderRadius: 4, border: "none", background: "transparent", color: t.text2, fontSize: 12.5, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
                            Add a foreman and truck/trailer
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setOpenCards((o) => ({ ...o, [card.id]: !open }));
                            setMenuFor(null);
                          }}
                          style={{ display: "block", width: "100%", padding: "7px 9px", borderRadius: 4, border: "none", background: "transparent", color: t.text2, fontSize: 12.5, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
                        >
                          {open ? "Collapse" : "Expand"}
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    aria-label="Expand"
                    onClick={() => setOpenCards((o) => ({ ...o, [card.id]: !open }))}
                    style={{ display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 4, border: `1px solid ${t.line}`, background: t.surface4, color: t.text2, cursor: "pointer", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}
                  >
                    ⌄
                  </button>
                </span>
              </header>

              {open && (
                <div style={{ display: "flex", flexDirection: "column", gap: 9, borderTop: `1px solid ${t.line}`, background: t.cardAlt, padding: 12 }}>
                  {card.crews.map((crew, i) => (
                    <CrewCard
                      key={crew.id}
                      t={t}
                      crew={crew}
                      striped={i % 2 === 1}
                      expanded={collapseAll ? openCrews[crew.id] ?? false : openCrews[crew.id] ?? true}
                      onToggle={() => setOpenCrews((o) => ({ ...o, [crew.id]: !(collapseAll ? o[crew.id] ?? false : o[crew.id] ?? true) }))}
                      onAction={fire}
                    />
                  ))}

                  {card.isJob && !card.crews.length && (
                    <button onClick={() => fire(`Add a foreman with a truck or trailer to ${card.code}`)} style={{ borderRadius: 6, border: `1px dashed ${t.line3}`, background: t.card, padding: 16, textAlign: "left", fontSize: 12.5, fontWeight: 600, color: t.accent, cursor: "pointer", fontFamily: "inherit" }}>
                      No crew on this job yet — add a foreman with a truck or trailer.
                    </button>
                  )}

                  {card.id === NOJOB && !card.crews.length && (
                    <p style={{ margin: 0, borderRadius: 6, border: `1px dashed ${t.line3}`, background: t.card, padding: "12px 16px", fontSize: 12.5, color: t.text3 }}>
                      Every foreman is on a project right now — this group holds whoever is between jobs.
                    </p>
                  )}

                  {card.loose.length > 0 && (
                    <LooseSection
                      t={t}
                      isJob={card.isJob}
                      rows={card.loose}
                      selected={sel}
                      onToggle={(tag) =>
                        setSelectedLoose((m) => {
                          const next = new Set(m[card.id] ?? []);
                          if (next.has(tag)) next.delete(tag);
                          else next.add(tag);
                          return { ...m, [card.id]: next };
                        })
                      }
                      onToggleAll={() =>
                        setSelectedLoose((m) => {
                          const cur = m[card.id] ?? new Set();
                          return { ...m, [card.id]: cur.size === card.loose.length ? new Set() : new Set(card.loose.map((x) => x.tag)) };
                        })
                      }
                      onAssign={() => {
                        fire(`Assign ${sel.size} tool${sel.size === 1 ? "" : "s"} to a foreman — they move to wherever that foreman works`);
                        setSelectedLoose((m) => ({ ...m, [card.id]: new Set() }));
                      }}
                      onClear={() => setSelectedLoose((m) => ({ ...m, [card.id]: new Set() }))}
                      onRowAction={fire}
                    />
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* One foreman: their rig, their tools. The rig belongs to the person, so it
   shows on every job card they appear on. */
function CrewCard({ t, crew, striped, expanded, onToggle, onAction }) {
  const [menu, setMenu] = useState(false);
  const value = crew.tools.reduce((n, x) => n + x.value, 0);

  const vehicleTag = (v, kind) =>
    v ? (
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: mono, fontSize: 11, color: t.text2, border: `1px solid ${t.line3}`, borderRadius: 3, padding: "3px 8px" }}>
        {kind === "truck" ? "▭" : "▬"} {v}
      </span>
    ) : (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAction(`Pick a ${kind} for ${crew.foreman} — the rig follows the person, not the job`);
        }}
        style={{ display: "flex", alignItems: "center", gap: 5, background: t.warnBg, border: `1px solid ${t.warnBorder}`, color: t.warn, borderRadius: 3, padding: "3px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
      >
        + {kind}
      </button>
    );

  return (
    <div style={{ borderRadius: 6, border: `1px solid ${t.line}`, background: striped ? t.rowB : t.card, overflow: "visible" }}>
      <div onClick={onToggle} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer" }}>
        <span style={{ width: 3, height: 22, flex: "none", borderRadius: 2, background: crew.rigged ? t.ok : t.warn }} />
        <span style={{ width: 10, flex: "none", color: t.text3, fontSize: 11, transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }}>›</span>
        <span style={{ flex: "1 1 150px", minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{crew.foreman}</span>
          <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: ".1em", color: t.text3 }}>{crew.role.toUpperCase()}</span>
        </span>
        <span style={{ flex: "none" }}>{vehicleTag(crew.truck, "truck")}</span>
        <span style={{ flex: "none" }}>{vehicleTag(crew.trailer, "trailer")}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: crew.stale ? t.crit : t.text3, flex: "none", whiteSpace: "nowrap" }}>{crew.updated}</span>
        <span style={{ flex: "none", whiteSpace: "nowrap" }}>
          <span style={{ fontFamily: mono, fontSize: 13.5, fontWeight: 700, color: t.heading }}>{crew.tools.length}</span>
          <span style={{ fontSize: 11.5, color: t.text3 }}> tools</span>
        </span>
        <span style={{ fontFamily: mono, fontSize: 11.5, color: t.text3, flex: "none", whiteSpace: "nowrap" }}>{money(value)}</span>
        <div style={{ position: "relative" }}>
          <button
            aria-label="Crew actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenu((m) => !m);
            }}
            style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 4, border: `1px solid ${t.line}`, background: t.surface4, color: t.text2, cursor: "pointer" }}
          >
            ⋮
          </button>
          {menu && (
            <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 0, top: 30, zIndex: 50, width: 236, borderRadius: 6, border: `1px solid ${t.line3}`, background: t.panel, padding: 4, boxShadow: "0 16px 40px rgba(0,0,0,.45)" }}>
              {[
                ["Hand tools to this foreman", `Pick tools to hand to ${crew.foreman}`],
                ["Hand the whole rig over", `Hand ${crew.foreman}'s rig over — tools and hitched trailer follow`],
                ["Move crew to another job", `Move ${crew.foreman} — posting, roster, truck, trailer and tools all follow`],
                [crew.trailer ? "Change hitched trailer" : "Hitch a trailer", `Hitch a trailer to ${crew.truck ?? "this crew's truck"}`],
              ].map(([label, msg]) => (
                <button
                  key={label}
                  onClick={() => {
                    setMenu(false);
                    onAction(msg);
                  }}
                  style={{ display: "block", width: "100%", padding: "7px 9px", borderRadius: 4, border: "none", background: "transparent", color: t.text2, fontSize: 12.5, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {expanded && <ToolTable t={t} rows={crew.tools} onRowAction={onAction} />}
    </div>
  );
}

/*
  "On site, nobody holding" / "Waiting in the yard".

  Tools nobody holds are the ones you can hand out, so each row carries a
  checkbox and the header turns into a selection bar with "Assign to foreman…".
*/
function LooseSection({ t, isJob, rows, selected, onToggle, onToggleAll, onAssign, onClear, onRowAction }) {
  const n = selected.size;
  const allOn = n === rows.length && rows.length > 0;
  return (
    <div style={{ borderRadius: 6, border: `1px solid ${isJob ? `${t.accent}28` : t.line}`, background: isJob ? t.primaryTint : t.mutedTint, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 9, padding: "8px 12px", borderBottom: `1px solid ${isJob ? `${t.accent}28` : t.line}`, background: isJob ? t.accentTint : t.surface4, fontSize: 12, fontWeight: 650, color: t.text2 }}>
        <Checkbox t={t} checked={allOn} indeterminate={n > 0 && !allOn} onChange={onToggleAll} label="Select every loose tool" />
        <span>{isJob ? "On site, nobody holding" : "Waiting in the yard"}</span>
        <span style={{ fontFamily: mono, fontWeight: 400, color: t.text3 }}>{rows.length}</span>
        {n > 0 && (
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: mono, fontSize: 11.5, color: t.accent }}>{n} selected</span>
            <button onClick={onAssign} style={{ height: 24, padding: "0 9px", borderRadius: 4, border: `1px solid ${t.line3}`, background: t.surface4, color: t.text, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
              Assign to foreman…
            </button>
            <button onClick={onClear} style={{ height: 24, padding: "0 7px", borderRadius: 4, border: "none", background: "transparent", color: t.text3, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
              Clear
            </button>
          </span>
        )}
      </div>
      <ToolTable t={t} rows={rows} selectable selected={selected} onToggle={onToggle} showWhere onRowAction={onRowAction} />
    </div>
  );
}

function ToolTable({ t, rows, selectable, selected, onToggle, showWhere, onRowAction }) {
  const [menu, setMenu] = useState(null);
  const colHdr = { fontFamily: mono, fontSize: 9.5, letterSpacing: ".14em", color: t.text3 };

  if (!rows.length) {
    return <div style={{ padding: "14px 12px", fontSize: 12.5, color: t.text3 }}>No tools match the current filters.</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 12px", background: t.cardAlt, borderTop: `1px solid ${t.line2}`, borderBottom: `1px solid ${t.line2}` }}>
        {selectable && <span style={{ width: 16, flex: "none" }} />}
        <span style={{ ...colHdr, width: 84, flex: "none" }}>TAG</span>
        <span style={{ ...colHdr, flex: 1 }}>TOOL</span>
        <span style={{ ...colHdr, width: 96, flex: "none" }}>CATEGORY</span>
        {showWhere && <span style={{ ...colHdr, width: 176, flex: "none" }}>WHERE</span>}
        <span style={{ ...colHdr, width: 88, flex: "none" }}>STATUS</span>
        <span style={{ ...colHdr, width: 92, flex: "none", textAlign: "right" }}>CONDITION</span>
        <span style={{ width: 26, flex: "none" }} />
      </div>

      {rows.map((r, i) => {
        const on = selectable && selected.has(r.tag);
        return (
          <div
            key={r.tag}
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: "7px 12px",
              background: on ? t.accentBg : i % 2 ? t.rowB : t.rowA,
              borderBottom: `1px solid ${t.line2}`,
            }}
          >
            {selectable && <Checkbox t={t} checked={on} onChange={() => onToggle(r.tag)} label={`Select ${r.tag}`} />}
            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: t.accent, width: 84, flex: "none" }}>{r.tag}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
            <span style={{ fontFamily: mono, fontSize: 10.5, color: t.text3, width: 96, flex: "none" }}>{r.cat}</span>
            {showWhere && <span style={{ fontSize: 12, color: t.text3, width: 176, flex: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.where ?? "—"}</span>}
            <span style={{ fontSize: 11.5, color: t.text3, width: 88, flex: "none" }}>{humanize(r.status)}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: condColor(r.condition, t), width: 92, flex: "none", textAlign: "right" }}>{r.condition}</span>
            <div style={{ position: "relative", width: 26, flex: "none" }}>
              <button
                aria-label={`Actions for ${r.tag}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenu(menu === r.tag ? null : r.tag);
                }}
                style={{ display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: 4, border: "none", background: "transparent", color: t.text3, cursor: "pointer" }}
              >
                ⋯
              </button>
              {menu === r.tag && (
                <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: 0, top: 28, zIndex: 50, width: 200, borderRadius: 6, border: `1px solid ${t.line3}`, background: t.panel, padding: 4, boxShadow: "0 16px 40px rgba(0,0,0,.45)" }}>
                  {[
                    ["Hand over to…", `Hand ${r.tag} over to another holder`],
                    ["Return to yard", `Return ${r.tag} to the yard`],
                    ["Change status", `Change the status of ${r.tag}`],
                    ["Open tool record", `Open the register record for ${r.tag}`],
                  ].map(([label, msg]) => (
                    <button
                      key={label}
                      onClick={() => {
                        setMenu(null);
                        onRowAction(msg);
                      }}
                      style={{ display: "block", width: "100%", padding: "7px 9px", borderRadius: 4, border: "none", background: "transparent", color: t.text2, fontSize: 12.5, textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Checkbox({ t, checked, indeterminate, onChange, label }) {
  return (
    <button
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      style={{
        display: "grid", placeItems: "center", width: 16, height: 16, flex: "none", borderRadius: 3, cursor: "pointer",
        border: `1px solid ${checked || indeterminate ? t.accent : t.line3}`,
        background: checked || indeterminate ? t.accent : "transparent",
        color: t.logoFg, fontSize: 10, lineHeight: 1, padding: 0,
      }}
    >
      {indeterminate ? "–" : checked ? "✓" : ""}
    </button>
  );
}

/* The six filters that do not live on the bar — a sheet, because as loose
   dropdowns they wrapped one-per-line and buried the first card. */
function FilterSheet({ t, filters, setFilters, onClose, onClear, foremen, categories }) {
  const field = { display: "flex", flexDirection: "column", gap: 5 };
  const label = { fontFamily: mono, fontSize: 9.5, letterSpacing: ".14em", color: t.text3 };
  const select = {
    height: 32, padding: "0 9px", borderRadius: 4, border: `1px solid ${t.line}`,
    background: t.surface4, color: t.text, fontSize: 12.5, fontFamily: "inherit", outline: "none",
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: t.overlay }} />
      <aside style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 71, width: 340, display: "flex", flexDirection: "column", background: t.panel, borderLeft: `1px solid ${t.line}`, boxShadow: "-18px 0 48px rgba(0,0,0,.4)" }}>
        <div style={{ display: "flex", alignItems: "center", height: 52, flex: "none", padding: "0 16px", borderBottom: `1px solid ${t.line}` }}>
          <span style={{ fontSize: 13.5, fontWeight: 650, color: t.heading }}>Filter jobsites</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="Close filters" style={{ display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 4, border: "none", background: "transparent", color: t.text3, cursor: "pointer", fontSize: 14 }}>×</button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 14, padding: 16 }}>
          <div style={field}>
            <span style={label}>FOREMAN</span>
            <select value={filters.foreman} onChange={(e) => setFilters((f) => ({ ...f, foreman: e.target.value }))} style={select}>
              <option value="">All foremen</option>
              {foremen.map((f) => (
                <option key={f.id} value={f.id}>{f.foreman}</option>
              ))}
            </select>
          </div>

          <div style={field}>
            <span style={label}>TOOL STATUS</span>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} style={select}>
              <option value="">Any status</option>
              {["assigned", "available", "in_maintenance", "lost"].map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </select>
          </div>

          <div style={field}>
            <span style={label}>TOOL CATEGORY</span>
            <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} style={select}>
              <option value="">Any category</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div style={field}>
            <span style={label}>RIG GAP</span>
            <select value={filters.gap} onChange={(e) => setFilters((f) => ({ ...f, gap: e.target.value }))} style={select}>
              <option value="">Any rig</option>
              <option value="no_crew">Job with no crew</option>
              <option value="no_truck">Crew without a truck</option>
              <option value="no_trailer">Crew without a trailer</option>
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flex: "none", padding: 16, borderTop: `1px solid ${t.line}` }}>
          <button onClick={onClear} style={{ flex: 1, height: 34, borderRadius: 4, border: `1px solid ${t.line}`, background: "transparent", color: t.text2, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Clear all
          </button>
          <button onClick={onClose} style={{ flex: 1, height: 34, borderRadius: 4, border: "none", background: t.accent, color: t.logoFg, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Apply
          </button>
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------- dashboard

function Dashboard({ t, projects }) {
  const allTools = projects.flatMap(toolsOf);
  const crews = projects.flatMap((p) => p.crews);
  const metrics = [
    { value: String(projects.length), label: "Projects", hint: "in scope" },
    { value: String(allTools.length), label: "Tools out", hint: "held by crews" },
    { value: String(crews.length), label: "Crews", hint: "with a foreman" },
    { value: String(crews.filter((c) => !c.truck || !c.trailer).length), label: "Rig gaps", hint: "missing vehicle", tone: "warn" },
    { value: String(allTools.filter((x) => x.condition === "Needs service").length), label: "Needs service", hint: "flagged in field", tone: "crit" },
  ];

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 14, padding: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, flex: "none" }}>
        {metrics.map((m) => (
          <div key={m.label} style={{ padding: "12px 14px", borderRadius: 6, border: `1px solid ${t.line}`, background: t.card }}>
            <div style={{ fontFamily: mono, fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: m.tone === "warn" ? t.warn : m.tone === "crit" ? t.crit : t.heading }}>
              {m.value}
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: t.text2, marginTop: 3 }}>{m.label}</div>
            <div style={{ fontSize: 10, color: t.text3, marginTop: 1 }}>{m.hint}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: "none", height: 560, borderRadius: 6, overflow: "hidden", border: `1px solid ${t.line}` }}>
        <ProjectMonitor t={t} projects={projects} embedded />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- project monitor

/* Dwell scales with row count so a short list doesn't linger and a long one
   isn't rushed off screen mid-scroll. */
function dwellMs(p) {
  return Math.min(52000, 12000 + toolsOf(p).length * 1100);
}

function ProjectMonitor({ t, projects, embedded = false }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [clock, setClock] = useState("");
  const tableRef = useRef(null);
  const cycleStart = useRef(Date.now());

  const n = Math.max(1, projects.length);
  const active = projects[idx % n] ?? projects[0];
  const prev = projects[(idx - 1 + n) % n] ?? active;
  const next = projects[(idx + 1) % n] ?? active;
  const tools = active ? toolsOf(active) : [];

  function jumpTo(i) {
    cycleStart.current = Date.now();
    if (tableRef.current) tableRef.current.scrollTop = 0;
    setProgress(0);
    setIdx(i);
  }

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const h = now.getHours();
      setClock(`${String(h % 12 || 12).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`);
      if (paused || !active) return;

      const dur = dwellMs(active);
      const elapsed = Date.now() - cycleStart.current;
      if (elapsed >= dur) {
        cycleStart.current = Date.now();
        if (tableRef.current) tableRef.current.scrollTop = 0;
        setProgress(0);
        setIdx((i) => (i + 1) % n);
        return;
      }
      /* Hold at top for 18% so the header can be read, finish travel by 88%
         so rows are still when the project changes. */
      const pct = elapsed / dur;
      const scrollPct = Math.max(0, Math.min(1, (pct - 0.18) / 0.7));
      const el = tableRef.current;
      if (el) {
        const max = el.scrollHeight - el.clientHeight;
        if (max > 1) el.scrollTop = max * scrollPct;
      }
      setProgress(pct);
    }, 100);
    return () => clearInterval(timer);
  }, [idx, paused, active, n]);

  if (!active) {
    return <div style={{ flex: 1, display: "grid", placeItems: "center", color: t.text3, fontSize: 13 }}>No projects in scope.</div>;
  }

  const flagged = tools.filter((x) => x.condition !== "Good").length;
  const secsLeft = Math.max(0, Math.ceil((dwellMs(active) * (1 - progress)) / 1000));
  const statusColor = active.status === "Active" ? t.ok : t.accent;
  const colHdr = { fontFamily: mono, fontSize: 10, letterSpacing: ".15em", color: t.text3 };
  const btn = (on) => ({
    padding: "6px 12px", borderRadius: 3, border: `1px solid ${t.line}`, cursor: "pointer",
    fontFamily: mono, fontSize: 11, fontWeight: 600,
    background: on ? t.accentBg : "transparent", color: on ? t.accentFg : t.text3,
  });

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", background: t.bg, color: t.text,
        height: fullscreen ? "100vh" : "100%",
        ...(fullscreen ? { position: "fixed", inset: 0, zIndex: 9999 } : { position: "relative" }),
      }}
    >
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 24, padding: "12px 24px", background: t.panel, borderBottom: `1px solid ${t.line}` }}>
        <div style={{ flex: "none" }}>
          <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 700, letterSpacing: ".18em", color: t.text3 }}>PROJECT MONITOR</div>
          <div style={{ fontSize: 12, color: t.text2, marginTop: 3 }}>{n} projects · {paused ? "PAUSED" : "LIVE"}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: embedded ? "none" : "flex", justifyContent: "center", gap: "clamp(10px, 2.5vw, 30px)", flexWrap: "wrap" }}>
          {[
            { value: String(n), label: "PROJECTS" },
            { value: String(projects.flatMap(toolsOf).length), label: "TOOLS OUT" },
            { value: String(projects.flatMap((p) => p.crews).length), label: "FOREMEN" },
            { value: String(projects.flatMap(toolsOf).filter((x) => x.condition === "Needs service").length), label: "NEEDS SVC" },
          ].map((m) => (
            <div key={m.label} style={{ textAlign: "center", minWidth: 52 }}>
              <div style={{ fontFamily: mono, fontSize: "clamp(17px, 1.6vw, 23px)", fontWeight: 700, color: t.heading, lineHeight: 1.1 }}>{m.value}</div>
              <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: ".1em", color: t.text3, marginTop: 3, whiteSpace: "nowrap" }}>{m.label}</div>
            </div>
          ))}
        </div>
        {embedded && <div style={{ flex: 1 }} />}
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontFamily: mono, fontSize: 16, fontWeight: 600, color: t.text2 }}>{clock || "—"}</span>
          <button
            onClick={() => {
              if (paused) cycleStart.current = Date.now() - dwellMs(active) * progress;
              setPaused((p) => !p);
            }}
            style={btn(paused)}
          >
            {paused ? "▶ RESUME" : "❚❚ PAUSE"}
          </button>
          <button onClick={() => setFullscreen((f) => !f)} style={btn(fullscreen)}>{fullscreen ? "✕ EXIT" : "⛶ FULL"}</button>
        </div>
      </div>

      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 24, padding: "14px 24px", background: t.card, borderBottom: `1px solid ${t.line}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontFamily: mono, fontSize: 26, fontWeight: 800, color: t.accent, letterSpacing: ".03em" }}>{active.code}</span>
            <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: ".12em", padding: "4px 10px", borderRadius: 3, color: statusColor, border: `1px solid ${statusColor}55`, background: `${statusColor}1A` }}>
              {active.status.toUpperCase()}
            </span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: t.heading, marginTop: 4, letterSpacing: "-.02em" }}>{active.name}</div>
          <div style={{ fontSize: 12.5, color: t.text3, marginTop: 2 }}>{active.city}</div>
        </div>
        <div style={{ flex: "none", display: "grid", gridTemplateColumns: "auto auto", gap: "6px 22px" }}>
          {[
            { value: String(tools.length), label: "Total tools" },
            { value: String(active.crews.length), label: "Foremen" },
            { value: String(tools.length - flagged), label: "Good" },
            { value: String(flagged), label: "Flagged" },
          ].map((m) => (
            <div key={m.label} style={{ display: "flex", alignItems: "baseline", gap: 6, justifyContent: "flex-end" }}>
              <span style={{ fontFamily: mono, fontSize: 17, fontWeight: 700, color: t.heading }}>{m.value}</span>
              <span style={{ fontSize: 11.5, color: t.text3 }}>{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: embedded ? 0 : 200, display: "flex", flexDirection: "column", position: "relative", background: t.rowA }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 16, height: 34, padding: "0 24px", background: t.cardAlt, borderBottom: `1px solid ${t.line}` }}>
          <span style={{ ...colHdr, width: 104, flex: "none" }}>TOOL ID</span>
          <span style={{ ...colHdr, flex: 1 }}>TOOL NAME</span>
          <span style={{ ...colHdr, width: 190, flex: "none" }}>ASSIGNED FOREMAN</span>
          <span style={{ ...colHdr, width: 110, flex: "none", textAlign: "right" }}>STATUS</span>
        </div>
        <div ref={tableRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", scrollbarWidth: "none" }}>
          {tools.map((r, i) => (
            <div key={r.tag} style={{ display: "flex", alignItems: "center", gap: 16, height: 34, padding: "0 24px", background: i % 2 ? t.rowB : t.rowA, borderBottom: `1px solid ${t.line2}` }}>
              <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, color: t.accent, width: 104, flex: "none" }}>{r.tag}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
              <span style={{ width: 190, flex: "none", fontSize: 13.5, fontWeight: 500, color: t.text2, whiteSpace: "nowrap" }}>{r.foreman}</span>
              <span style={{ width: 110, flex: "none", fontSize: 12.5, fontWeight: 600, color: condColor(r.condition, t), textAlign: "right" }}>{r.condition}</span>
            </div>
          ))}
        </div>
        <div style={{ position: "absolute", top: 34, right: 4, bottom: 0, width: 3, borderRadius: 2, background: t.line2 }}>
          <div style={{ position: "absolute", left: 0, width: 3, borderRadius: 2, background: t.accent, height: "22%", top: `${progress * 78}%`, transition: "top .1s linear" }} />
        </div>
      </div>

      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 16, padding: "10px 24px", background: t.cardAlt, borderTop: `1px solid ${t.line}` }}>
        <span style={{ flex: "none", fontFamily: mono, fontSize: 9.5, letterSpacing: ".15em", color: t.text3 }}>TOOLS PER FOREMAN</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {active.crews.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 11px", background: t.accentBg, border: `1px solid ${t.accent}38`, borderRadius: 3 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: t.text }}>{shortName(c.foreman)}</span>
              <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: t.accent }}>{c.tools.length}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 20, padding: "12px 24px", background: t.panel, borderTop: `1px solid ${t.line}` }}>
        <NavCard t={t} dir="prev" project={prev} onClick={() => jumpTo((idx - 1 + n) % n)} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
          <div style={{ width: "100%", maxWidth: 420, height: 3, borderRadius: 2, background: t.line2, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, background: t.accent, width: `${progress * 100}%`, transition: "width .1s linear" }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {projects.map((p, i) => (
              <button
                key={p.id}
                onClick={() => jumpTo(i)}
                aria-label={`Jump to ${p.name}`}
                style={{ width: i === idx ? 22 : 7, height: 7, borderRadius: 4, border: "none", padding: 0, cursor: "pointer", background: i === idx ? t.accent : t.line, transition: "all .25s" }}
              />
            ))}
          </div>
          <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: ".1em", color: t.text3 }}>{paused ? "PAUSED" : `NEXT IN ${secsLeft}S`}</span>
        </div>
        <NavCard t={t} dir="next" project={next} onClick={() => jumpTo((idx + 1) % n)} />
      </div>
    </div>
  );
}

function NavCard({ t, dir, project, onClick }) {
  const arrow = <span style={{ flex: "none", fontSize: 22, fontWeight: 700, color: t.text3, lineHeight: 1 }}>{dir === "prev" ? "‹" : "›"}</span>;
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", minWidth: 190, flex: "none",
        borderRadius: 4, border: `1px solid ${t.line}`, background: t.card, cursor: "pointer", fontFamily: "inherit",
        justifyContent: dir === "next" ? "flex-end" : "flex-start",
      }}
    >
      {dir === "prev" && arrow}
      <div style={{ minWidth: 0, textAlign: dir === "next" ? "right" : "left" }}>
        <div style={{ fontFamily: mono, fontSize: 8.5, letterSpacing: ".16em", color: t.text3 }}>{dir === "prev" ? "PREVIOUS" : "NEXT UP"}</div>
        <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: t.accent, marginTop: 2 }}>{project.code}</div>
        <div style={{ fontSize: 12, color: t.text2, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>{project.name}</div>
      </div>
      {dir === "next" && arrow}
    </button>
  );
}

function Placeholder({ t, label, href }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 40 }}>
      <div style={{ fontSize: 17, fontWeight: 650, color: t.heading }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 11, color: t.text3 }}>{href}</div>
      <div style={{ fontSize: 12.5, color: t.text3, maxWidth: 380, textAlign: "center", marginTop: 4 }}>
        This route exists upstream but has no design in this project yet.
      </div>
    </div>
  );
}

/* Preview mount: exposes App so this workspace renders this exact file.
   Guarded on `window`, so it is inert in a real Next.js build. */
if (typeof window !== "undefined") {
  window.STInventoryApp = App;
}
