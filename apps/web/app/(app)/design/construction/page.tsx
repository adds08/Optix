"use client";

import { Boxes, UserMinus } from "lucide-react";
import { GridPanel, HazardBand, Plate, TickRule, TitleBlock } from "@/components/sti/construction";
import { StatusPill, Tag } from "@/components/sti/status";
import { Button } from "@/components/ui/button";

/*
  Construction language — a design scratch route, deliberately not in
  nav-config so it never shows up in the rail.

  Same arrangement as /design/icons: each mark is shown ON the surface it is
  meant for, next to the plain version it would replace, so the question is
  "is this better here" rather than "is this a nice pattern". It renders inside
  the (app) group, so switching theme or dark mode in Settings repaints it —
  a mark that only works in Drafting Ink light is not a mark worth shipping.

  Delete this directory once the calls are made.
*/

export default function ConstructionLanguagePage() {
  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-1.5 border-b pb-5">
        <span className="label-xs">Design scratch</span>
        <h1 className="text-2xl font-semibold tracking-tight">Construction language</h1>
        <p className="max-w-[68ch] text-sm text-muted-foreground text-pretty">
          The login panel is drawn like a jobsite; the app behind it looks like any admin console.
          These are four marks that carry the language across that seam — hazard striping, a
          drawing title block, a stamped plate, and a ruled divider. Each is shown against the
          plain version it would replace. Every one is built from theme tokens, so change the
          theme in Settings and they follow.
        </p>
      </header>

      <Pair
        title="Hazard band"
        note="For states that mean STOP — a tool written off, a clearance queue blocking an offboarding. Not for errors, and not for anything that merely wants attention."
        plain={
          <div className="rounded-md border border-crit/30 bg-crit-bg px-4 py-3">
            <p className="text-sm font-medium text-crit">Held by terminated staff</p>
            <p className="text-sm text-crit/80">
              4 tools worth $12,480 must be returned before offboarding is signed off.
            </p>
          </div>
        }
        marked={
          <HazardBand
            title="Blocks offboarding"
            action={
              <Button size="sm" variant="outline">
                <UserMinus className="size-3.5" /> Clearance queue
              </Button>
            }
          >
            4 tools worth $12,480 must be returned, transferred or marked lost before offboarding
            is signed off.
          </HazardBand>
        }
      />

      <Pair
        title="Title block"
        note="Reports are the moat and they get printed, emailed and filed against a job. A title block makes one read as a document of record instead of a screenshot of a table."
        plain={
          <div className="rounded-md border bg-card px-4 py-3">
            <h3 className="text-lg font-semibold tracking-tight">Idle Tools</h3>
            <p className="text-sm text-muted-foreground">
              Legacy West Phase 3 · generated 8 Aug 2026 · 41 rows
            </p>
          </div>
        }
        marked={
          <TitleBlock
            title="Idle Tools"
            subtitle="Available stock with no movement in 30 days"
            fields={[
              { label: "Job", value: "22018 · Lone Star" },
              { label: "Issued", value: "8 Aug 2026" },
              { label: "Rows", value: "41" },
              { label: "Drawn by", value: "K. Oli" },
            ]}
          />
        }
      />

      <Pair
        title="Stamped plate"
        note="The same number the Tag component renders, treated as what it physically is — struck into a plate riveted to the housing. For where the tag is the subject, not one column of twelve."
        plain={
          <div className="flex items-center gap-3 rounded-md border bg-card px-4 py-3">
            <Tag>TOOL-0412</Tag>
            <span className="text-sm font-medium">BOSCH 11255VSR Bulldog</span>
            <StatusPill status="assigned" className="ml-auto" />
          </div>
        }
        marked={
          <div className="flex items-center gap-3 rounded-md border bg-card px-4 py-3">
            <Plate>TOOL-0412</Plate>
            <span className="text-sm font-medium">BOSCH 11255VSR Bulldog</span>
            <StatusPill status="assigned" className="ml-auto" />
          </div>
        }
      />

      <Pair
        title="Ruled divider"
        note="A section break in the yard's own handwriting. One element, and it reads as a measurement rather than a hairline."
        plain={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="label-xs">Held on this job</span>
              <div className="border-b" />
            </div>
            <p className="text-sm text-muted-foreground">18 tools across 3 crews.</p>
          </div>
        }
        marked={
          <div className="flex flex-col gap-3">
            <TickRule label="Held on this job" />
            <p className="text-sm text-muted-foreground">18 tools across 3 crews.</p>
          </div>
        }
      />

      <Pair
        title="Grid paper empty state"
        note="An empty register is a drawing nobody has made yet. The grid gives the dashed border something to enclose, and fades at the centre so text never fights a lattice."
        plain={
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed bg-card/40 px-6 py-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Boxes className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-medium">No tools on this job</p>
              <p className="text-sm text-muted-foreground">Hand one to a foreman to get started.</p>
            </div>
          </div>
        }
        marked={
          <GridPanel className="px-6 py-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Boxes className="size-5" />
              </span>
              <div className="flex flex-col gap-1">
                <p className="font-medium">No tools on this job</p>
                <p className="text-sm text-muted-foreground">
                  Hand one to a foreman to get started.
                </p>
              </div>
            </div>
          </GridPanel>
        }
      />
    </div>
  );
}

/* Plain on the left, marked on the right. Side by side is the only honest way
   to judge whether a mark earns its place — in isolation everything looks
   like an improvement. */
function Pair({
  title,
  note,
  plain,
  marked,
}: {
  title: string;
  note: string;
  plain: React.ReactNode;
  marked: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="max-w-[72ch] text-xs text-muted-foreground text-pretty">{note}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-[11px] text-muted-foreground">Today</span>
          {plain}
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-[11px] font-medium">With the mark</span>
          {marked}
        </div>
      </div>
    </section>
  );
}
