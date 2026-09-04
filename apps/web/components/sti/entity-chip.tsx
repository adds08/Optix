"use client";

import Link from "next/link";
import { ArrowRight, Briefcase, ClipboardCheck, HardHat, ShieldCheck, Wrench, type LucideIcon } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";

/*
  One person, rendered the same way everywhere: (ID · Name) inside one border.

  The ID and the name were two separate things sitting next to each other, which
  read as two facts rather than one identity — and on a narrow window the name
  truncated away to nothing while the ID stayed, leaving a row identifying
  somebody by a code alone. Binding them into a single bordered label fixes both:
  they wrap and truncate as a unit, and the pair IS how people refer to each
  other on a job.

  The role moves into the tooltip rather than sitting beside the name. It was
  the thing pushing the name out of the row on smaller screens, and it is
  qualifying detail — you look it up, you do not scan it fifty times.

  Clicking opens the person. `/people/[id]` is the whole answer now — the
  separate account register at `/admin/users` was removed on 2026-08-28 and a
  person's login is a column on their own row. There is one place a name goes.
*/

/*
  Leading icon and hat colour by role, following site convention rather than the
  app's own palette:

    white   supervision — PM, superintendent, equipment admin
    yellow  foreman, the bridge between management and the crew
    blue    trades and shop — mechanic, warehouse
    grey    office roles that never appear on a site

  These are NOT the status tokens. `--warn` amber and `--ok` green mean
  something specific and reserved in this product, and a foreman is not a
  warning; borrowing them here would put a permanent amber mark against fifty
  people. The hat tokens are their own small set in globals.css for exactly that
  reason — see `--hat-*`.

  "White" is drawn as the hat's OUTLINE, not a white fill: a white stroke is
  invisible on paper. The token resolves to near-black in light mode and
  near-white in dark, which is what a white hat actually looks like in each.
*/
const ROLE: Record<string, { icon: LucideIcon; hat: string; label: string }> = {
  pm: { icon: Briefcase, hat: "text-hat-white", label: "Project manager" },
  /* Its own glyph as of 2026-09-01, and the reason is new: a superintendent
     can hold custody now, so they appear as a CREW ROW on the jobsite board,
     directly above and below foremen. Sharing `ShieldCheck` with
     `equipment_admin` was harmless while the two never appeared in the same
     list and is not any more — the row has to say at a glance whether the
     tools are with the crew's foreman or with the super covering a job that
     has not got one yet. The white hat stays: this map models real hard-hat
     colour, where white IS supervision, and only the glyph is free to differ. */
  superintendent: { icon: ClipboardCheck, hat: "text-hat-white", label: "Superintendent" },
  equipment_admin: { icon: ShieldCheck, hat: "text-hat-white", label: "Equipment admin" },
  foreman: { icon: HardHat, hat: "text-hat-foreman", label: "Foreman" },
  mechanic: { icon: Wrench, hat: "text-hat-trade", label: "Mechanic" },
  warehouse: { icon: Wrench, hat: "text-hat-trade", label: "Warehouse" },
  procurement: { icon: Briefcase, hat: "text-hat-office", label: "Procurement" },
  hr: { icon: Briefcase, hat: "text-hat-office", label: "HR" },
  finance: { icon: Briefcase, hat: "text-hat-office", label: "Finance" },
};

const FALLBACK = { icon: HardHat, hat: "text-hat-office", label: "" };

/*
  Deterministic per-person colour, for the crew rows on the jobsite board.

  Role hats answer "what kind of person is this" — which is why every foreman
  looks the same, and on a board where the desk reads a column of foremen that
  sameness hides who is who. The design colours the foreman's mark per person,
  so the same foreman carries the same hue on every job and two foremen in one
  container never collide. `text-person-N` is picked by hashing the person's id
  — stable, no storage, no two-instance drift — and the hues deliberately avoid
  the status set (see the `--person-*` note in globals.css).
*/
const PERSON_TONES = ["text-person-0", "text-person-1", "text-person-2", "text-person-3", "text-person-4", "text-person-5"];

export function personTone(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PERSON_TONES[h % PERSON_TONES.length]!;
}

export function PersonChip({
  id,
  externalId,
  name,
  role,
  detail,
  className,
  personId,
}: {
  /* Employee id. Without one the chip still renders — it just does not link,
     because a dead link is worse than a plain label. */
  id?: string | null;
  externalId?: string | null;
  name: string;
  role?: string | null;
  /* Anything worth knowing on hover that the caller already has — "39 tools ·
     TE-011", "also on 2 other jobs". Never re-queried here: this renders once
     per row and a request per row would be a request storm. */
  detail?: string;
  className?: string;
  /* When set, the person's glyph takes their OWN deterministic hue instead of
     the role hat — for lists where the person, not the role, is the unit the
     eye is scanning (the jobsite crew rows). */
  personId?: string | null;
}) {
  const r = (role && ROLE[role]) || FALLBACK;
  const Icon = r.icon;
  const roleLabel = r.label || (role ? role.replace(/_/g, " ") : "");
  const tone = personId ? personTone(personId) : r.hat;

  const body = (
    /*
      The name is TEXT, not a link.

      It was a link, and on the jobsite board that made the one word people
      naturally aim at the only part of the strip that did not expand the row —
      you went to click a crew open and landed on a profile page instead. The
      row owns the click; opening the person moved into the panel below as an
      explicit action, which is also where it belongs, because navigating away
      should be something you choose rather than something you hit.
    */
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <Icon className={cn("size-4 shrink-0", tone)} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-semibold leading-tight">
          {externalId ? (
            <>
              <span className="tnum">{externalId}</span>
              <span className="mx-1 text-muted-foreground">·</span>
            </>
          ) : null}
          {name}
        </span>
        <span className="label-xs block truncate">{roleLabel || "—"}</span>
      </span>
    </span>
  );

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        {/* A span, not a button: the row behind it is the control, and nesting
            an interactive element inside it would both steal the click and be
            invalid. */}
        <span className="min-w-0 cursor-pointer">{body}</span>
      </HoverCardTrigger>
      <HoverCardContent>
        <span className="block text-sm font-semibold">{name}</span>
        {roleLabel ? (
          <span className="block text-xs capitalize text-muted-foreground">{roleLabel}</span>
        ) : null}
        {externalId ? (
          <span className="tnum block font-mono text-xs text-muted-foreground">{externalId}</span>
        ) : null}
        {detail ? (
          <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">{detail}</span>
        ) : null}
        {id ? (
          <Link
            href={`/people/${id}`}
            className="mt-3 flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            Open profile
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
