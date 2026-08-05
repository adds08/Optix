"use client";

import { useMemo, useState } from "react";
import { FolderKanban, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNote, TableSkeleton } from "@/components/sti/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
  Job Groups — the equipment desk's buckets.

  Create a group, pick which jobs are in it, and hand it to the users
  (superintendents, PMs) who should only ever see those jobs. The sidebar job
  selector is built from exactly this: a user with a group assignment is
  scoped to the jobs in it, everywhere in the app.
*/

export default function JobGroupsPage() {
  const utils = trpc.useUtils();
  const groups = trpc.projectGroup.list.useQuery();
  const projects = trpc.project.list.useQuery();
  const users = trpc.projectGroup.userOptions.useQuery();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { projectIds: Set<string>; userIds: Set<string> }>>({});

  const draftFor = (id: string) =>
    drafts[id] ?? { projectIds: new Set<string>(), userIds: new Set<string>() };

  const invalidate = () => {
    utils.projectGroup.list.invalidate();
    utils.projectGroup.mine.invalidate();
  };

  const create = trpc.projectGroup.create.useMutation({
    onSuccess: () => {
      setName("");
      setDescription("");
      invalidate();
    },
  });
  const remove = trpc.projectGroup.delete.useMutation({ onSuccess: invalidate });
  const setProjects = trpc.projectGroup.setProjects.useMutation({ onSuccess: invalidate });
  const setUsers = trpc.projectGroup.setUsers.useMutation({ onSuccess: invalidate });

  const rows = groups.data ?? [];

  /* Saved membership per group, keyed for fast dirty checks. */
  const savedByGroup = useMemo(
    () =>
      new Map(
        rows.map((g) => [
          g.id,
          {
            projects: new Set(g.projects.map((p) => p.id)),
            users: new Set(g.users.map((u) => u.id)),
          },
        ]),
      ),
    [rows],
  );

  const toggle = (id: string, kind: "projectIds" | "userIds", value: string) => {
    setDrafts((prev) => {
      const base = draftFor(id);
      const next = new Set(base[kind]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [id]: { ...base, [kind]: next } };
    });
  };

  const save = async (id: string) => {
    const d = draftFor(id);
    await setProjects.mutateAsync({ id, projectIds: [...d.projectIds] });
    await setUsers.mutateAsync({ id, userIds: [...d.userIds] });
  };

  const loading = groups.isLoading || projects.isLoading || users.isLoading;

  return (
    <div className="flex flex-col gap-4">
      {/* Create */}
      <section className="flex flex-col gap-3 rounded-md border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FolderKanban className="size-4 text-muted-foreground" aria-hidden />
          New job group
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name — e.g. Dallas towers"
            className="max-w-xs"
            aria-label="Group name"
          />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="max-w-sm flex-1"
            aria-label="Group description"
          />
          <Button
            size="sm"
            onClick={() => create.mutate({ name, description: description || undefined })}
            disabled={create.isPending || !name.trim()}
          >
            Create
          </Button>
        </div>
      </section>

      {/* Existing groups */}
      {loading ? (
        <TableSkeleton cols={3} />
      ) : groups.isError ? (
        <ErrorNote message="Job groups could not be loaded." />
      ) : !rows.length ? (
        <EmptyState
          icon={FolderKanban}
          title="No job groups yet"
          description="Create one above, then put jobs in it and hand it to the users who should only see those jobs."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((g) => {
            const d = draftFor(g.id);
            const saved = savedByGroup.get(g.id)!;
            const projectChanged = saved.projects.size !== d.projectIds.size;
            const userChanged = saved.users.size !== d.userIds.size;
            const dirty = projectChanged || userChanged;
            return (
              <section key={g.id} className="rounded-md border bg-card">
                <div className="flex items-center gap-2 border-b px-4 py-2.5">
                  <FolderKanban className="size-4 text-muted-foreground" aria-hidden />
                  <h3 className="text-sm font-semibold">{g.name}</h3>
                  {g.description ? (
                    <span className="truncate text-xs text-muted-foreground">{g.description}</span>
                  ) : null}
                  <span className="tnum text-xs text-muted-foreground">
                    {g.projects.length} jobs · {g.users.length} users
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" onClick={() => save(g.id)} disabled={!dirty}>
                      Save
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${g.name}`}
                      onClick={() => remove.mutate({ id: g.id })}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 p-4 lg:grid-cols-2">
                  {/* Jobs */}
                  <div>
                    <p className="label-xs mb-1.5">Jobs in this group</p>
                    <div className="max-h-56 overflow-y-auto rounded-md border">
                      {(projects.data ?? []).map((p) => {
                        const checked = d.projectIds.has(p.id);
                        return (
                          <label
                            key={p.id}
                            className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0 hover:bg-muted/40"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(g.id, "projectIds", p.id)}
                              className="size-4 accent-primary"
                            />
                            <span className="min-w-0 truncate">{p.name}</span>
                            {p.externalId ? (
                              <span className="ml-auto text-xs text-muted-foreground">{p.externalId}</span>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Users */}
                  <div>
                    <p className="label-xs mb-1.5">Who can see it</p>
                    <div className="max-h-56 overflow-y-auto rounded-md border">
                      {(users.data ?? []).map((u) => (
                        <label
                          key={u.id}
                          className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0 hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            checked={d.userIds.has(u.id)}
                            onChange={() => toggle(g.id, "userIds", u.id)}
                            className="size-4 accent-primary"
                          />
                          <span className="min-w-0 truncate">{u.name || u.email}</span>
                          {u.name ? (
                            <span className="ml-auto text-xs text-muted-foreground">{u.email}</span>
                          ) : null}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
