"use client";

import { useState } from "react";
import { Plus, Trash2, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNote, PageHeader, TableSkeleton } from "@/components/sti/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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

  `pm`, `superintendent` and `foreman` ship built in and cannot be deleted or
  renamed here — they carry their own dedicated permission
  (`project.assign.pm` etc.) and the assignment hierarchy names them directly.
  A role added here has no such permission; putting a person in it is gated by
  `project.team.assign` instead, granted today to owners, the equipment
  department and office administrators.
*/

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
        description="The tiers a person can hold on a job — pm, superintendent, foreman, and whatever your organization adds."
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

      {/* The shared `Table` primitive below, not a raw table element. It
          carries `.sti-grid` (the ruled cells every other table in the app has)
          and emits the `data-slot` attributes compact density targets — a raw
          table is silently density-blind, which is not a cosmetic difference.
          This screen was the only table in the app missing both. */}
      {roles.data && (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>Holds tools &amp; a truck</TableHead>
                <TableHead>Source</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.label}</TableCell>
                  <TableCell>
                    {/* Built-in rows keep their seeded flag — the assignment
                        hierarchy and TOOLS_FOLLOW were written against these
                        three exactly as shipped, so this cell is read-only for
                        them and editable only for what an organization added. */}
                    {r.isSystem ? (
                      r.canHoldCustody ? "Yes" : "No"
                    ) : (
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={r.canHoldCustody}
                          onCheckedChange={(v) => update.mutate({ id: r.id, canHoldCustody: v === true })}
                        />
                        {r.canHoldCustody ? "Yes" : "No"}
                      </label>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {r.isSystem ? "Built in" : "Added by your organization"}
                  </TableCell>
                  <TableCell className="text-right">
                    {!r.isSystem && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive"
                        onClick={() => del.mutate({ id: r.id })}
                        title="Delete — only possible if nobody currently holds this role"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
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
