"use client";

import { useEffect, useState } from "react";
import { FolderKanban } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { idName } from "@/lib/format";

/*
  Create or edit a job group — the modal behind the sidebar's "New group"
  button. Name and description up top; below, the jobs in the group and the
  users who can see it. The same shape the /job-groups page edits, so nothing
  here is a second opinion: `create` inserts with the assignments, `edit`
  replaces them.
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
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");

  useEffect(() => {
    setName(edit?.name ?? "");
    setDescription(edit?.description ?? "");
    setProjectIds(new Set(edit?.projectIds ?? []));
    setUserIds(new Set(edit?.userIds ?? []));
    setResult("");
  }, [edit, open]);

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
        await utils.client.projectGroup.update.mutate({ id: edit.id, name: name.trim(), description: description || null });
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
            {edit ? `Edit ${edit.name}` : "New job group"}
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
            <label className="text-sm font-medium">Jobs in this group</label>
            <div className="max-h-44 overflow-y-auto rounded-md border">
              {(projects.data ?? []).map((p) => (
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
              ))}
            </div>
          </div>

          {/* Users */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Who can see it</label>
            <div className="max-h-40 overflow-y-auto rounded-md border">
              {(users.data ?? []).map((u) => (
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
            {submitting ? "Saving…" : edit ? "Save" : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
