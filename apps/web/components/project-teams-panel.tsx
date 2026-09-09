"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { branchEmployeeIds, removalBranch } from "@stinventory/domain/project-branch";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EntityField } from "@/components/ui/entity-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { toast } from "sonner";

export function ProjectTeamsPanel({ onboarding = false, onlyMine = false }: { onboarding?: boolean; onlyMine?: boolean }) {
  const utils = trpc.useUtils();
  const query = trpc.projectTeams.workspace.useQuery();
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"person" | "branch" | "reporting" | "remove" | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [tier, setTier] = useState("");
  const [parentId, setParentId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [reason, setReason] = useState("");
  const [moveTools, setMoveTools] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const projects = query.data?.projects ?? [];
  const project = projects.find(p => p.id === projectId);
  useEffect(() => { if (!projectId && projects.length) { const requested = new URLSearchParams(window.location.search).get("projectId"); setProjectId(projects.some(p => p.id === requested) ? requested! : projects[0]!.id); } }, [query.data, projectId]);
  const visible = useMemo(() => {
    if (!project) return [];
    let members = project.members;
    if (onlyMine && query.data?.viewerEmployeeId && !query.data.isDesk) {
      const ids = branchEmployeeIds(members, project.id, query.data.viewerEmployeeId);
      members = members.filter(m => ids.has(m.employeeId));
    }
    const sorted: { member: typeof members[number]; depth: number }[] = [];
    const seen = new Set<string>();
    const walk = (parent: string | null, depth: number) => {
      for (const m of members.filter(m => m.reportsToEmployeeId === parent).sort((a,b) => a.name.localeCompare(b.name))) {
        if (seen.has(m.id)) continue;
        seen.add(m.id); sorted.push({ member: m, depth }); walk(m.employeeId, depth + 1);
      }
    };
    walk(null, 0);
    for (const m of members) if (!seen.has(m.id)) { seen.add(m.id); sorted.push({ member: m, depth: 0 }); walk(m.employeeId, 1); }
    return sorted.filter(({ member: m }) => `${m.name} ${m.label}`.toLowerCase().includes(search.toLowerCase()));
  }, [project, search, onlyMine, query.data]);
  const source = projects.find(p => p.id === sourceId);
  const selectedBranch = source && employeeId ? source.members.filter(m => branchEmployeeIds(source.members, source.id, employeeId).has(m.employeeId)) : [];
  const removal = project && employeeId ? removalBranch(project.members, project.id, employeeId).members : [];
  const open = (next: typeof mode) => { setMode(next); setEmployeeId(""); setTier(""); setSourceId(""); setMemberId(""); setParentId(query.data?.isDesk ? "" : query.data?.viewerEmployeeId ?? ""); setError(""); setReason(""); setMoveTools(true); };
  const refresh = async () => { await Promise.all([query.refetch(), utils.projectTeam.invalidate(), utils.onboarding.invalidate(), utils.project.list.invalidate(), utils.asset.list.invalidate()]); };
  const submit = async () => {
    if (!project || !mode) return;
    setBusy(true); setError("");
    try {
      if (mode === "person") await utils.client.projectTeam.assign.mutate({ projectId, employeeId, role: tier, reportsToEmployeeId: parentId || null, moveTools, source: "manual_entry" });
      if (mode === "branch") await utils.client.projectTeams.assignBranch.mutate({ projectId, sourceProjectId: sourceId, employeeId, reportsToEmployeeId: parentId || null, moveTools });
      if (mode === "reporting") await utils.client.projectTeam.setReportsTo.mutate({ id: memberId, reportsToEmployeeId: parentId || null });
      if (mode === "remove") await utils.client.projectTeams.removeBranch.mutate({ projectId, employeeId, reason });
      await refresh(); setMode(null); toast.success("Project team updated");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this team."); }
    finally { setBusy(false); }
  };
  if (query.isLoading) return <TableSkeleton />;
  if (query.error) return <ErrorNote message={query.error.message} />;
  return <div className="space-y-5">
    {!onboarding && <div><h1 className="text-2xl font-semibold">{onlyMine ? "My Crew" : "Project Teams"}</h1><p className="mt-1 text-sm text-muted-foreground">The full reporting branch, from project leadership to the people doing the work. Changes here also appear in onboarding.</p></div>}
    {!projects.length ? <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No project team is assigned yet. Your administrator or manager can connect your team. You can finish your personal setup while they arrange it.</p> : <>
      <div className="grid gap-3 sm:grid-cols-2"><EntityField value={projectId} onChange={setProjectId} options={projects.map(p => ({ value: p.id, label: p.name, hint: p.code ?? undefined }))} placeholder="Choose project" searchPlaceholder="Search projects" emptyLabel="No projects" /><Input aria-label="Search team" placeholder="Search team by name or tier…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      {project && <section className="overflow-hidden rounded-lg border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 p-4"><div><h2 className="font-semibold">{project.code ? `${project.code} · ` : ""}{project.name}</h2><p className="text-sm text-muted-foreground">{project.members.length} team members</p></div><div className="flex flex-wrap gap-2">{!onboarding && <Button asChild size="sm" variant="outline"><Link href="/jobsites">View tools</Link></Button>}{project.assignable.length > 0 && <><Button size="sm" variant="outline" onClick={() => open("branch")}>Add existing branch</Button><Button size="sm" onClick={() => open("person")}>Add person</Button></>}</div></header>
        {!visible.length ? <p className="p-6 text-sm text-muted-foreground">{search ? "No matching team members." : "No team recorded yet. Add a person or an existing reporting branch."}</p> : <ul className="divide-y">{visible.map(({ member: m, depth }) => <li key={m.id} className="flex flex-col items-stretch gap-3 p-3 sm:flex-row sm:items-center sm:p-4"><div className="min-w-0 sm:flex-1 border-l-2 border-primary/20 pl-3" style={{ marginLeft: `${Math.min(depth, 4) * 14}px` }}><Link href={`/people/${m.employeeId}`} className="font-medium hover:underline">{m.name}</Link><p className="text-sm text-muted-foreground">{m.label}</p><p className="text-xs text-muted-foreground">{m.reportsToEmployeeId ? `Reports to ${query.data?.people.find(p => p.id === m.reportsToEmployeeId)?.name ?? "recorded manager"}` : "Reporting manager not recorded"}</p></div>{m.canManage && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { open("reporting"); setMemberId(m.id); setEmployeeId(m.employeeId); setParentId(m.reportsToEmployeeId ?? ""); }}>Change manager</Button><Button size="sm" variant="ghost" onClick={() => { open("remove"); setEmployeeId(m.employeeId); }}>Remove branch</Button></div>}</li>)}</ul>}
      </section>}
    </>}
    <Dialog open={!!mode} onOpenChange={open => { if (!open && !busy) setMode(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{mode === "person" ? "Add a person" : mode === "branch" ? "Add an existing branch" : mode === "reporting" ? "Change reporting manager" : "Remove branch access"}</DialogTitle></DialogHeader>
      {mode === "branch" && <label className="space-y-2 text-sm">From project<EntityField value={sourceId} onChange={id => { setSourceId(id); setEmployeeId(""); }} options={projects.filter(p => p.id !== projectId).map(p => ({ value: p.id, label: p.name }))} placeholder="Choose source project" searchPlaceholder="Find project" emptyLabel="No other projects" /></label>}
      {(mode === "person" || mode === "branch") && <label className="space-y-2 text-sm">{mode === "branch" ? "Top of the branch" : "Person"}<EntityField value={employeeId} onChange={setEmployeeId} options={mode === "branch" ? (source?.members ?? []).filter(m => m.canManage).map(m => ({ value: m.employeeId, label: `${m.name} · ${m.label}` })) : (query.data?.people ?? []).map(p => ({ value: p.id, label: p.name }))} placeholder="Select person" searchPlaceholder="Search people" emptyLabel="No eligible people" /></label>}
      {mode === "person" && <label className="space-y-2 text-sm">Tier on this project<EntityField value={tier} onChange={setTier} options={(query.data?.tiers ?? []).filter(t => project?.assignable.includes(t.name)).map(t => ({ value: t.name, label: t.label }))} placeholder="Choose tier" searchPlaceholder="Search tiers" emptyLabel="No assignment grants" /></label>}
      {mode !== "remove" && <label className="space-y-2 text-sm">Reports to<EntityField value={parentId} onChange={setParentId} options={[...(query.data?.isDesk ? [{ value: "", label: "Not recorded yet" }] : []), ...(query.data?.people ?? []).filter(p => p.id !== employeeId && (query.data?.isDesk || p.id === query.data?.viewerEmployeeId || project?.members.some(m => m.employeeId === p.id && m.canManage))).map(p => ({ value: p.id, label: p.name }))]} placeholder="Choose reporting manager" searchPlaceholder="Search managers" emptyLabel="No manager found" /></label>}
      {mode === "branch" && selectedBranch.length > 0 && <div className="rounded-md bg-muted p-3 text-sm"><strong>Branch to add</strong><ul className="mt-2 space-y-1">{selectedBranch.map(m => <li key={m.id}>{m.name} · {m.label}</li>)}</ul></div>}
      {(mode === "branch" || mode === "person") && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={moveTools} onChange={e => setMoveTools(e.target.checked)} /><span>Move held tools with custody-holding members.<span className="block text-xs text-muted-foreground">When unchecked, directly held tools are released on their previous job. Custody-holding members move from their previous posting; other members can work on multiple projects.</span></span></label>}
      {mode === "remove" && <><p className="text-sm">Remove project access for this branch. Other projects and historical records remain. Outstanding tools must be returned or transferred first.</p><ul className="rounded-md bg-muted p-3 text-sm">{removal.map(m => <li key={m.id}>{m.name} · {m.label}</li>)}</ul><label className="space-y-2 text-sm">Reason<Input value={reason} onChange={e => setReason(e.target.value)} /></label></>}
      {error && <ErrorNote message={error} />}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setMode(null)}>Cancel</Button><Button disabled={busy || (mode === "remove" ? !reason.trim() : mode === "person" ? !employeeId || !tier : mode === "branch" ? !selectedBranch.length : !memberId)} onClick={submit}>{busy ? "Saving…" : mode === "remove" ? "Remove access" : "Save team"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
