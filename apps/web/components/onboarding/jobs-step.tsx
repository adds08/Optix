"use client";

import { useMemo, useState } from "react";
import { Building2, MapPin, Plus, Search, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { DUR, EASE } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import { EntityField } from "@/components/ui/entity-picker";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { ErrorNote, TableSkeleton } from "@/components/sti/page";
import { StatusPill } from "@/components/sti/status";
import { useArmedConfirm } from "@/components/use-armed-confirm";
import { projectHint } from "@/lib/format";

/*
  Step one of the wizard, and — since 2026-09-10 — the body of the standing
  `/claim-a-job` page. ONE component for both, so what is offered and what is
  refused is decided in one place.

  The copy branches on `canClaim` rather than assuming the wizard. It used to
  say "only during initial setup... you cannot add projects yourself after
  finishing" and "ask your manager to add you" to EVERYBODY, which is false in
  both directions for the people who lead jobs: a director keeps the ability,
  and has no manager to ask.
*/
export function JobsStep() {
  const utils = trpc.useUtils();
  const options = trpc.onboarding.claimOptions.useQuery();
  const [projectId, setProjectId] = useState("");
  const [tier, setTier] = useState("");
  const state = trpc.onboarding.state.useQuery();
  /* A role holding a claim grant keeps it — see `isStandingClaimer` in
     routers/onboarding.ts. Everyone else gets the one pass the wizard gives. */
  const standing = !!state.data?.canClaim && !!options.data?.tiers.length;
  const claim = trpc.onboarding.claimProject.useMutation({ onSuccess: async () => { setProjectId(""); await Promise.all([utils.onboarding.invalidate(), utils.project.list.invalidate(), utils.projectTeams.invalidate()]); } });
  /* Undo, for the row you just added by mistake. `unclaimProject` refuses (with
     a plain error surfaced per-row) once it stops being a simple undo — once
     somebody has been added under you on that job, or you are holding tools
     through it — so this is only ever offered on jobs a person could actually
     walk back. */
  const [removeError, setRemoveError] = useState<{ id: string; message: string } | null>(null);
  const unclaim = trpc.onboarding.unclaimProject.useMutation({
    onSuccess: async (_data, variables) => {
      setRemoveError(null);
      await Promise.all([utils.onboarding.invalidate(), utils.project.list.invalidate(), utils.projectTeams.invalidate()]);
    },
    onError: (err, variables) => setRemoveError({ id: variables.projectId, message: err.message }),
  });
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
      {/*
        THE FORM IS A TOOLBAR, NOT A CARD.

        It was a bordered panel carrying its own `<h3>Take on a job</h3>` — on
        the standing page that repeated the page title one line below itself,
        and the panel nested a card inside a card. Both pickers were also full
        width, so on a desk monitor "Choose project" ran to 1,500px for a value
        that is a job number.

        Now: one labelled row of controls that sizes to its content, the action
        beside them rather than under, and the explanation once. In the wizard
        it still reads as a step; on the page it reads as the thing you came to
        do. No heading either way, because both callers already have one.
      */}
      {!!options.data?.tiers.length && (
        <section className="space-y-3">
          <p className="max-w-prose text-sm text-muted-foreground">
            {standing
              ? "Add a job you run. Once it is yours you can build its team, and everyone you add can staff the tiers below them."
              : "Only during initial setup. Your manager sees these assignments and can correct them. You cannot add projects yourself after finishing."}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 basis-64 space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Job</span>
              <EntityField
                value={projectId}
                onChange={setProjectId}
                options={options.data.projects.map((p) => ({ value: p.id, label: p.name, hint: projectHint(p) }))}
                placeholder="Choose project"
                searchPlaceholder="Search by name or code"
                emptyLabel="No eligible projects"
              />
            </label>
            <label className="min-w-0 flex-1 basis-52 space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Your responsibility</span>
              <EntityField
                value={tier}
                onChange={setTier}
                options={options.data.tiers.map((t) => ({ value: t.name, label: t.label }))}
                placeholder="Choose tier"
                searchPlaceholder="Search tiers"
                emptyLabel="No permitted tiers"
              />
            </label>
            <Button
              className="shrink-0"
              disabled={!projectId || !tier || claim.isPending}
              onClick={() => claim.mutate({ projectId, tier })}
            >
              <Plus className="size-4" aria-hidden />
              {claim.isPending ? "Adding…" : "Take it on"}
            </Button>
          </div>
          {claim.error && <ErrorNote message={claim.error.message} />}
        </section>
      )}

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
          {standing
            ? "No jobs yet. Add the ones you run using the picker above."
            : "No projects have been assigned yet. Use the initial setup options above if available, or ask whoever runs the job to add you."}
        </p>
      )}

      {/* The list gets a header of its own so the page reads as two things —
          "add one" then "the ones you have" — rather than a form with some
          rows loose underneath it. The count is here because it answers the
          question the page exists to answer. */}
      {rows.length > 0 && (
        <div className="flex items-baseline justify-between gap-3 pt-1">
          <h3 className="text-sm font-semibold">{standing ? "Jobs you run" : "Your jobs"}</h3>
          <span className="font-mono text-xs text-muted-foreground">
            {rows.length === (jobs.data?.length ?? 0)
              ? `${rows.length} ${rows.length === 1 ? "job" : "jobs"}`
              : `${rows.length} of ${jobs.data?.length}`}
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {rows.map((p, i) => (
            <JobRow
              key={p.id}
              p={p}
              index={i}
              reduced={reduced}
              onRemove={() => unclaim.mutate({ projectId: p.id })}
              removing={Boolean(unclaim.isPending && unclaim.variables?.projectId === p.id)}
              removeError={removeError?.id === p.id ? removeError.message : null}
            />
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

/*
  One row of "Jobs you run", pulled out of the list so the × button's confirm
  state (`useArmedConfirm`) belongs to THIS row and not to the whole list — a
  hook cannot be called once per array element inline in a `.map`, and every
  row needs its own independent armed/unarmed state regardless of what its
  neighbours are doing.
*/
function JobRow({
  p,
  index,
  reduced,
  onRemove,
  removing,
  removeError,
}: {
  p: {
    id: string;
    name: string;
    externalId: string | null;
    siteAddress?: string | null;
    teamRole: string;
    teamRoleLabel?: string | null;
  };
  index: number;
  reduced: boolean | null;
  onRemove: () => void;
  removing: boolean;
  removeError: string | null;
}) {
  /* Same two-click shape as every other destructive action in the app: first
     click arms the button and swaps its icon/label, a second click on the
     armed state actually removes the row. Guards the same mistake this whole
     button exists to fix — a stray click undoing the wrong job. */
  const { armed, handleClick } = useArmedConfirm(onRemove);

  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced
          ? { duration: 0 }
          : /* Capped so a dozen jobs do not take a second and a half
               to finish arriving. */
            { duration: DUR.fast, ease: EASE.out, delay: Math.min(index, 8) * 0.02 }
      }
      className="flex flex-col gap-1 px-3 py-3 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-center gap-3">
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
            and five then ask about.

            Rendered as the app's own pill rather than a one-off chip, so
            it reads the same as every other status in the product. */}
        <StatusPill
          tone="info"
          label={p.teamRoleLabel ?? p.teamRole}
          className="shrink-0"
        />

        {/* Undo, not "remove a person" — this ends the CALLER's own row,
            silently refusing (with the reason surfaced below) once it
            would touch anyone else's. Armed on the first click (label swaps to
            a filled, red confirm state) and only fires on the second — the
            house pattern for every destructive action with no dialog, so a
            slip of the mouse over an already-busy row cannot silently drop a
            job. */}
        {armed ? (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            disabled={removing}
            onClick={handleClick}
            aria-label={`Confirm removing ${p.name} from your jobs`}
          >
            {removing ? "Removing…" : "Confirm?"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={handleClick}
            aria-label={`Remove ${p.name} from your jobs`}
          >
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>
      {removeError && <p className="pl-11 text-xs text-destructive">{removeError}</p>}
    </motion.li>
  );
}
