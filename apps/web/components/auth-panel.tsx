"use client";

/*
  The construction-themed login panel (docs/20, E).

  Lightweight line-art, drawn once on mount and left floating slowly —
  inline SVGs with stroke-dasharray draw-in and a gentle bob. No canvas, no
  WebGL, no dependencies. `prefers-reduced-motion` kills the animations, not
  the content.
*/

function Float({ delay, children, className }: { delay: number; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`motion-safe:animate-float-y ${className ?? ""}`}
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
    </div>
  );
}

function Draw({ delay, children }: { delay: number; children: React.ReactNode }) {
  return (
    <div className="motion-safe:animate-draw-in" style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  );
}

function HardHat() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="size-16" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 38h44a4 4 0 0 1 4 4v4H6v-4a4 4 0 0 1 4-4Z" />
      <path d="M14 38v-6a18 18 0 0 1 36 0v6" />
      <path d="M6 44h52v4a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-4Z" />
    </svg>
  );
}

function Hammer() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="size-16" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 20l8-8 24 24-8 8z" />
      <path d="M18 26l-8 8a4 4 0 0 0 0 6l6 6a4 4 0 0 0 6 0l8-8" />
      <path d="M34 6l24 24-6 6L28 12z" />
    </svg>
  );
}

function Crane() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="size-16" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 56V16h20" />
      <path d="M28 16h28l-10 10H36" />
      <path d="M8 24h8" />
      <path d="M40 26v18a4 4 0 0 1-4 4h-4" />
      <path d="M32 48l-4 8h8z" />
      <path d="M14 56h40" />
    </svg>
  );
}

function Crate() {
  return (
    <svg viewBox="0 0 64 64" fill="none" className="size-14" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="10" y="22" width="44" height="28" rx="2" />
      <path d="M10 32h44" />
      <path d="M22 22v28" />
      <path d="M42 22v28" />
      <path d="M10 46l44 4" />
    </svg>
  );
}

export function AuthPanel() {
  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden p-10">
      {/* blueprint grid, like the old thesis panel but fainter */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      <div className="relative flex flex-col gap-2">
        <Draw delay={0}>
          <span className="label-xs">Urban Infraconstruction</span>
        </Draw>
        <Draw delay={0.15}>
          <p className="max-w-[20ch] text-3xl font-semibold leading-[1.15] tracking-tight text-balance">
            Every hand-off is a transaction, not a memory.
          </p>
        </Draw>
      </div>

      {/* the yard, floating */}
      <div className="relative flex flex-wrap items-end gap-6">
        <Float delay={0}>
          <Crate />
        </Float>
        <Float delay={0.6}>
          <HardHat />
        </Float>
        <Float delay={1.2}>
          <Hammer />
        </Float>
        <Float delay={1.8}>
          <Crane />
        </Float>
      </div>

      <div className="relative flex flex-col gap-3">
        <Draw delay={0.3}>
          <div className="flex flex-col gap-1.5">
            {[
              ["03 MAR", "Received from Hilti, tagged UIC-1012"],
              ["11 MAR", "Assigned to M. Torres — Legacy West"],
              ["02 JUN", "Transferred to D. Ellis — Trinity Bridge"],
            ].map(([when, what]) => (
              <div key={when} className="flex items-baseline gap-3 rounded-md border bg-card px-3 py-2">
                <span className="label-xs shrink-0">{when}</span>
                <span className="text-sm">{what}</span>
              </div>
            ))}
          </div>
        </Draw>
        <Draw delay={0.45}>
          <p className="max-w-[44ch] text-sm text-muted-foreground text-pretty">
            Where a tool is, who holds it, and which project paid for it are derived from that
            log — never typed into a field somebody can overwrite.
          </p>
        </Draw>
      </div>
    </div>
  );
}
