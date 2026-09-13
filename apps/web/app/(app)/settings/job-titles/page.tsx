"use client";

import { useMemo, useState } from "react";
import { Info, Users } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { EmptyState, ErrorNote, TableSkeleton, PageHeader } from "@/components/sti/page";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EntityField } from "@/components/ui/entity-picker";

/*
  Job Titles — what somebody with this title can do when they sign in.

  THE PROBLEM THIS SCREEN SOLVES. BambooHR tells us a person's job title. The
  sync recorded it and stopped: it never set their login role, so every synced
  person arrived with no permissions and no custody eligibility, and somebody
  set 190 of them by hand — again after every nightly run that added a starter.

  The three things named on this page are deliberately different, and the page
  is the only place all three meet:

    Job title    what payroll calls the post. BambooHR owns it; nothing here
                 edits it, because editing it here would put this register and
                 HR's into disagreement with no way to tell which is right.
    Login role   what an account may see and do. Edited on /settings/roles.
    Job tier     where somebody sits on a project team. Per project, not per
                 person, and NOT derived from either of the above — a foreman
                 on one job can be crew on another. /settings/team-roles.

  A DEFAULT, NOT AN ASSIGNMENT. Choosing a role here does not re-role the people
  who already hold the title. It decides what people arrive with: the sync fills
  a role only where there is none. An administrator who has made a decision
  about one person keeps it, because a nightly job that quietly undoes somebody's
  work is how people stop trusting a sync.

  Ordered by headcount. The title held by sixty people is the decision worth
  making first, and unmapped titles sort above mapped ones so the open questions
  stay at the top as the list gets answered.
*/

export default function JobTitlesPage() {
  const utils = trpc.useUtils();
  /* Straight from `identity.me` rather than `usePermissions`: this page needs
     the LOADING state as well as the answer, or it flashes "no access" at the
     person who has it. Same reasoning as /settings/roles. */
  const me = trpc.identity.me.useQuery();
  const mayManage = (me.data?.permissions ?? []).includes("employee.manage");

  const titles = trpc.role.jobTitles.useQuery(undefined, { enabled: mayManage });
  const roles = trpc.role.options.useQuery(undefined, { enabled: mayManage });

  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const setRole = trpc.role.setJobTitleRole.useMutation({
    onSuccess: () => utils.role.jobTitles.invalidate(),
    onError: (e) => setError(e.message),
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    /* The server has already ordered these — by headcount, then unmapped
       first. Filtering preserves that; re-sorting here would silently disagree
       with the explanation above the table. */
    return (titles.data ?? []).filter(
      (t) => !needle || `${t.name} ${t.code ?? ""} ${t.defaultRoleName ?? ""}`.toLowerCase().includes(needle),
    );
  }, [titles.data, q]);

  const unmapped = (titles.data ?? []).filter((t) => !t.defaultRoleId);
  const peopleUnmapped = unmapped.reduce((n, t) => n + t.headcount, 0);

  if (me.isLoading) return <TableSkeleton cols={3} />;
  if (!mayManage) {
    return (
      <EmptyState
        icon={Info}
        title="You do not manage the people register"
        description="Mapping job titles to roles needs the employee.manage permission."
      />
    );
  }

  const choose = (companyRoleId: string, roleId: string) => {
    setError(null);
    setSavingId(companyRoleId);
    /* "" is the picker's clear — "no opinion", which is not the same as mapping
       to a role that can do nothing. The sync skips an unmapped title and
       leaves its people alone. */
    setRole.mutate(
      { companyRoleId, roleId: roleId || null },
      { onSettled: () => setSavingId(null) },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Job Titles"
        description="The login role somebody gets when HR gives them this title. A default for new arrivals — it never changes a role somebody already has."
      />

      {titles.isLoading ? (
        <TableSkeleton cols={3} />
      ) : titles.isError ? (
        <ErrorNote message="The job titles could not be loaded." />
      ) : !titles.data?.length ? (
        <EmptyState
          icon={Users}
          title="No job titles yet"
          description="Titles appear here as BambooHR reports them. Run a sync from Settings › Integrations."
        />
      ) : (
        <>
          {peopleUnmapped > 0 ? (
            /* Named in PEOPLE, not titles: "9 titles unmapped" understates a
               list where one of them is every carpenter on the payroll. */
            <div className="flex items-start gap-2.5 rounded-md border bg-card p-4 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  {peopleUnmapped} {peopleUnmapped === 1 ? "person has" : "people have"} a title with no role
                </span>{" "}
                — they sign in able to do nothing until somebody chooses one here, or sets their role on their own
                record. Unmapped titles are listed first.
              </p>
            </div>
          ) : null}

          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search job titles…"
            className="max-w-xs"
          />

          {error ? <ErrorNote message={error} /> : null}

          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Job title</th>
                  <th className="px-4 py-2.5 font-medium">People</th>
                  <th className="px-4 py-2.5 font-medium">Signs in as</th>
                </tr>
              </thead>
              <tbody>
                {!rows.length ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-muted-foreground">
                      Nothing matches “{q}”.
                    </td>
                  </tr>
                ) : (
                  rows.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{t.name}</span>
                        {t.code ? (
                          <span className="ml-2 text-xs text-muted-foreground">{t.code}</span>
                        ) : null}
                        {!t.isActive ? (
                          <Badge variant="outline" className="ml-2">
                            Retired
                          </Badge>
                        ) : null}
                      </td>
                      <td className="tnum px-4 py-2.5 text-muted-foreground">{t.headcount}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <EntityField
                            value={t.defaultRoleId ?? ""}
                            onChange={(v) => choose(t.id, v)}
                            placeholder="Not set"
                            searchPlaceholder="Role name"
                            emptyLabel="No role matches."
                            options={(roles.data ?? []).map((r) => ({
                              value: r.id,
                              label: r.name,
                              hint: r.description ?? undefined,
                            }))}
                          />
                          {savingId === t.id ? (
                            <span className="text-xs text-muted-foreground">Saving…</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
