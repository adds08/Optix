"use client";

/*
  The construction-themed login panel (docs/20, E).

  The centrepiece is a custody route, not a still life: a tool token travels
  yard → truck → job site, pausing at the truck, while each station flares as
  it arrives. That is the product's whole thesis in one loop — a tool's
  location is a sequence of receipts. Four unrelated icons bobbing in place
  said nothing; this says the thing the headline claims.

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

/* A job box: the yard's own custody boundary. */
function GangBox() {
  return (
    <Ink className="size-7" width={3}>
      <path pathLength={1} d="M9 27h46v20a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3z" />
      <path pathLength={1} d="M9 27l5-7h36l5 7" />
      <path pathLength={1} d="M27 27v5h10v-5" />
      <path pathLength={1} d="M19 34v16M45 34v16" />
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

/* ---- the yard's tools ------------------------------------------------ */

function Drill() {
  return (
    <Ink className="size-14">
      <rect pathLength={1} x="11" y="17" width="27" height="16" rx="5.5" />
      <path pathLength={1} d="M38 21.5h6.5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H38" />
      <path pathLength={1} d="M46.5 25.5H57" />
      <path pathLength={1} d="M18 33v9.5a4.5 4.5 0 0 0 4.5 4.5h5a4.5 4.5 0 0 0 4.5-4.5V33" />
      <rect pathLength={1} x="15.5" y="47" width="19" height="7" rx="2.5" />
      <path pathLength={1} d="M32 35.5h4" />
    </Ink>
  );
}

/* The bubble drifts because a level nobody is holding still is a level. */
function Level() {
  return (
    <Ink className="size-14">
      <rect pathLength={1} x="3" y="26" width="58" height="13" rx="2.5" />
      <path pathLength={1} d="M15 26v13M49 26v13" />
      <rect pathLength={1} x="24" y="29.5" width="16" height="6" rx="3" />
      <circle pathLength={1} className="ink-bubble" cx="32" cy="32.5" r="2.2" />
    </Ink>
  );
}

/* The rim is one closed zig-zag — twelve teeth alternating r=21 at every 30°
   with r=17 at the 15° between. Drawn as the plate's actual outline rather
   than ticks laid over a circle, which is what stops it reading as a sun. It
   mitres, so the teeth come to points instead of the panel's usual round cap. */
function SawBlade() {
  return (
    <Ink className="size-14">
      <path
        className="ink-blade"
        strokeLinejoin="miter"
        d="M53 32L48.42 36.4L50.19 42.5L44.02 44.02L42.5 50.19L36.4 48.42L32 53L27.6 48.42L21.5 50.19L19.98 44.02L13.81 42.5L15.58 36.4L11 32L15.58 27.6L13.81 21.5L19.98 19.98L21.5 13.81L27.6 15.58L32 11L36.4 15.58L42.5 13.81L44.02 19.98L50.19 21.5L48.42 27.6Z"
      />
      <circle pathLength={1} cx="32" cy="32" r="11" />
      <circle pathLength={1} cx="32" cy="32" r="4" />
    </Ink>
  );
}

/* Blade out, blade back — the one gesture everybody in a yard recognises. */
function TapeMeasure() {
  return (
    <Ink className="size-14">
      <rect pathLength={1} x="9" y="22" width="24" height="24" rx="6" />
      <path pathLength={1} d="M13 22v-4h6v4" />
      <circle pathLength={1} cx="21" cy="34" r="6.5" />
      <circle pathLength={1} cx="21" cy="34" r="1.8" />
      <path pathLength={1} d="M33 30.5h3v6h-3" />
      <path pathLength={1} className="ink-tape-blade" d="M36 33.5h17" />
      <path pathLength={1} className="ink-tape-hook" d="M53 29.5v8" />
    </Ink>
  );
}

/* Ring end and open jaw, joined by a handle whose ends land exactly on both
   centres — the rotation is 45°, so the arithmetic is in the transform. */
function Wrench() {
  return (
    <Ink className="size-14">
      <circle pathLength={1} cx="18" cy="46" r="7.5" />
      <circle pathLength={1} cx="18" cy="46" r="3.4" />
      <path pathLength={1} d="M51.5 20.6A7.5 7.5 0 1 1 43.4 12.5" />
      <rect pathLength={1} x="20" y="30" width="22" height="6" rx="3" transform="rotate(-45 31 33)" />
    </Ink>
  );
}

const TOOLS = [Drill, Level, SawBlade, TapeMeasure, Wrench];

/* ---- the route ------------------------------------------------------- */

/* Keep this `d` identical to the offset-path in globals.css: the line the eye
   follows and the line the token rides are the same curve, declared twice. */
const ROUTE = "M48 80 Q124 42 200 80 T352 80";

const STATIONS = [
  { x: "12%", arrive: "0.4s", label: "Yard 1", sub: "Dallas", icon: <GangBox /> },
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

const LEDGER: [string, string][] = [
  ["03 MAR", "Received from Hilti, tagged UIC-1012"],
  ["11 MAR", "Assigned to M. Torres — Legacy West"],
  ["02 JUN", "Transferred to D. Ellis — Trinity Bridge"],
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
        <div className="animate-draw-in">
          <span className="label-xs">Urban Infraconstruction</span>
        </div>
        <div className="animate-draw-in" style={{ animationDelay: "0.15s" }}>
          <p className="max-w-[20ch] text-balance text-3xl font-semibold leading-[1.15] tracking-tight">
            Every hand-off is a transaction, not a memory.
          </p>
        </div>
      </div>

      {/* The yard, in motion. The tool strip is the first thing to go on a
          short viewport — the route carries the idea on its own. */}
      <div className="relative flex flex-col items-center gap-12 py-4">
        <CustodyRoute />
        <div className="flex items-center justify-center gap-8 [@media(max-height:820px)]:hidden">
          {TOOLS.map((Tool, i) => (
            <div key={i} className="sti-float" style={{ "--ink-delay": `${1 + i * 0.14}s` } as Vars}>
              <Tool />
            </div>
          ))}
        </div>
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
          <p className="max-w-[44ch] text-pretty text-sm text-muted-foreground">
            Where a tool is, who holds it, and which project paid for it are derived from that
            log — never typed into a field somebody can overwrite.
          </p>
        </div>
      </div>
    </div>
  );
}
