"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityField } from "@/components/ui/entity-picker";

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

/* `office_admin` -> "Office Admin". The role register stores snake_case so the
   seed and the permission matrix can name rows; people should never see it. */
function humanizeRole(name: string) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function EmployeeForm({ open, onClose, edit }: Props) {
  const utils = trpc.useUtils();
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
  const [employmentStatus, setEmploymentStatus] = useState(edit?.employmentStatus ?? "active");
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
          roleId: roleId || undefined, role: legacyRoleFor(chosen?.name, "foreman"),
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
              <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} />
              <p className="text-xs text-muted-foreground">As issued by HR — the number on the badge.</p>
            </div>
            <div className="space-y-2">
              {/* The role register, not a hard-coded five. This list used to name
                  five of the thirteen roles that exist, so a person could not be
                  made an office administrator from the only screen that creates
                  people. It reads `role.options` — gated on `employee.manage`
                  rather than `config.manage`, because choosing somebody's role
                  is not the same authority as changing what a role may do. */}
              <label className="text-sm font-medium">Role</label>
              <EntityField
                value={roleId}
                onChange={setRoleId}
                placeholder="Choose a role…"
                searchPlaceholder="Search roles…"
                emptyLabel="No role matches."
                options={(roleOptions.data ?? []).map((r) => ({ value: r.id, label: humanizeRole(r.name) }))}
              />
              {chosen ? (
                <p className="text-xs text-muted-foreground">
                  {chosen.description}
                  {/* Said here rather than left to be discovered: this is what
                      decides whether the register expects this person to have a
                      login at all. */}
                  {chosen.needsLogin ? " Signs in." : " Does not sign in."}
                </p>
              ) : null}
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
                onChange={setEmploymentStatus}
                placeholder="Employment status"
                options={[
                  { value: "active", label: "Active" },
                  { value: "on_leave", label: "On leave" },
                  { value: "terminated", label: "Terminated" },
                ]}
              />
              <p className="text-xs text-muted-foreground">
                Terminating stamps the date. Anything they hold stays on their name until
                somebody moves it — nothing is blocked, and the ledger keeps the history.
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
              options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.externalId ?? undefined }))}
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
