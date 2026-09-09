"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EntityField } from "@/components/ui/entity-picker";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorNote, PageHeader, TableSkeleton } from "@/components/sti/page";
import { toast } from "sonner";

/*
  BambooHR sends a job title as plain text on every synced employee; nothing
  about it tells Optix what that title should MEAN here. This screen is the
  one place that decision gets made — per title, not per person — so a synced
  title stops sitting at "Needs review" the moment two people at once.

  Two distinct actions, and they used to look like one:
    - Deciding what a title MEANS (disposition + an Optix role). Read-only
      against BambooHR — `save`/`saveMany` write only this tenant's own
      mapping table.
    - APPLYING that decision to specific people (`applyMapping`), which
      replaces their live Optix role and, if they can sign in, their account
      permissions. That is why it stays a deliberate, per-person selection
      even after a title is mapped — a title decision is a policy; applying
      it to someone with a login is an account change.

  A tenant can carry well over a hundred titles. Checking one box and Saving,
  once, per title was the whole workflow before this — the checkbox column
  below and the bulk panel it opens are what make "map these thirty titles to
  Foreman" one action instead of thirty.
*/

type Disposition = "review" | "mapped" | "no_login";

const DISPOSITION_LABEL: Record<Disposition, string> = {
  review: "Needs review",
  mapped: "Mapped",
  no_login: "No login expected",
};

export default function EmployeeMappingPage() {
  const query = trpc.employeeMapping.list.useQuery();
  const roles = trpc.role.list.useQuery();
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  /* Checked rows — the bulk-action set. Deliberately a Set<title>, not an
     array: toggling one row is a lookup either way, and department is always
     blank for a bulk write (see `saveMany`'s own comment), so the title text
     is the whole identity a checked row needs. */
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /* The single title the right panel is showing detail for — set by
     clicking a row's title, independent of `checked`. Clicking a title opens
     it; ticking its box selects it for a bulk save. The same row supports
     both without either one implying the other, the same split this app's
     row lists (People, Tools) already use between "open" and "select". */
  const [openTitle, setOpenTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [roleId, setRoleId] = useState("");
  const [disposition, setDisposition] = useState<Disposition>("review");
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [error, setError] = useState("");

  const [bulkDisposition, setBulkDisposition] = useState<Disposition>("mapped");
  const [bulkRoleId, setBulkRoleId] = useState("");

  const openRow = (title: string) => {
    const m = query.data?.mappings.find(mp => mp.jobTitle === title && !mp.department);
    setOpenTitle(title);
    setDepartment("");
    setRoleId(m?.roleId ?? "");
    setDisposition((m?.disposition as Disposition) ?? "review");
    setSelectedEmployees([]);
    setError("");
  };

  const toggleChecked = (title: string, isChecked: boolean) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (isChecked) next.add(title);
      else next.delete(title);
      return next;
    });
  };

  const save = trpc.employeeMapping.save.useMutation({
    onSuccess: async () => {
      await query.refetch();
      toast.success("Mapping saved. Employee access has not changed.");
    },
    onError: e => setError(e.message),
  });

  const saveMany = trpc.employeeMapping.saveMany.useMutation({
    onSuccess: async (res) => {
      await query.refetch();
      setChecked(new Set());
      toast.success(`Saved. ${res.count} title${res.count === 1 ? "" : "s"} mapped. Employee access has not changed.`);
    },
    onError: e => setError(e.message),
  });

  const apply = trpc.employeeMapping.applyMapping.useMutation({
    onSuccess: async () => {
      await query.refetch();
      await utils.identity.me.invalidate();
      setSelectedEmployees([]);
      toast.success("Selected employees updated");
    },
    onError: e => setError(e.message),
  });

  if (query.isLoading) return <TableSkeleton />;
  if (query.error) return <ErrorNote message={query.error.message} />;

  const filteredTitles = (query.data?.titles ?? []).filter(t => t.toLowerCase().includes(search.toLowerCase()));
  const dispositionOf = (t: string) => (query.data?.mappings.find(m => m.jobTitle === t && !m.department)?.disposition as Disposition) ?? "review";
  const allFilteredChecked = filteredTitles.length > 0 && filteredTitles.every(t => checked.has(t));

  const mapping = query.data?.mappings.find(m => m.jobTitle === openTitle && m.department === department);
  const people = (query.data?.employees ?? []).filter(e => e.jobTitle === openTitle && (!department || e.department === department));

  const bulkMode = checked.size >= 2;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ArrowRightLeft}
        title="BambooHR titles → Optix roles"
        description="Review the saved HR titles and choose what they mean in Optix. This page makes no calls to BambooHR. Mappings are suggestions until you select people and apply them. Existing individual assignments stay unchanged during sync."
      />

      {error && <ErrorNote message={error} />}

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <section className="space-y-3">
          <Input
            placeholder="Find a job title…"
            aria-label="Find job title"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="max-h-[65vh] overflow-y-auto rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allFilteredChecked}
                      onCheckedChange={v => {
                        setChecked(prev => {
                          const next = new Set(prev);
                          if (v === true) filteredTitles.forEach(t => next.add(t));
                          else filteredTitles.forEach(t => next.delete(t));
                          return next;
                        });
                      }}
                      aria-label="Select all filtered titles"
                    />
                  </TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTitles.map(t => (
                  <TableRow key={t} className={openTitle === t ? "bg-muted" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={checked.has(t)}
                        onCheckedChange={v => toggleChecked(t, v === true)}
                        aria-label={`Select ${t}`}
                      />
                    </TableCell>
                    <TableCell>
                      <button type="button" onClick={() => openRow(t)} className="text-left font-medium hover:underline">
                        {t}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{DISPOSITION_LABEL[dispositionOf(t)]}</TableCell>
                  </TableRow>
                ))}
                {filteredTitles.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                      No titles match “{search}”.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        <section className="space-y-4">
          {bulkMode ? (
            <div className="space-y-4 rounded-md border bg-card p-4">
              <div>
                <h2 className="font-semibold">{checked.size} titles selected</h2>
                <p className="text-sm text-muted-foreground">
                  One disposition and role, saved for all {checked.size} at once. Any title that already carries a
                  department-specific mapping keeps it — this only writes the department-blank rule.
                </p>
              </div>
              <div className="space-y-1 text-sm">
                <label className="block">Disposition</label>
                <EntityField
                  value={bulkDisposition}
                  onChange={v => setBulkDisposition(v as Disposition)}
                  placeholder="Disposition"
                  options={[
                    { value: "review", label: "Needs review" },
                    { value: "mapped", label: "Map to an Optix role" },
                    { value: "no_login", label: "No login expected" },
                  ]}
                />
              </div>
              {bulkDisposition === "mapped" && (
                <div className="space-y-1 text-sm">
                  <label className="block">Optix role</label>
                  <EntityField
                    value={bulkRoleId}
                    onChange={setBulkRoleId}
                    options={(roles.data ?? []).map(r => ({ value: r.id, label: r.name }))}
                    placeholder="Choose Optix role"
                    searchPlaceholder="Find role"
                    emptyLabel="No roles"
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={saveMany.isPending || (bulkDisposition === "mapped" && !bulkRoleId)}
                  onClick={() =>
                    saveMany.mutate({
                      jobTitles: [...checked],
                      roleId: bulkDisposition === "mapped" ? bulkRoleId : null,
                      disposition: bulkDisposition,
                    })
                  }
                >
                  {saveMany.isPending ? "Saving…" : `Save mapping for ${checked.size} titles`}
                </Button>
                <Button variant="ghost" onClick={() => setChecked(new Set())}>
                  Clear selection
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Project tiers and who may assign them are configured separately in{" "}
                <Link className="text-primary underline" href="/settings/team-roles">
                  Team Roles
                </Link>
                . Saving a mapping does not place anyone on a project, and does not change anyone's account —
                applying a role to specific people is still a separate step per title.
              </p>
            </div>
          ) : !openTitle ? (
            <p className="text-sm text-muted-foreground">
              Click a title to review its Optix role and affected employees, or tick two or more to map them together.
            </p>
          ) : (
            <div className="space-y-4 rounded-md border bg-card p-4">
              <h2 className="font-semibold">{openTitle}</h2>
              <EntityField
                value={department}
                onChange={v => {
                  setDepartment(v);
                  const m = query.data?.mappings.find(mp => mp.jobTitle === openTitle && mp.department === v);
                  setRoleId(m?.roleId ?? "");
                  setDisposition((m?.disposition as Disposition) ?? "review");
                  setSelectedEmployees([]);
                }}
                options={[{ value: "", label: "All departments" }, ...(query.data?.departments ?? []).map(d => ({ value: d, label: d }))]}
                placeholder="Department"
                searchPlaceholder="Find department"
                emptyLabel="No departments"
              />
              <div className="space-y-1 text-sm">
                <label className="block">Disposition</label>
                <EntityField
                  value={disposition}
                  onChange={v => setDisposition(v as Disposition)}
                  placeholder="Disposition"
                  options={[
                    { value: "review", label: "Needs review" },
                    { value: "mapped", label: "Map to an Optix role" },
                    { value: "no_login", label: "No login expected" },
                  ]}
                />
              </div>
              {disposition === "mapped" && (
                <EntityField
                  value={roleId}
                  onChange={setRoleId}
                  options={(roles.data ?? []).map(r => ({ value: r.id, label: r.name }))}
                  placeholder="Choose Optix role"
                  searchPlaceholder="Find role"
                  emptyLabel="No roles"
                />
              )}
              <Button
                disabled={save.isPending || (disposition === "mapped" && !roleId)}
                onClick={() => save.mutate({ jobTitle: openTitle, department, roleId: disposition === "mapped" ? roleId : null, disposition })}
              >
                {save.isPending ? "Saving…" : "Save mapping"}
              </Button>
              <p className="text-sm text-muted-foreground">
                Project tiers and who may assign them are configured separately in{" "}
                <Link className="text-primary underline" href="/settings/team-roles">
                  Team Roles
                </Link>
                . This does not place anyone on a project.
              </p>

              <div className="rounded-md border">
                <div className="border-b p-3 font-medium">Review affected employees</div>
                {people.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">No imported employees currently hold this title.</p>
                ) : (
                  <ul>
                    {people.map(p => (
                      <li key={p.id} className="flex items-start gap-3 border-b p-3 text-sm last:border-b-0">
                        <Checkbox
                          checked={selectedEmployees.includes(p.id)}
                          disabled={p.status !== "active" || !!p.flagged}
                          onCheckedChange={v =>
                            setSelectedEmployees(ids => (v === true ? [...ids, p.id] : ids.filter(id => id !== p.id)))
                          }
                        />
                        <span>
                          <Link href={`/people/${p.id}`} className="font-medium hover:underline">
                            {p.name}
                          </Link>
                          <span className="block text-muted-foreground">
                            Current: {roles.data?.find(r => r.id === p.roleId)?.name ?? "No Optix role"} ·{" "}
                            {p.department ?? "No department"}
                            {p.flagged || p.status !== "active" ? " · Inactive — review access separately" : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Button
                disabled={
                  !mapping ||
                  mapping.disposition !== "mapped" ||
                  !selectedEmployees.length ||
                  apply.isPending ||
                  mapping.roleId !== roleId ||
                  mapping.disposition !== disposition
                }
                onClick={() => mapping && apply.mutate({ mappingId: mapping.id, employeeIds: selectedEmployees })}
              >
                {apply.isPending ? "Applying…" : `Apply saved role to ${selectedEmployees.length} selected employees`}
              </Button>
              <p className="text-xs text-muted-foreground">
                Applying replaces their current Optix role and linked account permissions. No email is sent.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
