"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type EmployeeEditable = {
  id: string;
  name: string;
  role: string;
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

export function EmployeeForm({ open, onClose, edit }: Props) {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery();
  const allEmployees = trpc.employee.list.useQuery();
  const superintendents = allEmployees.data?.filter((e) => e.role === "superintendent") ?? [];

  const [name, setName] = useState(edit?.name ?? "");
  const [externalId, setExternalId] = useState(edit?.externalId ?? "");
  const [role, setRole] = useState(edit?.role ?? "foreman");
  const [email, setEmail] = useState(edit?.email ?? "");
  const [phone, setPhone] = useState(edit?.phone ?? "");
  const [primaryProjectId, setPrimaryProjectId] = useState("");
  const [reportsToEmployeeId, setReportsToEmployeeId] = useState(edit?.reportsToEmployeeId ?? "");
  const [employmentStatus, setEmploymentStatus] = useState(edit?.employmentStatus ?? "active");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  const submit = async () => {
    if (!name) return;
    setSubmitting(true);
    setResult("");
    try {
      if (edit) {
        await utils.client.employee.update.mutate({
          id: edit.id, name, role,
          externalId: externalId || null,
          email: email || null,
          phone: phone || null,
          employmentStatus,
          reportsToEmployeeId: reportsToEmployeeId || null,
        });
        utils.employee.get.invalidate({ id: edit.id });
      } else {
        await utils.client.employee.create.mutate({
          name, externalId: externalId || undefined, role,
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
              <label className="text-sm font-medium">External ID</label>
              <Input value={externalId} onChange={(e) => setExternalId(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                <option value="foreman">Foreman</option>
                <option value="superintendent">Superintendent</option>
                <option value="equipment_admin">Equipment Admin</option>
                <option value="warehouse">Warehouse</option>
              </select>
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
              <select value={employmentStatus} onChange={(e) => setEmploymentStatus(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                <option value="active">Active</option>
                <option value="on_leave">On leave</option>
                <option value="terminated">Terminated</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Terminating opens the HR clearance queue for anything they still hold.
              </p>
            </div>
          ) : null}
          <div className={edit ? "hidden" : "space-y-2"}>
            <label className="text-sm font-medium">Primary project</label>
            <select value={primaryProjectId} onChange={(e) => setPrimaryProjectId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
              <option value="">Select...</option>
              {projects.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {role === "foreman" && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Reports to (superintendent)</label>
              <select value={reportsToEmployeeId} onChange={(e) => setReportsToEmployeeId(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                <option value="">None</option>
                {superintendents.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
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
