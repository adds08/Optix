"use client";

import { ChevronDown, Container, EllipsisVertical, HardHat, Pencil, Plus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToolTable } from "@/app/(app)/jobsites/page";
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
  truck: { id: string; unit: string; makeModel: string | null; locationId: string } | null;
  trailer: { id: string; unit: string; makeModel: string | null; locationId: string } | null;
};

export type Crew = {
  id: string;
  foremanId: string;
  foremanName: string;
  foremanRole: string;
  rig: Rig;
  tools: any[];
  otherJobs: number;
};

export function CrewCard({
  crew,
  projectId,
  expanded,
  onToggle,
  onPick,
}: {
  crew: Crew;
  projectId: string;
  expanded: boolean;
  onToggle: () => void;
  onPick: (r: PickerRequest) => void;
}) {
  const { rig } = crew;
  const aboard = rig.trailer ? crew.tools.filter((t) => t.currentLocationId === rig.trailer!.locationId).length : 0;
  const value = crew.tools.reduce((n, t) => n + (Number(t.acquisitionCost) || 0), 0);

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2">
        <span className="flex min-w-40 items-center gap-2">
          <HardHat className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight">{crew.foremanName}</span>
            <span className="block text-xs text-muted-foreground">
              {crew.foremanRole}
              {crew.otherJobs ? ` · also on ${crew.otherJobs} other job${crew.otherJobs === 1 ? "" : "s"}` : ""}
            </span>
          </span>
        </span>

        {/* the rig chain */}
        <span className="flex flex-wrap items-center gap-1.5">
          {rig.truck ? (
            <Chip icon={Truck} label={rig.truck.unit} onEdit={() => onPick({ kind: "truck", foremanId: crew.foremanId })} />
          ) : (
            <Button variant="outline" size="sm" className="h-6.5 border-dashed px-2 text-xs text-primary" onClick={() => onPick({ kind: "truck", foremanId: crew.foremanId })}>
              <Plus className="size-3" /> Truck
            </Button>
          )}
          <span className="text-xs text-muted-foreground">→</span>
          {rig.trailer ? (
            <Chip
              icon={Container}
              label={rig.trailer.unit}
              meta={`· ${aboard} aboard`}
              onEdit={() => onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck?.id })}
            />
          ) : rig.truck ? (
            <Button variant="outline" size="sm" className="h-6.5 border-dashed px-2 text-xs text-primary" onClick={() => onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck!.id })}>
              <Plus className="size-3" /> Trailer
            </Button>
          ) : (
            <span className="rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">Trailer needs a truck</span>
          )}
        </span>

        <span className="ml-auto flex items-center gap-2">
          <span className="text-right whitespace-nowrap text-xs">
            <span className="block">{crew.tools.length} tool{crew.tools.length === 1 ? "" : "s"}</span>
            <span className="tnum block text-muted-foreground">{money(value)}</span>
          </span>
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
              <DropdownMenuItem
                disabled={!rig.truck}
                onSelect={() => rig.truck && onPick({ kind: "trailer", foremanId: crew.foremanId, truckId: rig.truck.id })}
              >
                {rig.trailer ? "Change trailer" : "Hitch a trailer"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onPick({ kind: "move", foremanId: crew.foremanId, projectId })}>
                Move this crew to another job
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onToggle}>{expanded ? "Hide tools" : "Show tools"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="icon" className="size-7" aria-label="Show tools" onClick={onToggle}>
            <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
          </Button>
        </span>
      </div>

      {expanded ? (
        <div className="border-t">
          {crew.tools.length ? <ToolTable rows={crew.tools} /> : <p className="px-3 py-2.5 text-sm text-muted-foreground">This crew is holding nothing yet.</p>}
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
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  meta?: string;
  onEdit: () => void;
}) {
  return (
    <span className="flex h-6.5 items-center gap-1.5 rounded-md border bg-card pl-2 pr-1 text-xs">
      <Icon className="size-3.5 shrink-0 text-ok" aria-hidden />
      <span className="font-medium">{label}</span>
      {meta ? <span className="text-muted-foreground">{meta}</span> : null}
      <button type="button" onClick={onEdit} className="grid size-4.5 place-items-center text-muted-foreground hover:text-foreground" aria-label={`Change ${label}`}>
        <Pencil className="size-3" />
      </button>
    </span>
  );
}
