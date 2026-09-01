"use client";
import { useState } from "react";
import { TriangleAlert, type LucideIcon } from "lucide-react";
import { ToolTable, type ToolRow } from "@/components/jobsite-tool-table";
import { type Crew } from "@/components/jobsite-crew-card";
import { Highlight } from "@/components/highlight";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { moneyShort } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  /* Chosen by the page, which owns the YARD/NOJOB sentinels — duplicating
     those string literals here is how the two views would drift. */
  icon: LucideIcon;
};

export function JobsiteCardView({
  cards,
  canAct,
  highlight,
}: {
  cards: JobsiteCard[];
  /* The same gate the list view passes to ToolTable — the per-tool ⋯ menu.
     Both views must offer identical actions or "where can I hand this off"
     depends on which layout somebody happens to have picked. */
  canAct: boolean;
  highlight: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? (cards.find((c) => c.id === openId) ?? null) : null;

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
        {/* Wider than the sheet default (sm:max-w-sm): the tool table carries
            real columns, and while its own .sti-table-scroll wrapper keeps any
            overflow internal, a 24rem panel would make every row a scroll. The
            document itself never scrolls sideways — that stays true under
            icon-scale.spec.ts's check on this route. gap-0 because the header
            draws its own rule and the body owns its spacing. */}
        <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
          {open ? (
            <>
              <SheetHeader className="border-b">
                <SheetTitle className="flex flex-wrap items-center gap-2">
                  <Highlight text={open.name} q={highlight} />
                  {open.code ? (
                    <span className="tnum rounded-sm border bg-muted/60 px-2 py-0.5 font-mono text-sm font-normal text-foreground/75">
                      {open.code}
                    </span>
                  ) : null}
                </SheetTitle>
                <SheetDescription>
                  {open.isJob
                    ? `${open.crews.length} crew${open.crews.length === 1 ? "" : "s"} · `
                    : ""}
                  <span className="tnum">{open.toolCount}</span> tool{open.toolCount === 1 ? "" : "s"} ·{" "}
                  <span className="tnum font-mono">{moneyShort(open.value)}</span>
                </SheetDescription>
              </SheetHeader>
              {/* The scroll container. Inner elements scroll by their own
                  overflow — never scrollIntoView; one of those inside the
                  assistant panel once dragged the whole shell sideways. */}
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
                {open.crews.map((crew) => (
                  <section key={crew.id} className="flex flex-col gap-1.5">
                    <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium">{crew.foremanName}</span>
                      {crew.rig.truck || crew.rig.trailer ? (
                        <span className="tnum font-mono text-xs text-muted-foreground">
                          {[crew.rig.truck?.unit, crew.rig.trailer?.unit].filter(Boolean).join(" + ")}
                        </span>
                      ) : null}
                      <span className="tnum ml-auto text-xs text-muted-foreground">
                        {crew.tools.length} tool{crew.tools.length === 1 ? "" : "s"}
                      </span>
                    </header>
                    {crew.tools.length ? (
                      /* The table expects its container to draw the outer box —
                         .sti-grid drops the last row's bottom rule for exactly
                         this wrapper (globals.css's note on jobsite tables). */
                      <div className="rounded-md border">
                        <ToolTable rows={crew.tools} highlight={highlight} actions={canAct} />
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No tools in hand.</p>
                    )}
                  </section>
                ))}
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
                      <ToolTable rows={open.loose} showWhere highlight={highlight} actions={canAct} />
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
