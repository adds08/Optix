"use client";

/*
  The construction-operations login panel (docs/20, E).

  The centrepiece is a route, not a still life: a record travels job → truck →
  job, pausing in transit, while each station flares as it arrives. That is the
  product's whole thesis in one loop — where a thing is, is a sequence of
  receipts. Icons bobbing in place said nothing; this says what the headline
  claims.

  **Its subject is the OPERATION, not the toolbox**, and that was a real
  correction. Until 2026-08-27 this drew one tool's journey out of a gang box —
  three stations reading Yard → Truck → Job Site, a strip of five hand tools,
  and a ledger of nothing but tool transfers. Correct for STInventory, and
  precisely wrong for the front door of a product being sold to run a
  construction operation: it read as a tool-crib app, because it was one. The
  route now runs BETWEEN JOBS, the strip is the resources ADR-9 puts at the top
  of the navigation — crew, plant, small tools, materials, hours — and the
  ledger mixes all three. Do not narrow it back to tools.

  **Domain, not a feature list.** The strip is deliberately unlabelled and the
  copy names no screen. Labour, Materials and Purchasing are accepted
  architecture (ADR-9) and not shipped surfaces; drawing an excavator says what
  the platform is about, whereas a captioned "Equipment" tile would advertise a
  module that does not exist. Keep that line where it is.

  Everything is inline SVG line-art with stroke-dasharray draw-on and CSS
  transforms. No canvas, no WebGL, no dependencies, nothing that can delay the
  form beside it. `prefers-reduced-motion` removes the motion and keeps the
  drawing — see the note over the keyframes in globals.css.

  Trucks are drawn here as a station, never as a fleet: a truck in this
  product is a location that moves, and the diagram has to agree.
*/

import { cn } from "@/lib/utils";

type Vars = React.CSSProperties & Record<string, string>;

/* Shared line-art frame. Children must carry pathLength="1" — that is what
   lets one dash rule in globals.css draw any shape without measuring it. */
function Ink({
  className,
  delay = 0,
  width = 2.2,
  children,
}: {
  className?: string;
  delay?: number;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="var(--primary)"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("sti-ink", className)}
      style={{ "--ink-delay": `${delay}s` } as Vars}
    >
      {children}
    </svg>
  );
}

/* ---- stations -------------------------------------------------------- */

/* The job a thing is leaving. A tower crane rather than the gang box that was
   here before: the origin of a move is another JOB, not a box of hand tools,
   and that distinction is the whole point of the panel. */
function SiteCrane() {
  return (
    <Ink className="size-7" width={3}>
      <path pathLength={1} d="M32 54V18" />
      <path pathLength={1} d="M10 18h44" />
      {/* The A-frame is what makes this legible as a crane. Without it a mast
          and a jib are a capital T at 28px — which is exactly what the first
          attempt rendered as, counterweight and hoist detail included and
          invisible. Detail below about four device pixels is not detail. */}
      <path pathLength={1} d="M22 18l10-10 10 10" />
      <path pathLength={1} d="M45 18v9" />
      <path pathLength={1} d="M41 27h8" />
      <path pathLength={1} d="M23 54h18" />
    </Ink>
  );
}

function Truck() {
  return (
    <Ink className="size-7" width={3}>
      <path pathLength={1} d="M5 21h27v21H5z" />
      <path pathLength={1} d="M32 27h10l7 8v7H32z" />
      <path pathLength={1} d="M35 29.5h6l3.5 4.5H35z" />
      <circle pathLength={1} cx="15" cy="46" r="4.5" />
      <circle pathLength={1} cx="42" cy="46" r="4.5" />
    </Ink>
  );
}

function HardHat() {
  return (
    <Ink className="size-7" width={3}>
      <path pathLength={1} d="M13 43V33a19 19 0 0 1 38 0v10" />
      <path pathLength={1} d="M5 43h54a2 2 0 0 1 2 2v1a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-1a2 2 0 0 1 2-2Z" />
      <path pathLength={1} d="M24 43V23M40 43V23" />
    </Ink>
  );
}

/* ---- the resources a job consumes ------------------------------------ */

/*
  Four of the five resources at the top of SYSTEM_PLAN §7's grid — Labour,
  Small Tools, Equipment, Materials — and then hours, which is not a resource
  on that grid at all. Hours is Labour × Consume, so strictly the fifth slot
  belongs to Subcontract.

  It is a clock anyway, deliberately. Subcontract does not draw: there is no
  line-art shape that reads as "somebody else's crew under contract" at 56px,
  and a glyph nobody recognises is worse than an axis nobody sees. Hours is the
  single largest cost line on a construction job and the subject of the whole
  timesheet port (`docs/workings/TIMESHEET_PORT.md`), so it is the more
  legible thing to promise. Say that out loud rather than letting this comment
  claim a tidier mapping than the strip actually has.

  They are unlabelled on purpose — see the note at the top of this file.

  Drill, Level, SawBlade and TapeMeasure lived here until 2026-08-27, with
  hand-tuned keyframes for a drifting bubble and a tape blade that flicked in
  and out. They were the best drawings in the file and they were also the
  reason the panel read as a tool crib, so they went, and their keyframes went
  with them rather than rotting in globals.css.
*/

/* Labour. Two figures, not one: a crew is the unit a job is staffed in. */
function Crew() {
  return (
    <Ink className="size-16">
      <circle pathLength={1} cx="20" cy="23" r="7" />
      <path pathLength={1} d="M7 51v-5a13 13 0 0 1 26 0v5" />
      <circle pathLength={1} cx="45" cy="27" r="6" />
      <path pathLength={1} d="M35 51v-4a11 11 0 0 1 22 0v4" />
    </Ink>
  );
}

/* Equipment. The plant on the job — the resource whose day rate makes a
   jobsite expensive, and the one Urban asks about second after the crew. */
function Excavator() {
  return (
    <Ink className="size-16">
      <rect pathLength={1} x="5" y="44" width="32" height="11" rx="5.5" />
      <rect pathLength={1} x="11" y="26" width="19" height="18" rx="3" />
      <path pathLength={1} d="M30 31l13-8 8 12" />
      <path pathLength={1} d="M45 39h12l-3 9h-9z" />
    </Ink>
  );
}

/* Small tools — the register this product started as, now one resource of
   several rather than the whole subject. */
function Wrench() {
  return (
    <Ink className="size-16">
      <circle pathLength={1} cx="18" cy="46" r="7.5" />
      <circle pathLength={1} cx="18" cy="46" r="3.4" />
      <path pathLength={1} d="M51.5 20.6A7.5 7.5 0 1 1 43.4 12.5" />
      <rect pathLength={1} x="20" y="30" width="22" height="6" rx="3" transform="rotate(-45 31 33)" />
    </Ink>
  );
}

/* Materials, stacked on a pallet: the resource that arrives at a job and does
   not leave it. */
function Materials() {
  return (
    <Ink className="size-16">
      <path pathLength={1} d="M8 47h48" />
      <path pathLength={1} d="M13 47v6M32 47v6M51 47v6" />
      <rect pathLength={1} x="14" y="31" width="16" height="16" />
      <rect pathLength={1} x="34" y="31" width="16" height="16" />
      <rect pathLength={1} x="24" y="15" width="16" height="16" />
    </Ink>
  );
}

/* Hours. The one resource that is only ever spent. */
function Hours() {
  return (
    <Ink className="size-16">
      <circle pathLength={1} cx="32" cy="32" r="22" />
      <path pathLength={1} d="M32 17v15l11 7" />
    </Ink>
  );
}

const RESOURCES = [Crew, Excavator, Wrench, Materials, Hours];

/* ---- the route ------------------------------------------------------- */

/* Keep this `d` identical to the offset-path in globals.css: the line the eye
   follows and the line the token rides are the same curve, declared twice. */
const ROUTE = "M48 80 Q124 42 200 80 T352 80";

/* Job → transit → job. It read "Yard 1 → Truck 12 → Trinity Bridge" until
   2026-08-27, which describes a tool leaving a crib; what the product actually
   tracks is a resource of any kind moving between two live jobs, and the
   middle station is a truck because a truck here is a location that moves. */
const STATIONS = [
  { x: "12%", arrive: "0.4s", label: "Legacy West", sub: "Job site", icon: <SiteCrane /> },
  { x: "50%", arrive: "3.5s", label: "Truck 12", sub: "In transit", icon: <Truck /> },
  { x: "88%", arrive: "7.8s", label: "Trinity Bridge", sub: "Job site", icon: <HardHat /> },
];

function CustodyRoute() {
  return (
    <div className="relative w-full max-w-[620px]">
      <svg viewBox="0 0 400 160" className="w-full" fill="none" aria-hidden>
        <path
          className="sti-route"
          d={ROUTE}
          stroke="var(--primary)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="1 7"
          opacity="0.5"
        />
        {/* The tool itself: a tag, filled so it occludes the route it rides. */}
        <g className="sti-token" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round">
          <rect x="-15" y="-9.5" width="30" height="19" rx="5" fill="var(--card)" />
          <circle cx="-8" cy="0" r="1.9" />
          <path d="M-3 -3.5h10M-3 3.5h6" />
        </g>
      </svg>

      {STATIONS.map((s) => (
        <div key={s.label} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: s.x }}>
          <div className="relative grid size-14 place-items-center rounded-lg border bg-card shadow-sm">
            <span
              aria-hidden
              className="sti-arrive absolute -inset-2 rounded-2xl bg-primary opacity-0 blur-[7px]"
              style={{ "--arrive-delay": s.arrive } as Vars}
            />
            <span className="relative">{s.icon}</span>
          </div>
          <div className="absolute left-1/2 top-full mt-2.5 flex -translate-x-1/2 flex-col items-center gap-0.5">
            <span className="whitespace-nowrap text-xs font-medium leading-none">{s.label}</span>
            <span className="label-xs whitespace-nowrap leading-none">{s.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---- panel ----------------------------------------------------------- */

/* Three resources, one record. Every line was a small-tool transfer before
   2026-08-27, which quietly told the reader the log only holds tools — the
   opposite of the claim the paragraph underneath it makes. */
const LEDGER: [string, string][] = [
  ["03 MAR", "Crew of six assigned — Trinity Bridge"],
  ["11 MAR", "Excavator EX-204 moved from Legacy West"],
  ["02 JUN", "Rotary hammer UIC-1012 to D. Ellis"],
];

export function AuthPanel() {
  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden p-10">
      {/* blueprint grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      {/* A pool of light under the diagram so the middle of the panel is the
          middle of the composition, not just where the icons happen to sit. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-[420px] -translate-y-1/2"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 50%, color-mix(in oklch, var(--primary) 9%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="sti-sweep pointer-events-none absolute inset-0 opacity-0"
        style={{
          backgroundImage:
            "linear-gradient(100deg, transparent, color-mix(in oklch, var(--primary) 14%, transparent), transparent)",
          backgroundSize: "34% 100%",
          backgroundRepeat: "no-repeat",
        }}
      />

      <div className="relative flex flex-col gap-2">
        {/* The kicker positions the PRODUCT, not one customer and not one
            resource. It named Urban Infraconstruction while this was a
            single-tenant tool, then "AI-assisted custody", which was narrower
            still — custody of what? A sign-in screen that greets every prospect
            with somebody else's company name, or with a fraction of the
            product, is the first thing to fix on the way to selling it. */}
        <div className="animate-draw-in">
          <span className="label-xs">Construction operations</span>
        </div>
        <div className="animate-draw-in" style={{ animationDelay: "0.15s" }}>
          {/* "Every hand-off" was a tools sentence. The shape of the line is
              worth keeping — it is the best copy in the product — so it widens
              rather than being replaced. */}
          <p className="max-w-[21ch] text-balance text-3xl font-semibold leading-[1.15] tracking-tight">
            Every move on every job is a transaction, not a memory.
          </p>
        </div>
      </div>

      {/*
        The job, in motion. Resources first, the route second.

        **The strip is never hidden, and the order is not cosmetic.** Both were
        the other way round until 2026-08-27 and together they were the whole
        reason this panel still read as a delivery app after the rewrite. The
        strip carried `[@media(max-height:820px)]:hidden` — reasonable when it
        was five decorative hand tools and the comment here said "the route
        carries the idea on its own" — but 820px is taller than a normal laptop
        viewport, so on most screens every construction glyph in the panel
        (crew, plant, materials, hours) was dropped and what remained was a
        crane, A TRUCK and a hard hat on a dotted line. The truck is the
        largest, most recognisable silhouette of the three, so the page read as
        logistics.

        The strip is now the payload rather than the decoration, so it scales
        on a short viewport instead of disappearing, and it leads: the eye
        should land on what a job is made of before it lands on one thing
        moving between two of them.
      */}
      <div className="relative flex flex-col items-center gap-8 py-4">
        <div className="flex origin-center items-center justify-center gap-10 [@media(max-height:860px)]:scale-[0.88] [@media(max-height:720px)]:scale-[0.72]">
          {RESOURCES.map((Resource, i) => (
            <div key={i} className="sti-float" style={{ "--ink-delay": `${1 + i * 0.14}s` } as Vars}>
              <Resource />
            </div>
          ))}
        </div>
        <CustodyRoute />
      </div>

      <div className="relative flex flex-col gap-3">
        <ol className="flex max-w-[500px] flex-col gap-1.5">
          {LEDGER.map(([when, what], i) => (
            <li
              key={when}
              className="animate-draw-in flex items-center gap-3 rounded-md border bg-card/85 px-3 py-2 backdrop-blur-sm"
              style={{ animationDelay: `${1.6 + i * 0.13}s` }}
            >
              {/* Weight increases down the list: the newest receipt is the one
                  that answers "where is it now". Primary only — the status
                  hues are reserved and must not become decoration. */}
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-primary"
                style={{ opacity: 0.35 + i * 0.325 }}
              />
              <span className="label-xs shrink-0">{when}</span>
              <span className="truncate text-sm">{what}</span>
            </li>
          ))}
        </ol>
        <div className="animate-draw-in" style={{ animationDelay: "2s" }}>
          {/* The AI claim is the one the backend actually honours: the
              assistant drafts, a person confirms, and nothing reaches the
              ledger before that (ADR-4). Anything stronger would be a promise
              on the front door that the product refuses to keep. */}
          <p className="max-w-[46ch] text-pretty text-sm text-muted-foreground">
            Where every crew, machine and tool is — and which job is paying for it — is derived
            from that log, never typed into a field somebody can overwrite. Say what happened in
            a sentence; the assistant drafts the entry and a person confirms it.
          </p>
        </div>
      </div>
    </div>
  );
}
