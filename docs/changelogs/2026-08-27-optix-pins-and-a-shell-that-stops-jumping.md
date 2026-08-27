# Optix takes the interface, and the shell stops flinching

Four separate reports, one afternoon, all about the frame rather than the product
inside it: the sidebar had no way to keep a favourite screen near the top; the
sign-in page still belonged to a single customer rather than to a product being
sold; reloading any page flashed the stock light palette before snapping back to
the chosen one; and opening the assistant made the rail and the whole content
column jump sideways.

Three of those turned out to be genuine defects with findable causes rather than
polish requests. They are written up below with the mechanism, because two of them
are the kind that will be reintroduced by the next well-meaning edit.

## What changed

### The product is called Optix in the interface

`optix-mark.tsx` is the one definition of the mark — `OptixGlyph`, an iris drawn
from generated geometry, and `OptixLockup`, the tile-plus-wordmark. It is shared by
the rail, the sign-in page, the forgot-password page, the invite/reset form and the
boot splash, so the five cannot drift; the rail previously drew a hand-set `ST`
monogram with a comment admitting it stood in for a logo that did not exist.

The rename is user-facing text and the mark **only**. `@stinventory/*`, the repo
name, the seeded `*.local` addresses and every `sti-*` storage key are untouched and
are meant to stay that way — CLAUDE.md now says so explicitly, so that nobody
"finishes" the rename into the package scope and nobody puts STInventory back on a
screen.

`NEXT_PUBLIC_APP_NAME` went with it, rather than being renamed. It was declared in
`packages/env/src/web.ts`, both compose files, `.env.example` and
`docker/Dockerfile.web` — five places — and read by **nothing**: `webEnv()` is
exported from `packages/env` and imported by no one, and the browser tab's title is a
literal in `layout.tsx`. Aligning five copies of a product name no screen consults
would have left five more places for the next rename to miss, and this rename already
missed four of them. `web.ts` carries a tombstone saying why it must not come back as
white-labelling: a `NEXT_PUBLIC_*` is inlined at build time, so it is one name per
image and cannot vary per tenant, which is the only reason a product sold to more
than one customer would want it. That is a `tenant_settings` row read at runtime.

The form column gained the lockup, a staggered rise on load, an error that animates
its own height so the button does not jump, and the thirteen demo accounts collapsed
behind a disclosure — the right number of accounts to have and the wrong number to
look at.

### The sign-in panel is about the operation, not the toolbox

This was a correction, and it is worth recording as one. The first pass at the rebrand
kept `AuthPanel` untouched on the judgement that it "already says the right thing", and
changed only its kicker — from "Urban Infraconstruction" to "AI-assisted custody". Both
halves of that were wrong. Naming one customer on the front door of a product being sold
to others is the obvious half; the subtler and more damaging half is that the panel's
whole subject was *one hand tool's journey out of a gang box*. Three stations reading
Yard → Truck → Job Site. A strip of five hand tools — drill, level, saw blade, tape
measure, wrench. A ledger whose every line was a tool transfer. It read as a tool-crib
app because it was a picture of one, and moving the kicker to "custody" narrowed it
further rather than widening it.

It now draws the operation. The route runs **between two jobs** — Legacy West → Truck 12
→ Trinity Bridge — because what the product tracks is a resource of any kind moving
between live jobs, not a tool leaving a crib; the origin glyph is a tower crane rather
than a gang box. The strip draws ADR-9's top-level resources: crew, plant, small tools,
materials, hours. The ledger mixes them — a crew assignment, an equipment move, a tool
transfer — because three identical tool lines quietly told the reader the log only holds
tools, which is the opposite of the claim in the paragraph beneath it. The kicker is
"Construction operations" and the headline widened without losing its shape: "Every move
on every job is a transaction, not a memory."

The line held deliberately: **domain imagery, never a feature list.** The strip is
unlabelled and no copy names a screen. Labour, Materials and Purchasing are accepted
architecture under ADR-9 and are not shipped surfaces — drawing an excavator says what the
platform is about, whereas a captioned "Equipment" tile would advertise a module that does
not exist. The one AI claim on the page is the one the backend honours: the assistant
drafts and a person confirms, per ADR-4.

`Drill`, `Level`, `SawBlade` and `TapeMeasure` went, and their keyframes with them —
`sti-bubble`, `sti-tape-blade`, `sti-tape-hook`, `sti-spin` and the four `.ink-*` rules
that drove them. They were the best drawings in the file and they were also most of the
reason the page read as a tool crib. `globals.css` carries a tombstone comment so the
next person finds out where they went rather than reviving one.

### Pinned sidebar rows, keyed on an id that is not the route

`nav-pins.ts` holds a `Set<id>` in `localStorage` under `sti-pins` and one pure
function, `pinnedItems(groups, pins)`. A star on any row lifts it into a Pinned
section at the head of the pane.

Two properties are the whole feature, and both are about what a pin must not be. It
stores a `NavItem.id`, never an href, so renaming a route cannot silently strand
every pin that named it — which meant giving every item a stable id first, the `id`
half of STI-1201, pulled forward because there is no correct way to build pins
without it. And pins are resolved by **intersecting with the already-permission-
filtered groups** the shell hands the rail, never read out of storage and linked.
Storage is editable by the person holding the browser; rendering it directly would
make the sidebar forgeable. `e2e/tests/nav-pins.spec.ts` pins that down with an HR
account whose seeded key names `tool-register`, `custody` and `people` and which must
come back with `/people` alone.

A pinned row that is also in the active group renders in both places. That is
intended — Pinned is a shortcut, not a move.

### The reload flash was the shell wiping a correct paint, not a theme arriving late

`app-shell.tsx` ran `applyTheme` in an unconditional mount effect. At that moment
`dark` was still at its initial `false` and no preferences had arrived, so the call
was `applyTheme(DEFAULT_PREFS, false)` — which strips every inline variable the boot
script in `layout.tsx` had already set and removes the `dark` class. The boot script
was doing its job perfectly and being undone a few milliseconds later, then restored
once `preferences.get` landed. That round trip is what people were seeing.

The effect is now gated on `appearanceSettled` — the light/dark preference has been
read from storage **and** the preferences row has reached the store — so the shell
leaves the boot script's paint alone until it can improve on it. A failed
`preferences.get` settles to the defaults rather than waiting forever. `AppSplash`
covers the remaining gap and paints from `--background`, so the mask itself is
already in the user's palette on the first frame.

### The assistant panel was scrolling the shell, not sliding over it

Two faults, stacked. `[data-slot="sidebar-wrapper"]` was statically positioned, so
the panel's `absolute` resolved against the viewport and its enter animation put
~200px of horizontal overflow on the document. And the panel scrolled its thread with
`endRef.scrollIntoView()`, which walks **every** scrollable ancestor — including the
wrapper, which `overflow-hidden` makes programmatically scrollable. On open the panel
sits one panel-width off to the right, so the browser obligingly scrolled the whole
shell sideways to reveal it. The rail and content column moved; the `position: fixed`
sidebar did not.

The wrapper is now `relative` (containment) and `overflow-clip` rather than
`overflow-hidden` — it clips identically but is not a scroll container, so nothing
inside the shell can ask it to move. The panel scrolls its own list by setting
`scrollTop`, and animates on a hard-damped spring with a real exit, which needed the
early `return null` replaced by `AnimatePresence` over an always-mounted component
whose queries stay gated on `open`.

### Motion has a house scale, and it respects the OS setting

`motion` is now a dependency of `apps/web`, with `lib/motion.ts` holding `EASE`,
`DUR` and `PANEL_SPRING` so a curve is decided once. `MotionConfig
reducedMotion="user"` sits at the root in `providers.tsx`: `motion` animates
regardless of the preference unless told otherwise, which would have made the JS
animations the only part of this app ignoring something every keyframe in
`globals.css` already honours.

Route content fades up on navigation, keyed on the pathname. Wall surfaces
(`fullBleed`) are deliberately excluded — the monitor is a board left running on a
screen across the room, and its `h-full` chain must not gain a wrapper.

## What was found while building it

**A rebrand is not a text substitution.** The panel passed every check that a rename
implies — no stale product name, no customer name, the mark correct everywhere — and was
still wrong, because what it *depicted* was the old product's scope. Nothing in a grep
catches that. It took someone looking at the screen and saying it felt like a small-tools
app.

**The theme flash and the assistant jump had the same shape as each other**: in both
cases something correct was being actively undone by a second mechanism, rather than
something being slow to arrive. Both looked like "needs a loading state" and neither
was.

**`overflow: hidden` is a scroll container.** It clips, so it looks like containment,
but it can still be scrolled programmatically and by the browser's own
scroll-into-view. `overflow: clip` is the one that actually takes an element out of
the scrollable-ancestor chain. This is worth knowing anywhere a fixed-size shell
holds something that slides.

**The shell wrapper had never been positioned**, despite `ai-panel.tsx` carrying a
comment since it was written asserting that the panel is "absolute inside the shell,
not fixed: it must stop at the top bar and the shell's own edges". The comment
described the intent; the CSS had never delivered it. The comment now records both.

**`SidebarMenuAction` and `SidebarMenuBadge` both claim `right-1`.** Only `/inbox`
carries a badge so nothing had collided yet; the count now slides left out of the
star's way on hover rather than under it.

**The first `[data-sidebar="menu"]` on the page is the job-scope switcher**, which
holds no links. Two of the new specs passed vacuously against it before the selectors
were scoped to the Pinned group by its own label — worth remembering when writing
anything that measures sidebar rows.

## Verified

Everything below was run against the Docker stack, not deduced from source.

- The assistant toggle, measured every few frames through the animation:
  `document.scrollWidth` stays equal to `clientWidth`, and the rail, the sidebar
  container and the content inset all hold `x` constant from before the click through
  open, closing and closed. Before the fix the same probe showed 203px of horizontal
  overflow and the rail travelling to `x: -122`.
- The reload flash, sampled on every animation frame for three seconds from first
  paint with a non-default palette saved: one appearance state for the whole window —
  `field-amber`, dark, one background colour. No `blocky|light` interval at all.
- The splash appears while the API is artificially delayed and is detached once the
  shell settles, in the user's own palette.
- Pinning, unpinning, survival across reload, an id naming nothing, and the HR
  permission intersection — `e2e/tests/nav-pins.spec.ts`, all passing.
- The rest of the browser suite, unchanged and still green.
- `pnpm typecheck` across the workspace, and `pnpm lint` in `apps/web`.
- `make test` inside the api container: every package passing, nothing skipped.
- `prefers-reduced-motion: reduce` — the panel lands in place with no travel and no
  console errors; `no-preference` animates.
- The rebuilt sign-in panel renders with no console error, and every new glyph was
  checked at its real size rather than zoomed. The first tower crane was a mast, a jib, a
  counterweight and a hoist, and rendered as a capital **T** at 28px — detail below about
  four device pixels is not detail. It carries an A-frame now, which is what makes a crane
  legible that small.
- `pnpm install --frozen-lockfile` succeeds, and `docker/Dockerfile.web` builds the
  production image. Checked deliberately: a new dependency added without regenerating
  the lockfile is exactly what STI-1101 was.

Not verified: the phone sheet variant of the sidebar, and the invite/reset pages
beyond the lockup rendering — no live token to walk them with.

## Deliberately not done

**The navigation was not retreed.** The original request described Equipment sitting
under Operations as a sub-category, which is STI-1201's third level plus STI-1202 —
`children` on a `NavItem`, collapsible sections, `matchItem` resolving three levels.
Offered and declined in favour of pins alone, so the shell is still two levels and
two hard-coded arrays. E12 is otherwise untouched: no `recordType`/`activity`/
`description`, and no module visibility (STI-1204).

**No pin synchronisation between devices.** Per-browser was the explicit ask;
`user_preferences.dashboard` is still free if that changes.

**No unit-test harness added to `apps/web`.** It has none, and standing one up to
cover a single pure function would be more machinery than the thing it tests. The
behaviour is covered in the browser suite, where the permission intersection can be
exercised against a real session rather than a mock.

**The docs were not renamed.** `docs/`, `README.md`, `AGENTS.md` and every existing
ticket still say STInventory. They are not wrong about anything except the name, and
a sweep would bury this diff.

## Where it is

Uncommitted on `development` at the time of writing, on top of `7dc2ca1`. Not
deployed. `.claude/rules/web.md` was updated in the same change — the navigation
section now describes ids and pins and states plainly which parts of E12 are still
unbuilt, the shell section carries the containment rules, and the theming section
carries the wipe. `docs/workings/RELEASE_2_SPRINT_PLAN.md` marks STI-1203 done and
STI-1201 part done.
