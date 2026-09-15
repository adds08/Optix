"use client";
import type { EmploymentStatus } from "@optix/types";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityField } from "@/components/ui/entity-picker";
import { EntityFieldWithCreate } from "@/components/ui/entity-field-with-create";
import { humanizeRole, projectHint } from "@/lib/format";

export type EmployeeEditable = {
  id: string;
  name: string;
  role: string;
  roleId?: string | null;
  email?: string | null;
  phone?: string | null;
  externalId?: string | null;
  employmentStatus?: string | null;
  reportsToEmployeeId?: string | null;
};

/* Primary project is create-only: moving somebody to a job is
   `assignToProject`, which closes their posting and takes their tools with
   them. Editing the column alone would change the answer without any of it. */
type Props = { open: boolean; onClose: () => void; edit?: EmployeeEditable };

/*
  The legacy `employee.role` enum, kept in step where the new role register has
  an equivalent name.

  It is still written because the import spec and a handful of unmigrated
  readers use it, and because dropping a NOT NULL column in the same change that
  backfills its replacement leaves no way back. `crew` and any role somebody
  invents on the Roles screen have no legacy equivalent, so those keep whatever
  the row already had — which means nothing, and is why nothing new should read
  this column. `employee.roleId` is the answer.
*/
const LEGACY_ROLE_NAMES = new Set([
  "foreman", "superintendent", "equipment_admin", "warehouse",
  "mechanic", "procurement", "hr", "finance",
]);

function legacyRoleFor(roleName: string | undefined, fallback: string) {
  if (!roleName) return fallback;
  if (roleName === "project_manager") return "pm";
  return LEGACY_ROLE_NAMES.has(roleName) ? roleName : fallback;
}

export function EmployeeForm({ open, onClose, edit }: Props) {
  const utils = trpc.useUtils();
  const hr = trpc.employee.hrDetails.useQuery({ employeeId: edit?.id ?? "" }, { enabled: !!edit });
  const projects = trpc.project.list.useQuery();
  const roleOptions = trpc.role.options.useQuery();
  const allEmployees = trpc.employee.list.useQuery();
  /* STI-307 — DOMAIN DATA. `e.role` is the employee register's answer to "what
     kind of worker is this", so filtering the superintendent picker by it is a
     fact about people, not a statement about the caller's authority. Kept, as
     STI-307 AC 3 prescribes. The caller's authority to open this form at all
     is `employee.manage`. */
  const superintendents = allEmployees.data?.filter((e) => e.role === "superintendent") ?? [];

  const [name, setName] = useState(edit?.name ?? "");
  const [externalId, setExternalId] = useState(edit?.externalId ?? "");
  const [roleId, setRoleId] = useState(edit?.roleId ?? "");
  const [email, setEmail] = useState(edit?.email ?? "");
  const [phone, setPhone] = useState(edit?.phone ?? "");
  const [primaryProjectId, setPrimaryProjectId] = useState("");
  const [reportsToEmployeeId, setReportsToEmployeeId] = useState(edit?.reportsToEmployeeId ?? "");
  /* Typed for the same reason as location-form's `type`: the procedure now
     takes `z.enum(EMPLOYMENT_STATUSES)`. */
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>(
    (edit?.employmentStatus as EmploymentStatus) ?? "active",
  );
  const jobTitles = trpc.role.jobTitles.useQuery();
  const [companyRoleId, setCompanyRoleId] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newTitleRoleId, setNewTitleRoleId] = useState("");
  const crewRoleId = (roleOptions.data ?? []).find((r) => r.name === "crew")?.id ?? "";
  /* What the chosen title grants, shown read-only. Not state: it is a lookup,
     and holding it separately is how a field ends up displaying one value and
     saving another. */
  const derivedRole = (() => {
    const title = (jobTitles.data ?? []).find((t) => t.id === companyRoleId);
    if (!title?.defaultRoleId) return null;
    return (roleOptions.data ?? []).find((r) => r.id === title.defaultRoleId) ?? null;
  })();
  const chosen = (roleOptions.data ?? []).find((r) => r.id === roleId);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!name) return;
    setSubmitting(true);
    setResult("");
    try {
      if (edit) {
        await utils.client.employee.update.mutate({
          id: edit.id, name, roleId: roleId || null, role: legacyRoleFor(chosen?.name, edit.role),
          externalId: externalId || null,
          email: email || null,
          phone: phone || null,
          employmentStatus,
          reportsToEmployeeId: reportsToEmployeeId || null,
        });
        utils.employee.get.invalidate({ id: edit.id });
      } else {
        await utils.client.employee.create.mutate({
          name, externalId: externalId || undefined,
          companyRoleId: companyRoleId || undefined,
          role: legacyRoleFor(derivedRole?.name, "foreman"),
          email: email || undefined, phone: phone || undefined,
          primaryProjectId: primaryProjectId || undefined,
          reportsToEmployeeId: reportsToEmployeeId || undefined,
        });
      }
      utils.employee.list.invalidate();
      onClose();
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Could not save. Try again.");
    }
    setSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{edit ? `Edit ${edit.name}` : "New Employee"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              {/* The HR-issued number, not this system's `id`. "External ID"
                  told the person typing it nothing about which of their
                  several ids was wanted; "Employee ID" read as this system's
                  own uuid to anyone used to that column elsewhere in the
                  register. "Code" matches the convention used for the same
                  kind of field on tools and projects. */}
              <label className="text-sm font-medium">Employee Code</label>
              <Input disabled={!!hr.data?.bamboo} value={externalId} onChange={(e) => setExternalId(e.target.value)} />
              <p className="text-xs text-muted-foreground">As issued by HR — the number on the badge.</p>
            </div>
            <div className="space-y-2">
              {/* The role register, not a hard-coded five. This list used to name
                  five of the thirteen roles that exist, so a person could not be
                  made an office administrator from the only screen that creates
                  people. It reads `role.options` — gated on `employee.manage`
                  rather than `config.manage`, because choosing somebody's role
                  is not the same authority as changing what a role may do. */}
              {/* "Access Role", not bare "Role" — matches the People table
                  column and the Access Roles settings screen this list comes
                  from, and distinguishes it from Job Title below on the
                  person's own detail page. */}
              <label className="text-sm font-medium">Job Title</label>
              <EntityFieldWithCreate
                value={companyRoleId}
                onChange={setCompanyRoleId}
                placeholder="Choose a job title…"
                searchPlaceholder="Search job titles…"
                emptyLabel="No job title matches."
                createLabel="+ Create a new job title…"
                dialogTitle="New job title"
                dialogDescription="Everybody given this title gets the access role you choose here."
                onOpenCreate={() => { setNewTitle(""); setNewTitleRoleId(""); }}
                canSave={!!newTitle.trim()}
                onCreate={async () => {
                  const made = await utils.client.role.createJobTitle.mutate({
                    name: newTitle.trim(),
                    roleId: newTitleRoleId || crewRoleId || null,
                  });
                  await utils.role.jobTitles.invalidate();
                  return made.id;
                }}
                options={(jobTitles.data ?? []).map((t) => ({
                  value: t.id,
                  label: t.name,
                  hint: t.defaultRoleName ? humanizeRole(t.defaultRoleName) : "Crew",
                }))}
              >
                <div className="space-y-2">
                  <label className="text-sm font-medium">Title</label>
                  <Input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Pipe Foreman" />
                </div>
                <div className="space-y-2">
                  {/* The ONE moment a role is chosen. A title that already
                      exists carries its own answer; a new one has none until
                      somebody gives it one, and everybody who holds the title
                      afterwards inherits it. Roles are picked from the
                      register, never invented here. */}
                  <label className="text-sm font-medium">Access Role</label>
                  <EntityField
                    value={newTitleRoleId || crewRoleId}
                    onChange={setNewTitleRoleId}
                    placeholder="Choose a role…"
                    searchPlaceholder="Search roles…"
                    emptyLabel="No role matches."
                    options={(roleOptions.data ?? []).map((r) => ({ value: r.id, label: humanizeRole(r.name) }))}
                  />
                  <p className="text-xs text-muted-foreground">Defaults to Crew, which grants nothing.</p>
                </div>
              </EntityFieldWithCreate>
              {/* Read-only: the title decides. Changing what a title grants is
                  Settings → Job Titles, not a per-person override. */}
              <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                {derivedRole ? humanizeRole(derivedRole.name) : "Crew"}
              </div>
              <p className="text-xs text-muted-foreground">
                {companyRoleId
                  ? "Access role, set by this job title. Change it on Settings → Job Titles."
                  : "No job title yet, so they get Crew — no permissions."}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          {edit ? (
            <div className="space-y-2">
              <label className="text-sm font-medium">Status</label>
              <EntityField
                value={employmentStatus}
                onChange={(v) => setEmploymentStatus(v as EmploymentStatus)}
                placeholder="Employment status"
                options={[
                  { value: "active", label: "Active" },
                  { value: "inactive", label: "Inactive" },
                  { value: "on_leave", label: "On leave" },
                  { value: "terminated", label: "Terminated" },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Inactive disables their login and keeps their assignments and history. To restore
                access, set Active here and use Reactivate login in the People menu.
              </p>
            </div>
          ) : null}
          <div className={edit ? "hidden" : "space-y-2"}>
            <label className="text-sm font-medium">Primary project</label>
            <EntityField
              value={primaryProjectId}
              onChange={setPrimaryProjectId}
              placeholder="Select..."
              searchPlaceholder="Project name or code"
              emptyLabel="No job matches."
              options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name, hint: projectHint(p) }))}
            />
          </div>
          {/* DOMAIN DATA again — the role of the person being edited, not of the
              signed-in user. Only a foreman reports to a superintendent, so
              only a foreman gets the field.

              Still keyed on the role NAME rather than on a flag, deliberately:
              "reports to a superintendent" is a fact about foremen specifically,
              not about holding custody (a mechanic does neither) or about the
              field layout. Inventing a flag for one form would be a worse lie
              than a name check that is honest about being one. */}
          {chosen?.name === "foreman" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Reports to (superintendent)</label>
              <EntityField
                value={reportsToEmployeeId}
                onChange={setReportsToEmployeeId}
                placeholder="None"
                searchPlaceholder="Name or employee number"
                emptyLabel="Nobody matches."
                options={superintendents.map((s) => ({ value: s.id, label: s.name, hint: s.externalId ?? undefined }))}
              />
            </div>
          )}
          {result && <p className="text-sm text-destructive">{result}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !name}>{submitting ? "..." : edit ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
