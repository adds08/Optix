"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Pin, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { groupKey, type NavGroup, type NavItem } from "@/components/sti/nav-config";
import { pinnedItems, type NavPins } from "@/components/sti/nav-pins";

/*
  The "Search all features" launcher (design/STInventory App.dc.html).

  Trigger is the breadcrumb in the top bar: the mono uppercase group kicker
  and the current page label. The panel itself is the same two-pane shape the
  rail + sidebar use, but as one popover: the LEFT pane picks the part of the
  product, the RIGHT pane lays that part's screens out as cards with the
  one-line description each screen carries.

  Deliberate properties:

    - Groups arrive ALREADY permission-filtered from the shell — the same array
      the rail and sidebar draw from — so a card can never name a route the
      actor may not open. `navFor` + `applyFeatureStates` in app-shell.tsx do
      that once and everything downstream reads one array.
    - Pinned rows surface at the head of the LEFT pane, following the stored
      order and resolved through `pinnedItems` (which intersects against the
      permission-filtered set), so a pin outliving a permission resolves to
      nothing — exactly as the sidebar does it.
    - The search field filters feature cards by label + description, across all
      groups. It is feature discovery, not data search: the ⌘K palette is the
      thing that finds a tool or a person by tag.
    - "upcoming" rows keep their badge and lose their link, same as the sidebar.

  Clicking a group button only re-targets the right pane — it does not navigate,
  mirroring the in-product order of "answer which part, then which screen".
*/

export type FeatureMenuProps = {
  groups: NavGroup[];
  currentItem: NavItem | undefined;
  navPins: NavPins;
};

export function FeatureMenu({ groups, currentItem, navPins }: FeatureMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /* Which group's cards the right pane shows. Follows the active group while
     the menu is open and nothing else has been chosen; a click takes over. */
  const activeGroup = groups.find((g) => g.items.some((n) => n.id === currentItem?.id));
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) {
      setPicked(undefined);
      setQ("");
    }
  }, [open]);

  const shownGroup = groups.find((g) => groupKey(g) === picked) ?? activeGroup;
  const shownKey = shownGroup ? groupKey(shownGroup) : undefined;

  const pinned = useMemo(() => pinnedItems(groups, navPins.order), [groups, navPins.order]);

  /* Search across every group's items — label + description. A match from a
     non-shown group still appears, with its group heading, so "Search all
     features" means all, not "the group the right pane happens to show". */
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: { group: NavGroup; item: NavItem }[] = [];
    for (const g of groups) {
      for (const n of g.items) {
        const hay = `${n.label} ${n.desc ?? ""}`.toLowerCase();
        if (hay.includes(needle)) out.push({ group: g, item: n });
      }
    }
    return out;
  }, [groups, q]);

  const empty = q.trim().length > 0 && matches.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors",
            open ? "bg-accent" : "hover:bg-accent",
          )}
        >
          <span className="min-w-0">
            <span className="label-xs block text-sidebar-foreground/60">
              {activeGroup?.label ?? "Optix"}
            </span>
            <span className="block truncate text-sm font-semibold leading-tight text-foreground">
              {currentItem?.label ?? "Optix"}
            </span>
          </span>
          <ChevronRight
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
            aria-hidden
          />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(760px,calc(100vw-2rem))] overflow-hidden rounded-xl p-0"
      >
        {/* search row */}
        <div className="flex h-11 items-center gap-2.5 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search all features…"
            aria-label="Search all features"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="flex max-h-[420px] min-h-[300px]">
          {/* left pane — the groups, pinned first */}
          <div className="w-60 shrink-0 border-r bg-muted/40 p-2">
            {pinned.length ? (
              <div className="mb-1">
                <p className="label-xs px-2 pb-1.5 text-muted-foreground">Pinned</p>
                <div className="flex flex-col gap-0.5">
                  {pinned.map((n) => (
                    <MenuRow
                      key={`pin-${n.id}`}
                      icon={<Pin className="size-3.5" aria-hidden />}
                      label={n.label}
                      active={n.id === currentItem?.id}
                      onClick={() => {
                        router.push(n.href);
                        setOpen(false);
                      }}
                      leading={<n.icon className="size-4 shrink-0" aria-hidden />}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            <p className="label-xs px-2 pb-1.5 pt-1 text-muted-foreground">Modules</p>
            <div className="flex flex-col gap-0.5">
              {groups.map((g) => {
                const key = groupKey(g);
                return (
                  <MenuRow
                    key={key}
                    icon={<g.icon className="size-4 shrink-0" aria-hidden />}
                    label={g.label}
                    active={key === shownKey}
                    onClick={() => setPicked(key)}
                    trailing={
                      <ChevronRight
                        className={cn(
                          "size-3.5 transition-opacity",
                          key === shownKey ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden
                      />
                    }
                  />
                );
              })}
            </div>
          </div>

          {/* right pane — feature cards */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {q.trim() ? (
              empty ? (
                <p className="px-2 py-2 text-sm text-muted-foreground">No feature matches that search.</p>
              ) : (
                <FeatureGrid groups={matches.map((m) => m.group)} items={matches.map((m) => m.item)} onGo={go} />
              )
            ) : shownGroup ? (
              <FeatureGrid groups={[shownGroup]} items={shownGroup.items} onGo={go} />
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );

  function go(href: string) {
    router.push(href);
    setOpen(false);
  }
}

/* The card grid. `groups` and `items` are index-aligned so a search result can
   carry its own group heading; rows with no match share the shown group. */
function FeatureGrid({
  groups,
  items,
  onGo,
}: {
  groups: NavGroup[];
  items: NavItem[];
  onGo: (href: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-1 sm:grid-cols-2">
      {items.map((n, i) => (
        <button
          key={`${groups[i] ? groupKey(groups[i]!) : "misc"}:${n.id}`}
          type="button"
          onClick={() => onGo(n.href)}
          disabled={n.featureState === "upcoming"}
          className={cn(
            "flex min-w-0 items-start gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-accent",
            n.featureState === "upcoming" && "cursor-default opacity-60 hover:bg-transparent",
          )}
        >
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent/60 text-accent-foreground">
            <n.icon className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">{n.label}</span>
              {n.featureState ? (
                <span className="shrink-0 rounded-sm bg-accent px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent-foreground/70">
                  {n.featureState === "upcoming" ? "Soon" : "Beta"}
                </span>
              ) : null}
            </span>
            {n.desc ? (
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{n.desc}</span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/* One line in the left pane. `icon` is the leading box glyph; `leading` (when
   set) replaces it with a different glyph while remaining a plain row. */
function MenuRow({
  icon,
  leading,
  label,
  active,
  trailing,
  onClick,
}: {
  icon: React.ReactNode;
  leading?: React.ReactNode;
  label: string;
  active: boolean;
  trailing?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-foreground/75 hover:bg-accent/60 hover:text-accent-foreground",
      )}
    >
      {leading ?? icon}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
      {trailing}
    </button>
  );
}
