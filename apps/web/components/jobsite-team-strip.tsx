"use client";

import { Briefcase, ClipboardCheck, Plus, X, type LucideIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { EntityPicker } from "@/components/ui/entity-picker";
import { cn } from "@/lib/utils";

/*
  The team strip on a Tools by Jobsite card: who RUNS this job.

  The API has always accepted `pm` and `superintendent` roles on
  project_team_member, but no screen ever called them — foreman assignment had
  the crew rows and the rig picker, and PMs/supers had nowhere to live. This is
  the missing surface: the PM(s) and superintendent(s) of a job, shown on the
  card, with add/remove gated on the role's own permission.

  Two deliberate rules:

  - A PM/super assignment is a PURE ROSTER ENTRY. It must not run the foreman
    "move" machinery (`moveEmployeeToProject`) — no tools follow, no primary
    project changes. The API enforces this; this component just never asks for
    the foreman path.
  - Removing a PM/super is also roster-only. A foreman cannot be removed here —
    that path requires moving their tools first and lives in the crew rows.
*/

type Member = {
  id: string;
  employeeId: string;
  name: string;
  externalId: string | null;
  /* Only leaders are rendered here — foremen live in the crew rows, because
     removing one is a custody move, not a roster entry. */
  role: "pm" | "superintendent";
  employeeStatus: string;
};

/* Leading glyph per role, matching the person-chip convention in
   entity-chip.tsx — PM reads as a briefcase, a superintendent as a clipboard.
   Both are white-hat supervision, so they share the white hat token. */
const ROLE_ICON: Record<Member["role"], LucideIcon> = {
  pm: Briefcase,
  superintendent: ClipboardCheck,
};

export function JobsiteTeamStrip({
  projectId,
  members,
  candidates,
  canAssignPm,
  canAssignSuper,
}: {
  projectId: string;
  members: Member[];
  candidates: { id: string; name: string; externalId: string | null; employeeRole: string }[];
  canAssignPm: boolean;
  canAssignSuper: boolean;
}) {
  const utils = trpc.useUtils();

  const assign = trpc.projectTeam.assign.useMutation({
    /* EntityPicker closes itself on select, so there is no panel left to close
       here — only the roster to refetch. */
    onSuccess: () => utils.projectTeam.all.invalidate(),
  });
  const remove = trpc.projectTeam.remove.useMutation({
    onSuccess: () => {
      utils.projectTeam.all.invalidate();
    },
  });

  const pm = members.filter((m) => m.role === "pm");
  const supers = members.filter((m) => m.role === "superintendent");
  const canAssign = (role: "pm" | "superintendent") =>
    role === "pm" ? canAssignPm : canAssignSuper;

  const pickOptions = (role: "pm" | "superintendent") =>
    candidates.filter(
      (c) =>
        !members.some((m) => m.role === role && m.employeeId === c.id) &&
        (role === "pm"
          ? c.employeeRole === "pm" || c.employeeRole === "engineer"
          : c.employeeRole === "superintendent"),
    );

  const chip = (m: Member) => {
    const Icon = ROLE_ICON[m.role];
    return (
      <span
        key={m.id}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs",
          m.role === "pm"
            ? "border-primary/25 bg-primary/5 text-foreground"
            : "border-warn/25 bg-warn-bg text-foreground",
        )}
      >
        <Icon className="size-3 shrink-0 text-hat-white" aria-hidden />
        {m.role === "pm" ? "PM" : "SUP"}
        <span className="font-medium">{m.externalId ? `${m.externalId} · ${m.name}` : m.name}</span>
        {canAssign(m.role) ? (
          <button
            type="button"
            aria-label={`Remove ${m.name} from the ${m.role} role`}
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate({ projectId, employeeId: m.employeeId, role: m.role });
            }}
            className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
          >
            <X className="size-3" aria-hidden />
          </button>
        ) : null}
      </span>
    );
  };

  const addButton = (role: "pm" | "superintendent") => {
    if (!canAssign(role)) return null;
    const noun = role === "pm" ? "project manager" : "superintendent";
    const opts = pickOptions(role).map((c) => ({
      value: c.id,
      label: c.name,
      /*
        The hint is what makes this list usable at all.

        This register has several people sharing a display name and many with no
        external id, so the old menu rendered rows that read identically — eight
        superintendents, three of them literally "Other Super", with no way to
        tell which one you were assigning. The id when there is one, the role
        when there is not, and EntityPicker searches this string as well as the
        name.
      */
      hint: c.externalId ? c.externalId : c.employeeRole.replace(/_/g, " "),
    }));

    return (
      <EntityPicker
        options={opts}
        placeholder={`Search ${noun}s…`}
        empty={opts.length ? `No ${noun} matches.` : "None left to add."}
        onSelect={(id) => {
          assign.mutate({ projectId, employeeId: id, role });
        }}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-0.5 rounded-sm border border-dashed border-muted-foreground/40 px-2 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
            aria-label={`Add a ${noun}`}
          >
            <Plus className="size-2.5" aria-hidden />
            {role === "pm" ? "PM" : "SUP"}
          </Button>
        }
      />
    );
  };

  const leaderCount = pm.length + supers.length;
  if (leaderCount === 0 && !canAssignPm && !canAssignSuper) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pm.map(chip)}
      {supers.map(chip)}
      {addButton("pm")}
      {addButton("superintendent")}
    </div>
  );
}
