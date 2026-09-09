"use client";

import { useState } from "react";
import { ChevronDown, Plus, Trash2, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNote, PageHeader, TableSkeleton } from "@/components/sti/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchSelect } from "@/components/ui/search-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/*
  Team Roles — the tiers a person can hold on a job.

  Why this screen exists. `project_team_member.role` used to be a hard-coded
  array of exactly three strings (`pm`, `superintendent`, `foreman`), and
  Urban's own chain has more tiers than that — director, area in-charge, PM &
  general superintendent, superintendent, foreman — with the client explicit
  that "the roles and tiers are not fully set, this can expand later". This is
  where "later" happens: adding a row here is what makes a new tier assignable
  on a Tools by Jobsite card and visible in the Organization Chart, with no
  code change and no deploy.

  Deliberately NOT the Roles & Permissions screen (`/admin/roles`). That table
  is the LOGIN role — what an account may DO — and this one is the JOB
  FUNCTION a person holds on a project. The seed carries one person whose login
  role is `engineer` and whose team role is `pm`; the two are allowed to
  disagree, on purpose, so this screen must not be folded into that one.

  The tiers a new tenant starts with are ordinary rows from here on, editable
  and deletable exactly like one a tenant adds itself. They no longer carry
  dedicated permissions of their own: `project.assign.pm` and its two siblings
  were removed on 2026-09-10, because a fixed permission cannot name a tier a
  tenant invents.

  "Set by" (STI-503) is therefore the only per-tier authority there is, beside
  the tenant-wide `project.team.assign` grant. A tier — Director, Area
  In-charge, or one that shipped — is granted authority over another by SAYING
  WHICH TIERS, held on that same project, may place someone into it. Emptying
  a tier's list genuinely removes that authority now; while the dedicated
  permissions existed, one of them could still be standing behind it. Before
  this,
  a tenant-added tier had no path except `project.team.assign` (admins and
  the equipment department), because `Permission` is fixed code a settings
  screen cannot extend. This is that extension, done as data instead: a join
  table (`team_role_assigner`), not a permission.
*/

type TeamRoleListItem = {
  id: string;
  name: string;
  label: string;
  canHoldCustody: boolean;
  reportsToTeamRoleId: string | null;
  assignableByEveryone: boolean;
  assignerTeamRoleIds: string[];
};

/*
  "Set by" — a Popover holding a checklist, the same shape
  `column-menu.tsx`'s filter already uses elsewhere in the app, not a new
  pattern invented for this one screen.

  Two independent controls stacked in one panel rather than two cells,
  because they answer one question together ("who may fill this tier") and
  splitting them would let a reader miss that "Everybody" makes the list
  below it redundant rather than wrong.
*/
function SetByCell({
  row,
  allRoles,
  onToggleTier,
  onToggleEveryone,
}: {
  row: TeamRoleListItem;
  allRoles: TeamRoleListItem[];
  onToggleTier: (assignerId: string, checked: boolean) => void;
  onToggleEveryone: (checked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const others = allRoles.filter((o) => o.id !== row.id);
  const chosenLabels = row.assignerTeamRoleIds
    .map((id) => others.find((o) => o.id === id)?.label)
    .filter((l): l is string => !!l);

  const summary = row.assignableByEveryone
    ? "Everybody"
    : chosenLabels.length === 0
      ? "Nobody yet"
      : chosenLabels.length <= 2
        ? chosenLabels.join(", ")
        : `${chosenLabels[0]}, ${chosenLabels[1]} +${chosenLabels.length - 2} more`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-52 max-w-full min-w-0 justify-between gap-2 font-normal">
          <span title={summary} className={`min-w-0 flex-1 truncate text-left ${chosenLabels.length === 0 && !row.assignableByEveryone ? "text-muted-foreground" : ""}`}>
            {summary}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 max-w-[calc(100vw-2rem)] max-h-80 overflow-y-auto p-2">
        <label className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
          <Checkbox checked={row.assignableByEveryone} onCheckedChange={(v) => onToggleEveryone(v === true)} />
          Everybody
        </label>
        <div className="my-1 border-t" />
        {others.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No other roles exist yet.</p>
        ) : (
          others.map((o) => (
            <label
              key={o.id}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent aria-disabled:opacity-40"
              aria-disabled={row.assignableByEveryone}
            >
              <Checkbox
                checked={row.assignerTeamRoleIds.includes(o.id)}
                disabled={row.assignableByEveryone}
                onCheckedChange={(v) => onToggleTier(o.id, v === true)}
              />
              <span className="min-w-0 break-words">{o.label}</span>
            </label>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function TeamRolesPage() {
  const utils = trpc.useUtils();
  const me = trpc.identity.me.useQuery();
  const mayManage = (me.data?.permissions ?? []).includes("project.team.manage");

  const roles = trpc.projectTeam.roles.list.useQuery(undefined, { enabled: mayManage });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");
  const [canHoldCustody, setCanHoldCustody] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const create = trpc.projectTeam.roles.create.useMutation({
    onSuccess: () => {
      utils.projectTeam.roles.list.invalidate();
      setOpen(false);
      setName("");
      setLabel("");
      setCanHoldCustody(false);
      setFormError(null);
    },
    onError: (e) => setFormError(e.message),
  });

  const del = trpc.projectTeam.roles.delete.useMutation({
    onSuccess: () => utils.projectTeam.roles.list.invalidate(),
  });

  const update = trpc.projectTeam.roles.update.useMutation({
    onSuccess: () => utils.projectTeam.roles.list.invalidate(),
  });

  /* The ladder edge. Its own mutation rather than a field on `update` because
     it is the only one that can be REFUSED for a reason worth showing — a
     cycle — and folding it into `update` would mean a checkbox and a dropdown
     sharing one error slot. */
  const [ladderError, setLadderError] = useState<string | null>(null);
  const setReportsTo = trpc.projectTeam.roles.setReportsTo.useMutation({
    onSuccess: () => {
      setLadderError(null);
      utils.projectTeam.roles.list.invalidate();
    },
    onError: (e) => setLadderError(e.message),
  });

  /* "Set by": one mutation replaces the whole assigner list for a tier, so a
     single tick calls it with the FULL next list rather than one id at a
     time — matching the procedure's own replace-not-diff contract. */
  const setAssigners = trpc.projectTeam.roles.setAssigners.useMutation({
    onSuccess: () => utils.projectTeam.roles.list.invalidate(),
  });

  if (!me.isLoading && !mayManage) {
    return (
      <EmptyState
        title="You cannot manage team roles"
        description="This needs the project.team.manage permission."
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Team Roles"
        hideTitle
        description="The tiers a person can hold on a job, and which tier each one answers to."
        icon={Wrench}
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 size-4" />
            Add a role
          </Button>
        }
      />

      {roles.isLoading && <TableSkeleton />}
      {roles.error && <ErrorNote message={roles.error.message} />}
      {ladderError && <ErrorNote message={ladderError} />}

      {/* The shared `Table` primitive below, not a raw table element. It
          carries `.sti-grid` (the ruled cells every other table in the app has)
          and emits the `data-slot` attributes compact density targets — a raw
          table is silently density-blind, which is not a cosmetic difference.
          This screen was the only table in the app missing both. */}
      {/* `bg-card` is not optional. The `Table` primitive sets no background
          of its own, so without it the rows are transparent and the page
          ground shows through — which reads as "the table lost its white
          background". `DataTable` and every other table wrapper in the app
          already carry it; this screen was the one that did not. */}
      {roles.data && (
        <div className="overflow-hidden rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Reports to</TableHead>
                <TableHead>Set by</TableHead>
                <TableHead>Holds tools &amp; a truck</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  {/* The company's ladder, not this person's boss. Editable for
                      built-in tiers too: where a Project Manager sits differs
                      between companies, and freezing that for the seeded three
                      would make the ladder useless for most of it. Picking the
                      current option again clears the edge, which is how
                      SearchSelect already behaves everywhere else. */}
                  <TableCell>
                    <SearchSelect
                      value={r.reportsToTeamRoleId ?? ""}
                      onChange={(v) =>
                        setReportsTo.mutate({ id: r.id, reportsToTeamRoleId: v === "" ? null : v })
                      }
                      placeholder="Nobody — top of the chain"
                      widthClass="w-52"
                      options={(roles.data ?? [])
                        .filter((o) => o.id !== r.id)
                        .map((o) => ({ value: o.id, label: o.label }))}
                    />
                  </TableCell>
                  <TableCell>
                    <SetByCell
                      row={r}
                      allRoles={roles.data ?? []}
                      onToggleTier={(assignerId, checked) => {
                        const next = new Set(r.assignerTeamRoleIds);
                        if (checked) next.add(assignerId);
                        else next.delete(assignerId);
                        setAssigners.mutate({ id: r.id, assignerTeamRoleIds: [...next] });
                      }}
                      onToggleEveryone={(checked) => update.mutate({ id: r.id, assignableByEveryone: checked })}
                    />
                  </TableCell>
                  <TableCell>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={r.canHoldCustody}
                        onCheckedChange={(v) => update.mutate({ id: r.id, canHoldCustody: v === true })}
                      />
                      {r.canHoldCustody ? "Yes" : "No"}
                    </label>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive disabled:opacity-40"
                      onClick={() => del.mutate({ id: r.id })}
                      title="Delete — only possible if nobody currently holds this role"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a team role</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Display name</label>
              <Input
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  setName(e.target.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
                }}
                placeholder="Area In-charge"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Stored as <code className="rounded bg-muted px-1">{name || "…"}</code>
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={canHoldCustody} onCheckedChange={(v) => setCanHoldCustody(v === true)} />
              This role holds tools and a truck when assigned to a job
            </label>
            {formError && <p className="text-xs text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button
              disabled={!name || !label || create.isPending}
              onClick={() => create.mutate({ name, label, canHoldCustody })}
            >
              Add role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
