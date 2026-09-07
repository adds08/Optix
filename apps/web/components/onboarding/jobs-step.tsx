"use client";

import { useMemo, useState } from "react";
import { Building2, HardHat, MapPin, Search } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { DUR, EASE } from "@/lib/motion";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";

/*
  Step one: the jobs you are on.

  READ-ONLY, and that is the whole design. This step used to list every active
  job in the tenant with a tick box, writing a `project_claim` — "I say I work
  here" — which granted nothing at all. The result was a step that looked like
  it did something and mostly did not: a person ticked five jobs, and steps two
  through four ignored four of them, because editing a job needs a roster row
  and a tick is not one. The wizard then explained its own bookkeeping to
  somebody who had ticked a box thirty seconds earlier.

  The rule now: **you are on a job when whoever runs it puts you on it.** So
  this step reports that, and every later step operates on exactly this set.
  There is nothing here to get wrong, and nothing the server can refuse.

  The search box survives because a superintendent can be on a dozen jobs and
  scanning for one by code is still the fastest way to find it. It filters; it
  does not select.
*/
export function JobsStep() {
  const jobs = trpc.onboarding.candidateProjects.useQuery();
  const [query, setQuery] = useState("");
  const reduced = useReducedMotion();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (jobs.data ?? []).filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.externalId ?? "").toLowerCase().includes(q) ||
        (p.siteAddress ?? "").toLowerCase().includes(q),
    );
  }, [jobs.data, query]);

  return (
    <div className="flex flex-col gap-4">
      {jobs.isLoading && <TableSkeleton />}
      {jobs.error && <ErrorNote message={jobs.error.message} />}

      {/* Only worth a search box once the list is long enough to scan. */}
      {jobs.data && jobs.data.length > 6 && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by job code, name or address"
            className="pl-8"
          />
        </div>
      )}

      {/*
        Nobody should reach this: `onboarding.state` refuses to prompt an
        account with no roster row, so a person on no jobs is never sent here.
        It stays because typing the URL is a thing people do, and five blank
        steps with no explanation is the worst version of that.
      */}
      {jobs.data && jobs.data.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          You're not on any jobs yet. Whoever runs your jobs adds you to them — once they
          have, this is where they'll show up.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="overflow-hidden rounded-md border">
          {rows.map((p, i) => (
            <motion.li
              key={p.id}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={
                reduced
                  ? { duration: 0 }
                  : /* Capped so a dozen jobs do not take a second and a half
                       to finish arriving. */
                    { duration: DUR.fast, ease: EASE.out, delay: Math.min(i, 8) * 0.02 }
              }
              className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
            >
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary"
                aria-hidden
              >
                <Building2 className="size-4" />
              </span>

              {/* Monospaced and fixed-width so the codes form a column the eye
                  can run down, the same treatment the register gives a tool. */}
              <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                {p.externalId ?? "—"}
              </span>

              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>

              {p.siteAddress && (
                <span className="hidden min-w-0 max-w-[13rem] shrink items-center gap-1 truncate text-xs text-muted-foreground lg:flex">
                  <MapPin className="size-3 shrink-0" aria-hidden />
                  {p.siteAddress}
                </span>
              )}

              {/* What you are ON this job — the tier, not the login role. It is
                  the one fact that differs job to job and the thing steps four
                  and five then ask about. */}
              <span className="flex shrink-0 items-center gap-1 rounded-[3px] border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <HardHat className="size-3" aria-hidden />
                {p.teamRoleLabel ?? p.teamRole}
              </span>
            </motion.li>
          ))}
        </ul>
      )}

      {jobs.data && jobs.data.length > 0 && rows.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No job matches “{query}”.
        </p>
      )}
    </div>
  );
}
