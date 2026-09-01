"use client";
import { useMemo, useState } from "react";
import { Plus, TriangleAlert, type LucideIcon } from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
import { ToolTable, type ToolRow } from "@/components/jobsite-tool-table";
import { CrewCard, type Crew } from "@/components/jobsite-crew-card";
import { JobsiteTeamStrip } from "@/components/jobsite-team-strip";
import { type PickerRequest } from "@/components/rig-picker";
import { type CrewAssignRequest } from "@/components/crew-assign-dialog";
import { Highlight } from "@/components/highlight";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { moneyShort } from "@/lib/format";
import { cn } from "@/lib/utils";

/* Borrowed from JobsiteTeamStrip's own prop types rather than redeclared —
   that component doesn't export them, and typing a second copy here is
   exactly how the two would drift the day a field is added to one. */
type TeamMember = Parameters<typeof JobsiteTeamStrip>[0]["members"][number];
type TeamCandidate = Parameters<typeof JobsiteTeamStrip>[0]["candidates"][number];

/*
  The compact render of /jobsites: a grid of small cards, each opening its
  tools in a right-side sheet.

  This is a PRESENTATION of the page's `cards` array, not a second derivation
  of it. The page computes crews, loose tools, counts, value, gaps, scope and
  every filter exactly once (the `toolOk` predicate exists precisely because it
  was once copied four places), and this component only lays that result out
  differently — which is what makes the two views incapable of disagreeing
  about what is on a job. It holds no data logic, fetches nothing, and the one
  piece of state it owns is which card's sheet is open.

  The sheet resolves its card FROM THE LIVE ARRAY by id on every render rather
  than snapshotting it on click. A tool's ⋯ menu inside the sheet can move or
  return the tool; ToolMenu invalidates `asset.list`, the page rebuilds
  `cards`, and the open sheet must show the result — a snapshot would show the
  pre-mutation world with the register already elsewhere. If the card itself
  disappears (the mutation moved its last tool out from under an active
  filter), the sheet closes rather than presenting a stale ghost.
*/

export type JobsiteCard = {
  id: string;
  name: string;
  code: string | null;
  isJob: boolean;
  crews: Crew[];
  loose: ToolRow[];
  toolCount: number;
  value: number;
  gaps: string[];
  tint: string;
  /* Rig coverage — already computed once by the page for the same metric bar
     the list view shows; carried through so the face can answer "how rigged
     is this job" without opening anything. */
  trucks: number;
  trailers: number;
  fullyRigged: number;
  /* Chosen by the page, which owns the YARD/NOJOB sentinels — duplicating
     those string literals here is how the two views would drift. */
  icon: LucideIcon;
};

/* Same rule <Highlight> uses to decide whether to paint a mark — four letters
   or longer, case-insensitive substring — so "this card previews a match"
   never disagrees with "nothing on this card is actually marked". Matched
   against the same text a person reads (tag, serial, the formatted model),
   not against fields the card face never shows. */
function toolMatches(t: ToolRow, needle: string): boolean {
  const hay = `${t.tag ?? ""} ${t.serialNumber ?? ""} ${formatAssetModel(t) ?? ""}`.toLowerCase();
  return hay.includes(needle);
}

export function JobsiteCardView({
  cards,
  canAct,
  highlight,
  onPick,
  onAssignRequest,
  canManage,
  canAssignCrew,
  canAssignTools,
  team,
  employees,
  canAssignPm,
  canAssignSuper,
}: {
  cards: JobsiteCard[];
  /* The same gate the list view passes to ToolTable — the per-tool ⋯ menu.
     Both views must offer identical actions or "where can I hand this off"
     depends on which layout somebody happens to have picked. */
  canAct: boolean;
  highlight: string;
  /* Opens the page-owned rig picker (RigPicker is rendered once at the page
     level and reads its `request` from state — this is that state's setter,
     passed straight through, exactly as the list view passes it to
     CrewCard). Wiring a second RigPicker instance in here would be the "a
     second way to write custody" pattern this codebase has already paid for
     once, just for crew assignment instead of custody rows. */
  onPick: (r: PickerRequest) => void;
  /* Same shape for the "add tools to this crew" dialog — CrewAssignDialog is
     also rendered once at the page level. */
  onAssignRequest: (r: CrewAssignRequest) => void;
  /* False hides every rig-changing control, same meaning as CrewCard's own
     `canManage` (the list passes `canDrive` here). */
  canManage: boolean;
  canAssignCrew: boolean;
  canAssignTools: boolean;
  /* PM/superintendent roster, per project — `trpc.projectTeam.all` and
     `trpc.employee.list`'s results, unmodified. The page already fetches
     both for the list view's header strip; passed through rather than
     fetched a second time here. */
  team: { projectId: string; members: TeamMember[] }[];
  employees: { id: string; name: string; externalId: string | null; role: string; employmentStatus: string }[];
  canAssignPm: boolean;
  canAssignSuper: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? (cards.find((c) => c.id === openId) ?? null) : null;
  /* Per-crew tool-table fold, local to the sheet. Defaults to expanded — the
     whole reason to open a sheet is to see the tools, unlike the dense list
     where `master.crews` starts every crew shut so the page loads scannable. */
  const [closedCrews, setClosedCrews] = useState<Set<string>>(new Set());

  /* Candidates for a new PM/super: active employees, same filter the list
     view applies inline for the same reason — a deactivated account cannot
     be handed a roster row. */
  const teamCandidates: TeamCandidate[] = useMemo(
    () =>
      employees
        .filter((e) => e.employmentStatus === "active")
        .map((e) => ({ id: e.id, name: e.name, externalId: e.externalId, employeeRole: e.role })),
    [employees],
  );

  /* PM/superintendent per project, centralised once rather than re-filtered
     per card render — same source (`team`), same split the list applies. */
  const leadersByProject = useMemo(() => {
    const m = new Map<string, TeamMember[]>();
    for (const row of team) {
      m.set(
        row.projectId,
        row.members.filter((x) => x.role === "pm" || x.role === "superintendent"),
      );
    }
    return m;
  }, [team]);

  /*
    Which of THIS card's tools actually matched the search, so the face can
    show where a match is before anybody opens the sheet — the compact face
    otherwise carries only counts, and a card full of gap badges gives no clue
    which one is worth opening. Every tool on a card is already the result of
    the page's own filter (`toolOk` + free-text `hit`); this re-tests the same
    substring rule only to pick WHICH of those survivors to preview, never to
    decide whether the card belongs in the grid at all — that stays the page's
    job, and stays one derivation.
  */
  const previews = useMemo(() => {
    const needle = highlight.trim().toLowerCase();
    const m = new Map<string, ToolRow[]>();
    if (needle.length < 4) return m;
    for (const card of cards) {
      const all = [...card.crews.flatMap((c) => c.tools), ...card.loose];
      const hits = all.filter((t) => toolMatches(t, needle));
      if (hits.length) m.set(card.id, hits);
    }
    return m;
  }, [cards, highlight]);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => setOpenId(card.id)}
            aria-label={`Open tools on ${card.name}`}
            className={cn(
              "flex flex-col gap-2.5 rounded-md border bg-card p-3 text-left transition-colors",
              "hover:border-primary/50 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-2",
              card.tint,
            )}
          >
            <span className="flex w-full items-center gap-2.5">
              {/* Same chip the list header draws: the KIND of card, not a state,
                  so it takes no accent. */}
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted/70 text-muted-foreground">
                <card.icon className="size-4.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold tracking-tight">
                  <Highlight text={card.name} q={highlight} />
                </span>
                <span className="block text-xs text-muted-foreground">
                  {card.isJob
                    ? card.crews.length
                      ? `${card.crews.length} crew${card.crews.length === 1 ? "" : "s"}`
                      : "no crew yet"
                    : "between jobs"}
                </span>
              </span>
              {card.code ? (
                <span className="tnum shrink-0 rounded-sm border bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-foreground/75">
                  {card.code}
                </span>
              ) : null}
            </span>
            {card.isJob && (leadersByProject.get(card.id)?.length || card.crews.length) ? (
              /* Who runs it and how rigged it is — plain text, not the
                 interactive JobsiteTeamStrip: the whole card is a <button>
                 opening the sheet, and a Popover trigger nested inside
                 another interactive element is invalid HTML that breaks
                 click handling either way. The real, editable strip lives in
                 the sheet below, where it isn't nested inside anything. */
              <span className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                {leadersByProject
                  .get(card.id)!
                  .map((m) => `${m.role === "pm" ? "PM" : "Super"} ${m.name}`)
                  .join(" · ") || "No PM or superintendent assigned"}
                {card.crews.length ? (
                  <span className={cn("tnum ml-auto", card.fullyRigged < card.crews.length && "text-warn")}>
                    {card.fullyRigged}/{card.crews.length} rigged
                  </span>
                ) : null}
              </span>
            ) : null}
            {previews.has(card.id) ? (
              /* "Where the match is" — up to three of this card's tools that
                 matched, so the search you just typed is visible on the face
                 you're looking at rather than a fact you'd only learn by
                 opening the sheet. */
              <span className="flex w-full flex-col gap-0.5 border-t pt-1.5">
                {previews
                  .get(card.id)!
                  .slice(0, 3)
                  .map((t) => (
                    <span key={t.id} className="truncate text-[11px] text-muted-foreground">
                      <span className="font-mono text-foreground/70">
                        <Highlight text={t.tag ?? t.serialNumber ?? "Untagged"} q={highlight} />
                      </span>{" "}
                      <Highlight text={formatAssetModel(t) || "No description"} q={highlight} />
                    </span>
                  ))}
                {previews.get(card.id)!.length > 3 ? (
                  <span className="text-[11px] text-muted-foreground/70">
                    +{previews.get(card.id)!.length - 3} more match
                    {previews.get(card.id)!.length - 3 === 1 ? "" : "es"}
                  </span>
                ) : null}
              </span>
            ) : null}
            <span className="flex w-full items-center gap-2">
              <span className="rounded-sm border bg-muted/50 px-2 py-0.5 text-xs">
                <span className="tnum font-semibold text-foreground">{card.toolCount}</span> tool
                {card.toolCount === 1 ? "" : "s"}
              </span>
              <span className="tnum font-mono text-xs text-muted-foreground">{moneyShort(card.value)}</span>
              {card.gaps.length ? (
                <span className="ml-auto flex items-center gap-1 rounded-sm border border-warn/30 bg-warn-bg px-1.5 py-0.5 text-[11px] font-medium text-warn">
                  <TriangleAlert className="size-3" aria-hidden /> {card.gaps.join(" · ")}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>

      <Sheet open={open !== null} onOpenChange={(v) => (v ? null : setOpenId(null))}>
        {/* Wider than the sheet default (sm:max-w-sm): even the compact tool
            rows (no fixed columns, see ToolTable's `compact` prop) need real
            room for a tag, a name and a status to sit on one line before
            wrapping. The document itself never scrolls sideways — that stays
            true under icon-scale.spec.ts's check on this route. gap-0 because
            the header draws its own rule and the body owns its spacing. */}
        <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
          {open ? (
            <>
              <SheetHeader className="gap-2 border-b">
                {/* The "Add crew" button sits BESIDE SheetTitle, never inside
                    it — Radix wires the title element to the panel's
                    accessible name, and a button's text would ride along
                    into it ("NEX 22017 Add crew"). `pr-8` keeps it clear of
                    SheetContent's own close ✕, which is `absolute top-4
                    right-4` — outside this row's flow entirely, so an
                    `ml-auto` button here drifts straight under it without
                    the reserved gap. */}
                <span className="flex flex-wrap items-center gap-2 pr-8">
                  <SheetTitle className="flex flex-wrap items-center gap-2">
                    <Highlight text={open.name} q={highlight} />
                    {open.code ? (
                      <span className="tnum rounded-sm border bg-muted/60 px-2 py-0.5 font-mono text-sm font-normal text-foreground/75">
                        {open.code}
                      </span>
                    ) : null}
                  </SheetTitle>
                  {open.isJob && canAssignCrew ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto gap-1 border-dashed border-muted-foreground/40 text-primary hover:border-primary/50"
                      onClick={() => onPick({ kind: "crew", projectId: open.id })}
                    >
                      <Plus className="size-3.5" /> Add crew
                    </Button>
                  ) : null}
                </span>
                <SheetDescription>
                  {open.isJob
                    ? `${open.crews.length} crew${open.crews.length === 1 ? "" : "s"} · `
                    : ""}
                  <span className="tnum">{open.toolCount}</span> tool{open.toolCount === 1 ? "" : "s"} ·{" "}
                  <span className="tnum font-mono">{moneyShort(open.value)}</span>
                </SheetDescription>
                {/* The real, editable roster strip — safe to be interactive
                    here, unlike the card face, because the sheet header
                    isn't itself a button. */}
                {open.isJob ? (
                  <JobsiteTeamStrip
                    projectId={open.id}
                    members={leadersByProject.get(open.id) ?? []}
                    candidates={teamCandidates}
                    canAssignPm={canAssignPm}
                    canAssignSuper={canAssignSuper}
                  />
                ) : null}
              </SheetHeader>
              {/* The scroll container. Inner elements scroll by their own
                  overflow — never scrollIntoView; one of those inside the
                  assistant panel once dragged the whole shell sideways. */}
              <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3">
                {/* CrewCard in `compact` mode: byte-identical actions to the
                    list (same onPick calls, same menu items), only the
                    layout differs — see the prop's own comment. */}
                {open.crews.map((crew) => (
                  <CrewCard
                    key={crew.id}
                    crew={crew}
                    projectId={open.id}
                    expanded={!closedCrews.has(crew.id)}
                    onToggle={() =>
                      setClosedCrews((s) => {
                        const next = new Set(s);
                        if (next.has(crew.id)) next.delete(crew.id);
                        else next.add(crew.id);
                        return next;
                      })
                    }
                    onPick={onPick}
                    onAddTools={
                      canAssignTools
                        ? () => onAssignRequest({ mode: "pickTools", foremanId: crew.foremanId, foremanName: crew.foremanName })
                        : undefined
                    }
                    canManage={canManage}
                    canAct={canAct}
                    highlight={highlight}
                    compact
                  />
                ))}
                {open.isJob && !open.crews.length && canAssignCrew ? (
                  <button
                    type="button"
                    onClick={() => onPick({ kind: "crew", projectId: open.id })}
                    className="rounded-md border border-dashed border-muted-foreground/40 bg-card p-4 text-left text-sm font-medium text-primary hover:border-primary/50"
                  >
                    No crew on this job yet — add a foreman and a rig
                  </button>
                ) : null}
                {open.loose.length ? (
                  <section className="flex flex-col gap-1.5">
                    <header className="flex items-baseline gap-2">
                      {/* Same labels the list view uses for the same pile. */}
                      <span className="text-sm font-medium">
                        {open.isJob ? "On site, nobody holding" : "Waiting in the yard"}
                      </span>
                      <span className="tnum ml-auto text-xs text-muted-foreground">
                        {open.loose.length} tool{open.loose.length === 1 ? "" : "s"}
                      </span>
                    </header>
                    <div className="rounded-md border">
                      <ToolTable rows={open.loose} showWhere highlight={highlight} actions={canAct} compact />
                    </div>
                  </section>
                ) : null}
                {!open.crews.length && !open.loose.length ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nothing here under the current filters.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
