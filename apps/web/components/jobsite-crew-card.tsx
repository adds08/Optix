"use client";

import { ChevronDown, Container, EllipsisVertical, Pencil, Plus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToolTable, type ToolRow } from "@/components/jobsite-tool-table";
import { PersonChip } from "@/components/sti/entity-chip";
import type { PickerRequest } from "@/components/rig-picker";
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

  /* The crew tick (design readme, "The edge accent"): crews get a short 3x20px
     mark rather than the full-height bar a job card carries, so a column of
     crews inside one job never competes with the job's own edge. It states the
     rig, which is the crew-level question the board exists to answer — amber
     the moment a crew cannot haul, accent once truck and trailer are both on. */
  /*
    The crew tick marks the EXCEPTION, not the rule.

    It first shipped as warn-when-no-truck, which is defensible until you look
    at a real yard: 49 of 51 crews have no truck, so every row lit amber and a
    column of identical marks carried no information at all. Worse, on an amber
    palette warn and primary are the same hue, so the marks were indistinguish-
    able from the chrome around them.

    A fully rigged crew is the rare, good state, so that is what gets the
    accent; everything else gets the border colour and stays quiet. The missing
    truck is not lost — the row already carries a "+ Truck" control saying so in
    words, and the job header above counts them.

    Whole class strings, never `before:${tone}`: Tailwind scans source text, so
    a class assembled at runtime is never generated and the tick renders with no
    colour at all.
  */
  const tick = rig.truck && rig.trailer ? "before:bg-primary" : "before:bg-border";

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border",
        "before:absolute before:left-0 before:top-1/2 before:h-6 before:w-[3px] before:-translate-y-1/2 before:rounded-r-sm",
        tick,
        striped ? "bg-muted/15" : "bg-card",
      )}
    >
      {/*
        Three COLUMNS, not three flex zones.

        The zones were sized by their contents — the foreman span had a minimum
        width but no maximum, so it grew with the name and every row started its
        rig chain at a different x. Down a list of fifty crews that ragged edge
        is the thing that reads as "not aligned", and no amount of spacing fixes
        it while the columns are elastic. A grid pins the tracks, so the rigs
        line up with each other and the counts line up with each other whatever
        the names do.

        The track widths are FIXED, and that part is load-bearing. Every crew is
        its own grid container, so `auto` tracks would size to each row's own
        content and the columns would go right back to being ragged — grid only
        aligns tracks within one grid, and these cannot share one without
        subgrid across separately bordered cards. Fixed tracks give every row
        the same geometry. `minmax(0, …)` lets them shrink on a narrow window,
        which is safe precisely because all the rows in a card shrink together.

        The rig is justified to the END of its track, so the chain finishes
        against the counts rather than trailing off mid-row. Below md the grid
        collapses to stacked rows, where alignment is not the problem.
      */}
      <div className="crew-row grid grid-cols-1 items-center gap-x-5 gap-y-2.5 bg-muted/30 px-3.5 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,21rem)_12rem]">
        {/* The foreman as ONE identity — id and name inside one border, with the
            role and the rest on hover. See PersonChip; the role used to sit
            beside the name and was what squeezed the name off a narrow row. */}
        <PersonChip
          id={crew.foremanId}
          externalId={crew.foremanExternalId}
          name={crew.foremanName}
          role={crew.foremanRole}
          detail={[
            `${crew.tools.length} tool${crew.tools.length === 1 ? "" : "s"}`,
            rig.truck ? `truck ${rig.truck.unit}` : "no truck",
            rig.trailer ? `trailer ${rig.trailer.unit}` : null,
            crew.otherJobs ? `also on ${crew.otherJobs} other job${crew.otherJobs === 1 ? "" : "s"}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />

        {/* the rig chain — truck → trailer reads as one unit, closed up against
            the counts. No band behind it: a tinted box stretched across an
            elastic track was drawing a shape that had nothing to do with the
            content sitting in it. */}
        <span className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <span className="justify-self-start">
          {rig.truck ? (
            <Chip
              tone="truck"
              icon={Truck}
              label={rig.truck.unit}
              onEdit={canManage ? () => onPick({ kind: "truck", foremanId: crew.foremanId }) : undefined}
            />
          ) : canManage ? (
            <Button variant="outline" size="sm" className="h-8 border-dashed border-muted-foreground/40 px-2.5 text-[13px] text-muted-foreground hover:border-primary/50 hover:text-primary" onClick={() => onPick({ kind: "truck", foremanId: crew.foremanId })}>
              <Plus className="size-3" /> Truck
            </Button>
          ) : (
            <span className="text-[13px] text-muted-foreground">no truck</span>
          )}
          </span>
          <span className="text-[13px] text-muted-foreground" aria-hidden>→</span>
          <span className="justify-self-end">
          {rig.trailer ? (
            <Chip
              tone="trailer"
              icon={Container}
              label={rig.trailer.unit}
              meta={`· ${aboard} aboard`}
              onEdit={canManage ? () => onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck?.id }) : undefined}
            />
          ) : !canManage ? (
            <span className="text-[13px] text-muted-foreground">no trailer</span>
          ) : (
            /* A trailer does not need a truck: assigning one hands it straight
               to the foreman (the picker takes it off any truck it rides). */
            <Button variant="outline" size="sm" className="h-8 border-dashed border-muted-foreground/40 px-2.5 text-[13px] text-muted-foreground hover:border-primary/50 hover:text-primary" onClick={() => onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck?.id })}>
              <Plus className="size-3" /> Trailer
            </Button>
          )}
          </span>
        </span>

        {/* tools/value + actions — its own track, so the counts form a column */}
        <span className="flex shrink-0 items-center gap-2.5 justify-self-end whitespace-nowrap">
          <span className="tnum whitespace-nowrap text-sm font-semibold">
            {crew.tools.length} tool{crew.tools.length === 1 ? "" : "s"}
          </span>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="size-8" aria-label={`Actions for ${crew.foremanName}`}>
                  <EllipsisVertical className="size-4" />
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
          <Button variant="outline" size="icon" className="size-8" aria-label="Show tools" onClick={onToggle}>
            <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} />
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
        "rig-chip flex h-8 max-w-full items-center gap-2 rounded-md border pl-2.5 pr-1.5 text-[13px]",
        tone === "truck" ? "border-primary/25 bg-primary/5" : tone === "trailer" ? "border-accent/25 bg-accent/10" : "bg-card",
      )}
    >
      <Icon className={cn("size-4 shrink-0", tone === "truck" ? "text-primary" : "text-ok")} aria-hidden />
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
