"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, HardHat, MapPin, Radio, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { allItems, isFieldRole } from "@/components/sti/nav-config";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

/*
  The command palette — ⌘K, or "/".

  It replaces a hand-rolled Radix popover that did entity search only. Three
  groups, in the order somebody reaching for a keyboard actually wants them:
  what they typed, where they can go, and what they can do.

  Two rules it must not break:

  - ACTIONS ARE PERMISSION-GATED, exactly like the buttons that host them. A
    palette is a second way to reach a screen, never a second way to reach a
    capability — every verb here routes to the page that owns the mutation and
    is hidden unless that page's permission is held. Nothing here mutates.
  - NAVIGATION COMES FROM THE NAV REGISTRY, not a copy of it. `allItems(role)`
    is the same source the rail and sidebar read, already permission-shaped, so
    a route added there appears here without anybody remembering to.
*/

const KIND_ICON = {
  asset: Boxes,
  employee: Users,
  project: HardHat,
  location: MapPin,
  vehicle: Radio,
} as const;

/*
  Where a search hit opens.

  `location` and `vehicle` pointed at `/locations`, which has never existed —
  `app/(app)/locations/` was an empty directory git never tracked, so selecting
  either kind navigated to a 404. Carried in verbatim from the global search
  this replaced, and easier to hit here because the palette surfaces every kind
  at once.

  Both now go to the map, which IS this product's location surface: its nav
  entry is gated on `location.read` and it plots the fleet and what rides in it.
  Neither has a per-record page to deep-link to, so the destination is the
  screen, not the row.
*/
const KIND_PATH: Record<string, (id: string) => string> = {
  asset: (id) => `/tools/${id}`,
  employee: (id) => `/people/${id}`,
  /* No `/projects/[id]` route exists yet — the register is the landing spot. */
  project: () => `/projects`,
  location: () => `/map`,
  vehicle: () => `/map`,
};

const KIND_LABEL: Record<string, string> = {
  asset: "Tools",
  employee: "People",
  project: "Jobs",
  location: "Locations",
  vehicle: "Vehicles",
};

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { role, has } = usePermissions();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  /* Debounce: entity.search hits Postgres with ilikes, and a query per
     keystroke is pointless on a fast typer. */
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const results = trpc.entity.search.useQuery(
    { q: debounced, limit: 8 },
    { enabled: open && debounced.length >= 2 },
  );

  const go = useCallback(
    (path: string) => {
      onOpenChange(false);
      setQ("");
      setDebounced("");
      router.push(path);
    },
    [onOpenChange, router],
  );

  const pages = useMemo(() => allItems(role), [role]);

  /*
    Verbs, each pointing at the screen that owns the mutation and gated on that
    screen's permission. The field layout is excluded on purpose: a foreman on a
    phone has three jobs and a palette is not one of them.
  */
  const actions = useMemo(() => {
    if (isFieldRole(role)) return [];
    return [
      { label: "Hand a tool over…", to: "/custody", perm: "transfer.create" },
      { label: "Assign a tool to somebody…", to: "/custody", perm: "assignment.create" },
      { label: "Add a tool to the register…", to: "/tools", perm: "asset.manage" },
      { label: "Add a job…", to: "/projects", perm: "project.manage" },
      { label: "Import from a spreadsheet…", to: "/tools", perm: "asset.manage" },
      { label: "Review the clearance queue…", to: "/inbox", perm: "assignment.read" },
    ].filter((a) => has(a.perm as Parameters<typeof has>[0]));
  }, [role, has]);

  const hits = results.data ?? [];
  const grouped = useMemo(() => {
    const by = new Map<string, typeof hits>();
    for (const h of hits) by.set(h.kind, [...(by.get(h.kind) ?? []), h]);
    return [...by.entries()];
  }, [hits]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search and commands"
      description="Find a tool, a person or a job, jump to a page, or start an action."
      /* cmdk filters client-side by default, which would re-filter server
         results that are already a match and hide them. The entity groups are
         server-ranked; the page and action groups still want local filtering,
         so those carry their own searchable text in `value`. */
      className="top-[20%] translate-y-0"
    >
      <CommandInput
        placeholder="Search tools, people, jobs — or type a command…"
        value={q}
        onValueChange={setQ}
      />
      <CommandList>
        <CommandEmpty>
          {debounced.length >= 2 && results.isFetching ? "Searching…" : "Nothing matches."}
        </CommandEmpty>

        {grouped.map(([kind, rows]) => {
          const Icon = KIND_ICON[kind as keyof typeof KIND_ICON] ?? Boxes;
          return (
            <CommandGroup key={kind} heading={KIND_LABEL[kind] ?? kind}>
              {rows.map((r) => (
                <CommandItem
                  key={`${kind}:${r.id}`}
                  value={`${r.label} ${r.subtitle ?? ""} ${kind}`}
                  onSelect={() => go(KIND_PATH[kind]?.(r.id) ?? "/home")}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.label}</span>
                    {r.subtitle ? (
                      <span className="block truncate text-xs text-muted-foreground">{r.subtitle}</span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}

        {grouped.length ? <CommandSeparator /> : null}

        <CommandGroup heading="Go to">
          {pages.map((n) => (
            <CommandItem key={n.href} value={`go ${n.label}`} onSelect={() => go(n.href)}>
              <n.icon className="size-4 shrink-0" />
              {n.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {actions.length ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              {actions.map((a) => (
                <CommandItem key={a.label} value={`do ${a.label}`} onSelect={() => go(a.to)}>
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

/*
  The shortcut, owned in one place so the trigger button and the key handler
  cannot disagree about what opens the palette.

  "/" is deliberately ignored while the caret is in a field — otherwise typing a
  path or a fraction into any input on the desk hijacks the page.
*/
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable);

      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}

export { CommandShortcut };
