"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Info, ShieldAlert, Trash2, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNote, TableSkeleton } from "@/components/sti/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/*
  Roles & Permissions — what each role may do.

  Why this screen exists. `docs/workings/PERMISSION_MATRIX.md` was written for
  Urban to sign off and never came back, so Phase 3 shipped on the defaults the
  document itself says apply in silence — six decisions in code that the
  customer had never seen, each cheap to reverse before release and a migration
  afterwards. Rather than wait for a meeting, this hands the decision back:
  Urban reads what the roles actually hold and changes what they disagree with,
  with no developer and no deploy.

  Two things it deliberately does NOT offer.

  **Inventing permissions.** A permission is only real because a procedure
  names it — `requirePermission("asset.read")`. One typed in here would gate
  nothing: a checkbox that grants a feeling. The list is fixed by the code and
  this screen renders it.

  **Deleting a built-in role.** The seed recreates it on the next reset. The
  supported way to retire one is to untick everything, which leaves the
  accounts on it able to sign in and do nothing — visible, unlike a role that
  silently vanished.

  Changes take effect on each user's next request. `resolveSession` reads the
  grants fresh rather than caching them into the session, so a mistake is
  undone as fast as it was made.
*/

export default function AdminRolesPage() {
  const utils = trpc.useUtils();
  /* Straight from `identity.me`, not `usePermissions`, because this page needs
     the LOADING state as well as the answer — a yes/no helper reports "no" on
     first paint and the screen flashes "no access" at the person who has it. */
  const me = trpc.identity.me.useQuery();
  const mayManage = (me.data?.permissions ?? []).includes("config.manage");

  const roles = trpc.role.list.useQuery(undefined, { enabled: mayManage });
  const catalogue = trpc.role.catalogue.useQuery(undefined, { enabled: mayManage });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [copyFrom, setCopyFrom] = useState("");

  const selected = roles.data?.find((r) => r.id === selectedId) ?? null;

  /* Default to the first role so the page never opens on an empty panel. */
  useEffect(() => {
    if (!selectedId && roles.data?.length) setSelectedId(roles.data[0]!.id);
  }, [roles.data, selectedId]);

  /* The draft is seeded from the saved set whenever the selection changes.
     Kept as local state rather than written per tick, so an administrator can
     make several changes and see them together before committing — this is a
     screen where a half-applied intent is worse than a slow one. */
  useEffect(() => {
    if (selected) {
      setDraft(new Set(selected.permissions));
      setError(null);
      setSaved(false);
    }
  }, [selectedId, selected?.permissions.join(",")]);

  const save = trpc.role.setPermissions.useMutation({
    onSuccess: async () => {
      setError(null);
      setSaved(true);
      await utils.role.list.invalidate();
      /* The caller's own permissions may have just changed. */
      await utils.identity.me.invalidate();
    },
    onError: (e) => setError(e.data?.userMessage ?? "Could not save those permissions."),
  });

  const create = trpc.role.create.useMutation({
    onSuccess: async (r) => {
      setCreating(false);
      setNewName("");
      setCopyFrom("");
      await utils.role.list.invalidate();
      setSelectedId(r.id);
    },
    onError: (e) => setError(e.data?.userMessage ?? "Could not create that role."),
  });

  const remove = trpc.role.delete.useMutation({
    onSuccess: async () => {
      setSelectedId(null);
      await utils.role.list.invalidate();
    },
    onError: (e) => setError(e.data?.userMessage ?? "Could not delete that role."),
  });

  const dirty = useMemo(() => {
    if (!selected) return false;
    const saved = new Set(selected.permissions);
    if (saved.size !== draft.size) return true;
    for (const p of draft) if (!saved.has(p)) return true;
    return false;
  }, [selected, draft]);

  const scopes = catalogue.data?.viewScopes ?? [];
  const chosenScopes = scopes.filter((s) => draft.has(s));

  const toggle = (key: string) => {
    setSaved(false);
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (me.isLoading) return <TableSkeleton rows={6} cols={2} />;
  if (!mayManage) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="You cannot manage roles"
        description="Managing roles needs account administration. Ask the equipment desk."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-medium">Roles &amp; Permissions</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            What each role may do. Changes apply on each person&apos;s next page load.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
          New role
        </Button>
      </div>

      {roles.isError ? <ErrorNote message="Roles could not be loaded." /> : null}

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        {/* ---- the roles ---- */}
        <nav className="flex flex-col gap-px overflow-hidden rounded-md border bg-border">
          {roles.isLoading ? (
            <div className="bg-card p-4"><TableSkeleton rows={5} cols={1} /></div>
          ) : (
            roles.data?.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={`flex flex-col items-start gap-1 bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent ${
                  r.id === selectedId ? "bg-muted font-medium" : ""
                }`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate">{r.name}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Users className="size-3" />
                    {r.userCount}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.permissions.length} permission{r.permissions.length === 1 ? "" : "s"}
                </span>
              </button>
            ))
          )}
        </nav>

        {/* ---- the permissions ---- */}
        <section className="flex flex-col gap-4">
          {!selected ? (
            <EmptyState title="Pick a role" description="Choose a role on the left to see what it may do." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-medium">{selected.name}</h2>
                {selected.isBuiltIn ? <Badge variant="secondary">Built in</Badge> : null}
                <span className="text-sm text-muted-foreground">
                  {selected.userCount} account{selected.userCount === 1 ? "" : "s"}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {!selected.isBuiltIn ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => remove.mutate({ id: selected.id })}
                      disabled={remove.isPending}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={!dirty || save.isPending}
                    onClick={() => save.mutate({ roleId: selected.id, permissions: [...draft] as never })}
                  >
                    {save.isPending ? "Saving…" : dirty ? "Save changes" : saved ? "Saved" : "No changes"}
                  </Button>
                </div>
              </div>

              {error ? <ErrorNote message={error} /> : null}

              {/*
                The scope warning. Holding two scopes is not additive — the
                widest wins — and holding none means the role sees NOTHING,
                which is a legitimate state but never what somebody intends by
                accident. Said here rather than refused, because refusing would
                stop a deliberate "this role reads reports and no tools".
              */}
              {chosenScopes.length === 0 ? (
                <p className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/5 p-3 text-sm">
                  <Info className="mt-0.5 size-4 shrink-0 text-warn" />
                  <span>
                    No visibility scope is ticked, so this role sees <strong>no tools at all</strong> — even with
                    &quot;See tools in the register&quot; on. That is deliberate for a role that only reads people or
                    settings; if not, tick one of the four scopes.
                  </span>
                </p>
              ) : chosenScopes.length > 1 ? (
                <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span>
                    {chosenScopes.length} scopes are ticked. They are not added together — the <strong>widest</strong>{" "}
                    applies, so this role gets <code>{chosenScopes[0]}</code>.
                  </span>
                </p>
              ) : null}

              {catalogue.data?.groups.map((g) => (
                <fieldset key={g.label} className="flex flex-col gap-2 rounded-md border bg-card p-4">
                  <legend className="px-1 text-sm font-medium">{g.label}</legend>
                  {g.hint ? <p className="text-xs text-muted-foreground">{g.hint}</p> : null}
                  <div className="flex flex-col gap-1.5">
                    {g.permissions.map((p) => (
                      <label key={p.key} className="flex cursor-pointer items-start gap-2.5 rounded px-1 py-1 text-sm hover:bg-accent/50">
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                          checked={draft.has(p.key)}
                          onChange={() => toggle(p.key)}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span>{p.label}</span>
                          <code className="text-xs text-muted-foreground">{p.key}</code>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </>
          )}
        </section>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>New role</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Name</span>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="site_lead" />
              <span className="text-xs text-muted-foreground">
                Lowercase, no spaces — like <code>site_lead</code>. Everything that joins against roles assumes that shape.
              </span>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Start from</span>
              <select
                value={copyFrom}
                onChange={(e) => setCopyFrom(e.target.value)}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
              >
                <option value="">Nothing — start empty</option>
                {roles.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Copy className="mt-0.5 size-3 shrink-0" />
                Copying is usually what you want — &quot;a superintendent, but without approval&quot;. Starting empty means
                ticking thirty boxes from memory.
              </span>
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button
              disabled={!newName || create.isPending}
              onClick={() => create.mutate({ name: newName, copyFromRoleId: copyFrom || undefined })}
            >
              {create.isPending ? "Creating…" : "Create role"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
