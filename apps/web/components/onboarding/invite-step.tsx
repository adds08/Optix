"use client";

import { useMemo, useState } from "react";
import { Check, Mail, ShieldAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { cn } from "@/lib/utils";

/*
  Step five: bring in whoever was just named and has no account.

  THE AUTHORITY QUESTION THIS STEP EXISTS TO ANSWER HONESTLY. Sending an
  invite is `user.invite`, gated on `user.manage`, which only office admins
  hold — a foreman or superintendent naming their crew in step four cannot
  also be the one who invites them, and pretending otherwise here would be
  exactly the elevated path this whole wizard was built to avoid (see the
  page-level comment).

  So this step never fakes the button. Somebody with `user.manage` sees the
  ordinary "Send invites" action. Everyone else sees the same list, marked
  plainly as PENDING, with the honest sentence: your office admin sends these.
  Nothing is silently dropped and nothing is invented — the people are visible
  either way, which is the whole value of the step even for a caller who
  cannot act on it themselves.

  Labourers and anyone else whose role has `needsLogin: false` are filtered
  out before this ever renders them: `role.needsLogin` already exists to tell
  "we haven't gotten to inviting them" apart from "they will never sign in",
  and nagging a foreman to invite a labourer who is never meant to have an
  account would be reintroducing the exact confusion that flag was added to end.
*/
export function InviteStep() {
  const utils = trpc.useUtils();
  const me = trpc.identity.me.useQuery();
  const crew = trpc.onboarding.crewStatus.useQuery();
  const employees = trpc.employee.list.useQuery();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());

  const canInvite = (me.data?.permissions ?? []).includes("user.manage");

  const invite = trpc.user.invite.useMutation({
    onSuccess: () => utils.employee.list.invalidate(),
    onError: (e) => setError(e.message),
  });

  /* Everyone named across the crew step, deduped, cross-referenced against the
     employee register for an account and an email — `crewStatus` itself
     carries neither, by design (it is a roster read, not a people read). */
  const needsAccount = useMemo(() => {
    const namedIds = new Set<string>();
    for (const job of crew.data ?? []) {
      for (const tier of job.tiers) {
        for (const f of tier.filled) namedIds.add(f.employeeId);
      }
    }
    const byId = new Map((employees.data ?? []).map((e) => [e.id, e]));
    return [...namedIds]
      .map((id) => byId.get(id))
      .filter(
        (e): e is NonNullable<typeof e> =>
          !!e && !e.userId && e.roleNeedsLogin !== false && !!e.email,
      );
  }, [crew.data, employees.data]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sendSelected = async () => {
    setError(null);
    for (const emp of needsAccount) {
      if (!selected.has(emp.id)) continue;
      const [firstName, ...rest] = emp.name.split(" ");
      try {
        await invite.mutateAsync({
          email: emp.email!,
          firstName: firstName || emp.name,
          lastName: rest.join(" ") || "—",
          employeeId: emp.id,
        });
        setSent((prev) => new Set(prev).add(emp.id));
      } catch {
        /* invite.onError already surfaced the message; stop rather than fire
           the rest of the batch against a config problem that will repeat. */
        break;
      }
    }
  };

  return (
    <section className="flex flex-col gap-4">
      {error && <ErrorNote message={error} />}
      {(crew.isLoading || employees.isLoading) && <TableSkeleton />}

      {!crew.isLoading && !employees.isLoading && needsAccount.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nobody you named is waiting on an account.
        </p>
      )}

      {needsAccount.length > 0 && (
        <>
          {!canInvite && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Sending an invite needs an office administrator. These are recorded here so
                yours can see them — you don't need to do anything else.
              </span>
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {needsAccount.map((emp) => {
              const done = sent.has(emp.id);
              return (
                <li
                  key={emp.id}
                  className={cn(
                    "flex items-center gap-3 rounded-md border p-3",
                    done && "border-primary/40 bg-accent",
                  )}
                >
                  {canInvite && !done && (
                    <Checkbox checked={selected.has(emp.id)} onCheckedChange={() => toggle(emp.id)} />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{emp.name}</span>
                    <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <Mail className="size-3 shrink-0" aria-hidden />
                      {emp.email}
                    </span>
                  </span>
                  {done ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-primary">
                      <Check className="size-3.5" aria-hidden />
                      Invited
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">Pending</span>
                  )}
                </li>
              );
            })}
          </ul>

          {canInvite && (
            <Button
              size="sm"
              className="self-start"
              disabled={selected.size === 0 || invite.isPending}
              onClick={sendSelected}
            >
              {invite.isPending ? "Sending…" : `Send ${selected.size || ""} invite${selected.size === 1 ? "" : "s"}`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
