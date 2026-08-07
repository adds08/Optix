"use client";

import { ChevronDown, Container, EllipsisVertical, HardHat, Pencil, Plus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToolTable, type ToolRow } from "@/components/jobsite-tool-table";
import { Highlight } from "@/components/highlight";
import type { PickerRequest } from "@/components/rig-picker";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  One crew row: a foreman, their rig, and their tools.

  The header reads left to right the way the yard works —

      [hard hat] Dwayne Ellis   →  UIC-T12  →  UIC-TR04 · 4 aboard   2 tools $1,470

  — because that is the chain custody actually follows: hand the truck over and
  the trailer and everything in it goes with it (location.setCustodian does
  exactly that server-side). A trailer with no truck is not offered: you cannot
  hitch to nothing.
*/

export type Rig = {
  truck: { id: string; unit: string; makeModel: string | null; locationId: string; projectId: string | null } | null;
  trailer: { id: string; unit: string; makeModel: string | null; locationId: string; projectId: string | null } | null;
};

export type Crew = {
  id: string;
  foremanId: string;
  /* The employee's readable ID (e.g. "4438") — the one you can say out loud,
     unlike the uuid. Shown in front of the name. */
  foremanExternalId: string | null;
  foremanName: string;
  foremanRole: string;
  rig: Rig;
  tools: ToolRow[];
  otherJobs: number;
};

export function CrewCard({
  crew,
  projectId,
  expanded,
  onToggle,
  onPick,
  onAddTools,
  canManage = false,
  canAct = false,
  striped = false,
  highlight,
}: {
  crew: Crew;
  projectId: string;
  expanded: boolean;
  onToggle: () => void;
  onPick: (r: PickerRequest) => void;
  /* Opens the "add loose tools to this crew" dialog. */
  onAddTools?: () => void;
  /* False hides every rig-changing control (pencil, dashed add buttons, the
     ⋮ actions) — a viewer who cannot act must not see controls that only
     fail, nor be handed the tenant-wide vehicle list behind them. */
  canManage?: boolean;
  /* Shows the per-tool ⋯ menu (return / hand over / status) on the crew's
     tool table. */
  canAct?: boolean;
  /* Alternating crew rows get a soft fill so two foremen side by side read as
     two different people, not one blurred list. */
  striped?: boolean;
  /* The live search text, for marking the foreman's name. */
  highlight?: string;
}) {
  const { rig } = crew;
  const aboard = rig.trailer ? crew.tools.filter((t) => t.locationId === rig.trailer!.locationId).length : 0;
  const value = crew.tools.reduce((n, t) => n + (Number(t.acquisitionCost) || 0), 0);

  return (
    <div className={cn("overflow-hidden rounded-md border", striped ? "bg-muted/15" : "bg-card")}>
      {/* The crew header reads left to right the way the yard works — foreman,
         then the rig, then the tools/value — with each zone keeping its own
         width. A long foreman name truncates inside its zone, the rig chips
         wrap inside theirs, and the trailing actions never wrap; when the row
         runs out of room it wraps as a whole line instead of squeezing. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-muted/30 px-3 py-2">
        {/* foreman */}
        <span className="flex min-w-40 items-center gap-2">
          <HardHat className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
              {crew.foremanExternalId ? (
                <span className="tnum shrink-0 rounded border bg-card/80 px-1 font-mono text-[11px] font-normal leading-4 text-muted-foreground">
                  {crew.foremanExternalId}
                </span>
              ) : null}
              <span className="min-w-0 truncate">
                <Highlight text={crew.foremanName} q={highlight} />
              </span>
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {crew.foremanRole}
              {crew.otherJobs ? ` · also on ${crew.otherJobs} other job${crew.otherJobs === 1 ? "" : "s"}` : ""}
            </span>
          </span>
        </span>

        {/* the rig chain — its own soft band; truck → trailer reads as one
           unit, taking the middle of the row */}
        <span className="flex min-w-56 flex-1 flex-wrap items-center gap-1.5 rounded-md bg-muted/20 px-2 py-1">
          {rig.truck ? (
            <Chip
              tone="truck"
              icon={Truck}
              label={rig.truck.unit}
              onEdit={canManage ? () => onPick({ kind: "truck", foremanId: crew.foremanId }) : undefined}
            />
          ) : canManage ? (
            <Button variant="outline" size="sm" className="h-6.5 border-dashed px-2 text-xs text-primary" onClick={() => onPick({ kind: "truck", foremanId: crew.foremanId })}>
              <Plus className="size-3" /> Truck
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">no truck</span>
          )}
          <span className="text-xs text-muted-foreground">→</span>
          {rig.trailer ? (
            <Chip
              tone="trailer"
              icon={Container}
              label={rig.trailer.unit}
              meta={`· ${aboard} aboard`}
              onEdit={canManage ? () => onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck?.id }) : undefined}
            />
          ) : !canManage ? (
            <span className="text-xs text-muted-foreground">no trailer</span>
          ) : (
            /* A trailer does not need a truck: assigning one hands it straight
               to the foreman (the picker takes it off any truck it rides). */
            <Button variant="outline" size="sm" className="h-6.5 border-dashed px-2 text-xs text-primary" onClick={() => onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck?.id })}>
              <Plus className="size-3" /> Trailer
            </Button>
          )}
        </span>

        {/* tools/value + actions, pinned to the end */}
        <span className="ml-auto flex shrink-0 items-center gap-2.5 whitespace-nowrap">
          <span className="text-right whitespace-nowrap text-xs">
            <span className="block">{crew.tools.length} tool{crew.tools.length === 1 ? "" : "s"}</span>
            <span className="tnum block text-muted-foreground">{money(value)}</span>
          </span>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-7" aria-label={`Actions for ${crew.foremanName}`}>
                  <EllipsisVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => onPick({ kind: "truck", foremanId: crew.foremanId })}>
                  {rig.truck ? "Change truck" : "Assign truck"}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck?.id })}>
                  {rig.trailer ? "Change trailer" : rig.truck ? "Hitch a trailer" : "Assign a trailer"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onPick({ kind: "move", foremanId: crew.foremanId, projectId })}>
                  Move this crew to another job
                </DropdownMenuItem>
                {onAddTools ? (
                  <DropdownMenuItem onSelect={onAddTools}>Add tools to this crew</DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={onToggle}>{expanded ? "Hide tools" : "Show tools"}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button variant="outline" size="icon" className="size-7" aria-label="Show tools" onClick={onToggle}>
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </Button>
        </span>
      </div>

      {expanded ? (
        <div className="border-t bg-muted/10">
          {crew.tools.length ? (
            <ToolTable rows={crew.tools} highlight={highlight} actions={canAct} />
          ) : (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">This crew is holding nothing yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Chip({
  icon: Icon,
  label,
  meta,
  onEdit,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  meta?: string;
  onEdit?: () => void;
  /* Truck and trailer chips carry slightly different fills so the rig chain
     is scannable at a glance: the truck reads primary, the trailer accent. */
  tone?: "truck" | "trailer";
}) {
  return (
    <span
      className={cn(
        "flex h-6.5 max-w-full items-center gap-1.5 rounded-md border pl-2 pr-1 text-xs",
        tone === "truck" ? "border-primary/25 bg-primary/5" : tone === "trailer" ? "border-accent/25 bg-accent/10" : "bg-card",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", tone === "truck" ? "text-primary" : "text-ok")} aria-hidden />
      <span className="truncate font-medium">{label}</span>
      {meta ? <span className="shrink-0 text-muted-foreground">{meta}</span> : null}
      {onEdit ? (
        <button type="button" onClick={onEdit} className="grid size-4.5 shrink-0 place-items-center text-muted-foreground hover:text-foreground" aria-label={`Change ${label}`}>
          <Pencil className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
