"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderKanban, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { idName } from "@/lib/format";

/*
  Create or edit a job group — the modal behind "Create new group" in the job
  selector and "Modify group" on the Job Groups page.

  Both lists are searchable and report how many are picked, because a desk with
  fifty jobs cannot verify a selection by scrolling a checkbox column. Search
  filters what is shown; it never touches the selection, so filtering to find
  one more job does not silently drop the twelve already ticked.
*/

export type JobGroupEditable = {
  id: string;
  name: string;
  description: string | null;
  projectIds: string[];
  userIds: string[];
};

export function JobGroupModal({
  open,
  onClose,
  edit,
}: {
  open: boolean;
  onClose: () => void;
  edit?: JobGroupEditable | null;
}) {
  const utils = trpc.useUtils();
  const projects = trpc.project.list.useQuery(undefined, { enabled: open });
  const users = trpc.projectGroup.userOptions.useQuery(undefined, { enabled: open });

  const [name, setName] = useState(edit?.name ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set(edit?.projectIds ?? []));
  const [userIds, setUserIds] = useState<Set<string>>(new Set(edit?.userIds ?? []));
  const [jobQuery, setJobQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  useEffect(() => {
    setName(edit?.name ?? "");
    setDescription(edit?.description ?? "");
    setProjectIds(new Set(edit?.projectIds ?? []));
    setUserIds(new Set(edit?.userIds ?? []));
    setJobQuery("");
    setUserQuery("");
    setResult("");
  }, [edit, open]);

  const allProjects = projects.data ?? [];
  const allUsers = users.data ?? [];

  const shownProjects = useMemo(() => {
    const q = jobQuery.trim().toLowerCase();
    if (!q) return allProjects;
    return allProjects.filter((p) => `${p.externalId ?? ""} ${p.name}`.toLowerCase().includes(q));
  }, [allProjects, jobQuery]);

  const shownUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return allUsers;
    return allUsers.filter((u) => `${u.name ?? ""} ${u.email}`.toLowerCase().includes(q));
  }, [allUsers, userQuery]);

  const invalidate = () => {
    utils.projectGroup.list.invalidate();
    utils.projectGroup.mine.invalidate();
  };

  const remove = trpc.projectGroup.delete.useMutation({
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setResult("");
    try {
      if (edit) {
        await utils.client.projectGroup.update.mutate({
          id: edit.id,
          name: name.trim(),
          description: description || null,
        });
        await utils.client.projectGroup.setProjects.mutate({ id: edit.id, projectIds: [...projectIds] });
        await utils.client.projectGroup.setUsers.mutate({ id: edit.id, userIds: [...userIds] });
      } else {
        await utils.client.projectGroup.create.mutate({
          name: name.trim(),
          description: description || undefined,
          projectIds: [...projectIds],
          userIds: [...userIds],
        });
      }
      invalidate();
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
          <DialogTitle className="flex items-center gap-2">
            <FolderKanban className="size-4 text-muted-foreground" aria-hidden />
            {edit ? `Modify ${edit.name}` : "New job group"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dallas towers" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>

          {/* Jobs */}
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <label className="flex-1 text-sm font-medium">Jobs in this group</label>
              <span className="tnum text-xs text-muted-foreground">
                {projectIds.size} of {allProjects.length} selected
              </span>
            </div>
            <div className="overflow-hidden rounded-md border">
              <div className="flex h-9 items-center gap-2 border-b px-3">
                <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <Input
                  value={jobQuery}
                  onChange={(e) => setJobQuery(e.target.value)}
                  placeholder="Search jobs…"
                  className="h-auto border-0 p-0 shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="max-h-52 overflow-y-auto">
                {shownProjects.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No jobs match “{jobQuery}”.</p>
                ) : (
                  shownProjects.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0 hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        checked={projectIds.has(p.id)}
                        onChange={() => setProjectIds((s) => toggle(s, p.id))}
                        className="size-4 accent-primary"
                      />
                      <span className="min-w-0 truncate">{idName(p.externalId, p.name)}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Users */}
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <label className="flex-1 text-sm font-medium">Who can see it</label>
              <span className="tnum text-xs text-muted-foreground">{userIds.size} selected</span>
            </div>
            <div className="overflow-hidden rounded-md border">
              <div className="flex h-9 items-center gap-2 border-b px-3">
                <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <Input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Search people…"
                  className="h-auto border-0 p-0 shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="max-h-40 overflow-y-auto">
                {shownUsers.map((u) => (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0 hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={userIds.has(u.id)}
                      onChange={() => setUserIds((s) => toggle(s, u.id))}
                      className="size-4 accent-primary"
                    />
                    <span className="min-w-0 truncate">{u.name || u.email}</span>
                    {u.name ? <span className="ml-auto text-xs text-muted-foreground">{u.email}</span> : null}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {result ? <p className="text-sm text-destructive">{result}</p> : null}
        </div>

        <DialogFooter>
          {edit ? (
            <Button
              variant="outline"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={() => remove.mutate({ id: edit.id })}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete group"}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !name.trim()}>
            {submitting ? "Saving…" : edit ? "Save changes" : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
