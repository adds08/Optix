"use client";

import { useMemo, useState } from "react";
import { FolderKanban, Pencil, Plus, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNote, TableSkeleton } from "@/components/sti/page";
import { JobGroupModal, type JobGroupEditable } from "@/components/job-group-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { idName } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
  Job Groups — the equipment desk's buckets.

  Two panes, not three: the group list, and the selected group's jobs. A
  read-only "all projects" column was the third pane and it earned nothing —
  the detail pane already lists every job with a tick, and at 1000-1100px the
  third column was what got pushed off screen.

  Ticking a job in the detail pane writes immediately (setProjects); the pencil
  opens the same modal the selector uses, for the name, description and the
  users who can see the group.
*/

export default function JobGroupsPage() {
  const utils = trpc.useUtils();
  const groups = trpc.projectGroup.list.useQuery();
  const projects = trpc.project.list.useQuery();

  const [selected, setSelected] = useState<string | null>(null);
  const [jobQuery, setJobQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<JobGroupEditable | null>(null);

  const invalidate = () => {
    utils.projectGroup.list.invalidate();
    utils.projectGroup.mine.invalidate();
  };
  const setProjects = trpc.projectGroup.setProjects.useMutation({ onSuccess: invalidate });

  const rows = groups.data ?? [];
  const group = rows.find((g) => g.id === selected) ?? null;
  const allProjects = projects.data ?? [];

  const shown = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    if (!q) return allProjects;
    return allProjects.filter((p) => `${p.externalId ?? ""} ${p.name}`.toLowerCase().includes(q));
  }, [allProjects, jobQuery]);

  /* One tick = one write. The membership lives on the server, so the pane never
     holds a half-saved draft the user has to remember to commit. */
  const toggleJob = (projectId: string) => {
    if (!group) return;
    const has = group.projects.some((p) => p.id === projectId);
    const next = has
      ? group.projects.filter((p) => p.id !== projectId).map((p) => p.id)
      : [...group.projects.map((p) => p.id), projectId];
    setProjects.mutate({ id: group.id, projectIds: next });
  };

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = () => {
    if (!group) return;
    setEditing({
      id: group.id,
      name: group.name,
      description: group.description,
      projectIds: group.projects.map((p) => p.id),
      userIds: group.users.map((u) => u.id),
    });
    setModalOpen(true);
  };

  if (groups.isLoading || projects.isLoading) return <TableSkeleton cols={2} />;
  if (groups.isError) return <ErrorNote message="Job groups could not be loaded." />;

  return (
    <div className="flex flex-col gap-4">
      <JobGroupModal open={modalOpen} onClose={() => setModalOpen(false)} edit={editing} />

      <div className="flex flex-wrap items-stretch gap-4">
        {/* ---- the groups ---- */}
        <section className="flex h-105 min-w-60 flex-1 basis-65 flex-col overflow-hidden rounded-md border bg-card">
          <header className="flex items-center gap-2 border-b px-4 py-2.5">
            <h2 className="flex-1 text-sm font-semibold">Job groups</h2>
            <Button size="sm" variant="ghost" className="text-primary" onClick={openNew}>
              <Plus className="size-3.5" aria-hidden />
              New group
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto">
            {rows.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No job groups yet"
                description="Create one, then put jobs in it and hand it to the users who should only see those jobs."
              />
            ) : (
              rows.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelected(g.id)}
                  className={cn(
                    "flex w-full items-center gap-2 border-b px-4 py-2.5 text-left text-sm hover:bg-muted/40",
                    selected === g.id && "bg-accent text-accent-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                  <span className="tnum text-xs text-muted-foreground">
                    {g.projects.length} jobs · {g.users.length} users
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        {/* ---- the selected group's jobs ---- */}
        <section className="flex h-105 min-w-70 flex-[2] basis-85 flex-col overflow-hidden rounded-md border bg-card">
          {!group ? (
            <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
              Select a group to view and edit its jobs.
            </div>
          ) : (
            <>
              <header className="flex items-center gap-2 border-b px-4 py-2.5">
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Jobs in {group.name}</h2>
                <Button size="sm" variant="outline" onClick={openEdit}>
                  <Pencil className="size-3.5" aria-hidden />
                  Modify group
                </Button>
              </header>
              <div className="flex h-9 shrink-0 items-center gap-2 border-b px-4">
                <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <Input
                  value={jobQuery}
                  onChange={(e) => setJobQuery(e.target.value)}
                  placeholder="Search jobs to add or remove…"
                  className="h-auto border-0 p-0 shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                {shown.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-3 border-b px-4 py-2 text-sm last:border-0 hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={group.projects.some((x) => x.id === p.id)}
                      onChange={() => toggleJob(p.id)}
                      className="size-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1 truncate">{idName(p.externalId, p.name)}</span>
                  </label>
                ))}
                {shown.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No jobs match “{jobQuery}”.</p>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
