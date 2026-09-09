"use client";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/components/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorNote } from "@/components/sti/page";
export function EmployeeHrDetails({ employeeId }: { employeeId: string }) {
  const { has } = usePermissions();
  const utils = trpc.useUtils();
  const query = trpc.employee.hrDetails.useQuery({ employeeId });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ jobTitle: "", department: "", division: "", code: "" });
  useEffect(() => { if (query.data && !editing) setDraft({ jobTitle: query.data.jobTitle ?? "", department: query.data.department ?? "", division: query.data.division ?? "", code: query.data.code ?? "" }); }, [query.data, editing]);
  const save = trpc.employee.setHrDetails.useMutation({ onSuccess: async () => { await Promise.all([query.refetch(), utils.employee.list.invalidate()]); setEditing(false); } });
  if (query.error) return <ErrorNote message={query.error.message} />;
  return <section className="space-y-3 rounded-lg border bg-card p-4"><div className="flex justify-between gap-3"><h2 className="font-semibold">Employment details</h2>{has("employee.manage") && !query.data?.bamboo && <Button size="sm" variant="outline" onClick={() => setEditing(v => !v)}>{editing ? "Cancel" : "Edit details"}</Button>}</div><div className="grid gap-3 text-sm sm:grid-cols-2">{([['code', 'Employee number'], ['jobTitle', 'Job title'], ['department', 'Department'], ['division', 'Division']] as const).map(([key,label]) => <label key={key} className="space-y-1"><span className="block text-muted-foreground">{label}</span>{editing ? <Input value={draft[key]} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} /> : <span>{query.data?.[key] || "Not recorded"}</span>}</label>)}</div>{query.data?.bamboo && <p className="text-xs text-muted-foreground">Maintained in BambooHR · ID {query.data.bamboo.externalId} · Last synced {query.data.bamboo.lastSyncedAt ? new Date(query.data.bamboo.lastSyncedAt).toLocaleString() : "not recorded"}. Ask HR to correct these details.</p>}{editing && <Button disabled={save.isPending} onClick={() => save.mutate({ employeeId, ...draft })}>Save employment details</Button>}{save.error && <ErrorNote message={save.error.message} />}</section>;
}
