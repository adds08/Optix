"use client";

import { ChevronRight, Container, Pencil, Truck } from "lucide-react";
import { ActionMenuTrigger } from "@/components/sti/action-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ToolTable, type ToolRow } from "@/components/jobsite-tool-table";
import { PersonChip } from "@/components/sti/entity-chip";
import type { PickerRequest } from "@/components/rig-picker";
import { moneyShort } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  compact = false,
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
  /* A stacked layout instead of the wide row below, for the jobsite card
     view's right sheet — added alongside ToolTable's own `compact` prop and
     for the same reason. The wide row's rig zone is a FIXED `w-[23rem]`
     three-track grid, deliberate for a dense list (it is what lines up the
     hitch down every row), and exactly the kind of fixed width that does not
     fit a ~32rem sheet without wrapping badly. Compact drops the grid for a
     flex-wrap group instead — every `onPick`/`onAddTools` call, every
     DropdownMenu item, stays byte-identical; only the layout branches, so the
     two views can never offer different actions for the same crew. */
  compact?: boolean;
}) {
  const { rig } = crew;

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
  /*
    The crew row, 1:1 with the design (App.jsx CrewCard).

    Rigged is the whole signal on the left edge: a 3x22 bar, GREEN when the crew
    has both a truck and a trailer and AMBER when it does not. That is the one
    piece of state a foreman's row carries, and unlike the earlier version it
    actually varies down a list, because most crews are missing one or the other.

    The header is the toggle. There is no separate chevron button on the right —
    the whole strip is clickable and the caret on the left rotates. A row that
    opens a table should not need you to find a 32px target at the far edge.
  */
  const rigged = !!rig.truck && !!rig.trailer;
  const value = crew.tools.reduce((n, t) => n + (Number(t.acquisitionCost) || 0), 0);

  /* A trailer with no truck is legal here — assigning one hands it straight to
     the foreman — but it is a rig that cannot move, so the hitch says so. */
  const brokenHitch = !rig.truck && !!rig.trailer;

  /*
    A rig slot is either the unit in mono, or an amber prompt to fill it. The
    amber IS the point: a crew with no trailer cannot carry tools, and that
    belongs on the row rather than in a legend.

    An ASSIGNED unit stays changeable. It briefly was not — replacing the old
    Chip dropped its pencil, which quietly removed the only way to swap a truck
    from this screen. The pencil is hidden until hover but reappears on
    keyboard focus, because `opacity-0` hides it from a mouse and from nobody
    else; without that it would be unreachable by keyboard entirely.
  */
  const slot = (unit: string | null | undefined, kind: "truck" | "trailer", onClick: () => void) =>
    unit ? (
      <span className="group/rig flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-xs text-muted-foreground">
        {kind === "truck" ? <Truck className="size-3.5 shrink-0" aria-hidden /> : <Container className="size-3.5 shrink-0" aria-hidden />}
        <span className="truncate">{unit}</span>
        {canManage ? (
          <button
            type="button"
            aria-label={`Change ${kind}`}
            onClick={(e) => {
              /* The whole row toggles the tool table; without this the picker
                 opens and the row expands underneath it in the same click. */
              e.stopPropagation();
              onClick();
            }}
            className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/rig:opacity-100"
          >
            <Pencil className="size-3" />
          </button>
        ) : null}
      </span>
    ) : canManage ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="flex items-center gap-1 rounded-sm border border-warn/30 bg-warn-bg px-2 py-1 text-xs font-semibold text-warn transition-colors hover:bg-warn-bg/70"
      >
        + {kind}
      </button>
    ) : (
      <span className="text-xs text-muted-foreground">no {kind}</span>
    );

  if (compact) {
    return (
      <div className={cn("overflow-visible rounded-md border", striped ? "bg-muted/15" : "bg-card")}>
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle();
            }
          }}
          aria-expanded={expanded}
          className="crew-row flex cursor-pointer flex-col gap-1.5 px-3 py-2.5 transition-colors hover:bg-muted/40"
        >
          <div className="flex items-start gap-2">
            <span aria-hidden className={cn("mt-1 h-[16px] w-[3px] shrink-0 rounded-sm", rigged ? "bg-ok" : "bg-warn")} />
            <ChevronRight
              aria-hidden
              className={cn("mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform duration-150", expanded && "rotate-90")}
            />
            <span className="min-w-0 flex-1">
              <PersonChip
                id={crew.foremanId}
                externalId={crew.foremanExternalId}
                name={crew.foremanName}
                role={crew.foremanRole}
                detail={[
                  `${crew.tools.length} tool${crew.tools.length === 1 ? "" : "s"}`,
                  moneyShort(value),
                  crew.otherJobs ? `also on ${crew.otherJobs} other job${crew.otherJobs === 1 ? "" : "s"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            </span>
            {canManage ? (
              <DropdownMenu>
                <ActionMenuTrigger label={crew.foremanName} onClick={(e) => e.stopPropagation()} />
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onSelect={() => onPick({ kind: "truck", foremanId: crew.foremanId })}>
                    {rig.truck ? "Change truck" : "Assign truck"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck?.id })}>
                    {rig.trailer ? "Change hitched trailer" : rig.truck ? "Hitch a trailer" : "Assign a trailer"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onPick({ kind: "move", foremanId: crew.foremanId, projectId })}>
                    Move this crew to another job
                  </DropdownMenuItem>
                  {onAddTools ? <DropdownMenuItem onSelect={onAddTools}>Add tools to this crew</DropdownMenuItem> : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          {/* Rig slots wrap instead of sitting in a fixed 23rem track — nothing
              here needs to line up down a column the way the list's does,
              since crews stack one at a time in the sheet rather than sitting
              beside each other. */}
          <div
            className="ml-[23px] flex flex-wrap items-center gap-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            {slot(rig.truck?.unit, "truck", () => onPick({ kind: "truck", foremanId: crew.foremanId }))}
            <Hitch broken={brokenHitch} />
            {slot(rig.trailer?.unit, "trailer", () => onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck?.id }))}
          </div>
        </div>
        {expanded ? (
          <div className="border-t bg-muted/10">
            {crew.tools.length ? (
              <ToolTable rows={crew.tools} highlight={highlight} actions={canAct} compact />
            ) : (
              <p className="px-3 py-2.5 text-sm text-muted-foreground">This crew is holding nothing yet.</p>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("overflow-visible rounded-md border", striped ? "bg-muted/15" : "bg-card")}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={expanded}
        className="crew-row flex cursor-pointer flex-wrap items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/40"
      >
        <span
          aria-hidden
          className={cn("h-[22px] w-[3px] shrink-0 rounded-sm", rigged ? "bg-ok" : "bg-warn")}
        />
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />

        {/* Name over a mono role kicker, per the design. The name is still the
            link and still carries the hover detail — the design describes a
            layout, not a decision to make people uninteractive. */}
        <span className="min-w-0 flex-[1_1_150px]">
          <PersonChip
            id={crew.foremanId}
            externalId={crew.foremanExternalId}
            name={crew.foremanName}
            role={crew.foremanRole}
            detail={[
              `${crew.tools.length} tool${crew.tools.length === 1 ? "" : "s"}`,
              rig.truck ? `truck ${rig.truck.unit}` : "no truck",
              rig.trailer
                ? `trailer ${rig.trailer.unit} · ${crew.tools.filter((t) => t.locationId === rig.trailer!.locationId).length} aboard`
                : "no trailer",
              crew.otherJobs ? `also on ${crew.otherJobs} other job${crew.otherJobs === 1 ? "" : "s"}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        </span>

        {/*
          The rig zone is a FIXED width split into three tracks: the truck grows
          leftward from the centre, the hitch owns the centre, the trailer grows
          rightward. That is what puts the join on one vertical line down the
          whole list — the two tags used to sit adjacent in the flex flow, so a
          long unit name like ZZ-SEED-TRUCK shoved the pair sideways and every
          row broke at a different x.

          It only holds while the tracks either side are deterministic too, which
          is why the trailing counts below are fixed-width rather than shrink-to-
          fit: "1 tool $289" and "154 tools $4.6k" are different widths, and a
          flexible trailing zone would feed that difference straight back into
          where the rig starts.
        */}
        <span className="grid w-[23rem] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2">
          <span className="flex min-w-0 justify-self-end">
            {slot(rig.truck?.unit, "truck", () => onPick({ kind: "truck", foremanId: crew.foremanId }))}
          </span>
          <Hitch broken={brokenHitch} />
          <span className="flex min-w-0 justify-self-start">
            {slot(rig.trailer?.unit, "trailer", () =>
              onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck?.id }),
            )}
          </span>
        </span>

        <span className="w-14 shrink-0 text-right whitespace-nowrap">
          <span className="tnum font-mono text-sm font-bold text-foreground">{crew.tools.length}</span>
          <span className="text-xs text-muted-foreground"> tools</span>
        </span>
        <span className="tnum w-14 shrink-0 text-right whitespace-nowrap font-mono text-xs text-muted-foreground">
          {moneyShort(value)}
        </span>

        {canManage ? (
          <DropdownMenu>
            <ActionMenuTrigger
              label={crew.foremanName}
              onClick={(e) => e.stopPropagation()}
            />
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => onPick({ kind: "truck", foremanId: crew.foremanId })}>
                {rig.truck ? "Change truck" : "Assign truck"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck?.id })}>
                {rig.trailer ? "Change hitched trailer" : rig.truck ? "Hitch a trailer" : "Assign a trailer"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onPick({ kind: "move", foremanId: crew.foremanId, projectId })}>
                Move this crew to another job
              </DropdownMenuItem>
              {onAddTools ? (
                <DropdownMenuItem onSelect={onAddTools}>Add tools to this crew</DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
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

/*
  The hitch: a tow bar between the truck and the trailer.

  Muted while the chain makes sense. Amber when a trailer has nothing to pull
  it — this system lets you hand a trailer straight to a foreman without a
  truck, so it is a real state rather than an impossible one, and it is exactly
  the kind of thing that is invisible unless the connector says it.
*/
function Hitch({ broken }: { broken: boolean }) {
  const bar = (
    <span
      aria-hidden
      className={cn(
        "flex items-center",
        broken ? "text-warn" : "text-muted-foreground/50",
      )}
    >
      <span className="h-px w-3 bg-current" />
      <ChevronRight className="-ml-0.5 size-3" />
    </span>
  );

  if (!broken) return bar;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help">{bar}</span>
      </TooltipTrigger>
      <TooltipContent side="top">Trailer with no truck — this rig cannot move</TooltipContent>
    </Tooltip>
  );
}
