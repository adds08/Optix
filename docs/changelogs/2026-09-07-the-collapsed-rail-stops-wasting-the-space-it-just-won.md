# The collapsed rail stops wasting the space it just won

Reported as "spacing is so bad", with two areas circled on a screenshot of the
register with the pane collapsed. Both turned out to be real and neither was
what it first looked like, so both were measured in a browser before anything
was changed.

## What changed

### The wordmark overflowed the collapsed rail by 21px

`app-sidebar.tsx` drew `OptixWordmark` in the footer unconditionally. Measured in
the collapsed state: the mark is **57.3px wide starting at x=12** inside a
**48px** column, so it ran **21.3px past the edge**.

`optix-mark.tsx` already answers this and its header table says so — a square
slot takes `OptixGlyph`, a pane whose width the app controls takes
`OptixWordmark`. The footer now renders both and lets CSS pick on
`group-data-[collapsible=icon]`, so the mark SWAPS with the pane rather than
being hidden: 20px glyph centred in the rail, full wordmark back when expanded.

`SetupNotice` in the same footer already had this right — it reads
`useSidebar()` and returns null when collapsed. Same problem, solved there
first; only the mark was missed.

### Collapsing the pane doubled the left gutter

The counter-intuitive one, and the reason the numbers are now written into the
code. The content box is `mx-auto w-full max-w-[1400px] … lg:px-8`. At a 1512px
viewport:

| Pane | Available | Over the 1400 cap? | `mx-auto` adds | Left gutter |
|---|---|---|---|---|
| Expanded (272px) | 1240px | no | 0 | **32px** |
| Collapsed (48px) | 1464px | yes | 32px | **64px** |

So collapsing the pane released 224px and immediately spent 32px of it on a
centring gutter that did not exist a moment earlier. Beside a 48px icon rail,
that band of nothing does not read as breathing room — it reads as a broken
empty column, which is exactly how it was reported.

The horizontal padding now tightens while the pane is collapsed (`px-4` rather
than `lg:px-8`), so the total gutter stays in the 32–48px range either way
instead of stepping UP precisely when somebody asked for more room. Centring is
kept: on a genuinely wide monitor a 1400px measure beats a full-bleed one, and
the client chose that trade explicitly over left-aligning or raising the cap.

## What was found while building it

**`SidebarProvider`'s wrapper carries no `data-state`**, so the collapsed state
is not reachable by CSS from a nested element. `peer-*` was the obvious reach
and cannot work either: the content box is a DESCENDANT of `SidebarInset`, not a
sibling of the pane, and Tailwind's peer variants compile to a sibling
combinator. Hence `ContentBox` as its own small component — `useSidebar()` reads
the context `AppShell` itself provides, and a component cannot consume its own
provider. The vendored `ui/sidebar.tsx` was deliberately left alone rather than
grow an attribute for one screen's need.

**The third thing in that screenshot was not ours.** A dark "N" badge sits over
the footer: Next.js's dev-tools indicator, which defaults to bottom-left and has
no `devIndicators` config here. It does not exist in a production build. Worth
recording so nobody spends time on it — the overlap is real and the cause is not
the app.

## Verified

- `pnpm typecheck` — 14/14 tasks. 242 tests across 11 files still passing
  (nothing here touches them; no e2e asserts on the content box or the footer
  mark, checked before changing).
- Measured in a real browser at 1512px, both states, before and after:

| | Before | After |
|---|---|---|
| Collapsed footer mark | wordmark 57.3px, over the edge by 21.3px | glyph 20px at x=13.5, fits |
| Expanded footer mark | wordmark 57.3px | wordmark 57.3px, unchanged |
| Collapsed left gutter | 64px | **48px** |
| Expanded left gutter | 32px | 32px, unchanged |

**Not verified.** No automated test pins either number, so a future change to
the cap, the padding or the mark can reintroduce both silently. The
`no-layout-shift` e2e suite covers controls appearing inside a row, not the
pane-toggle geometry.

## Deliberately not done

- `mx-auto` kept, and the 1400px cap kept — left-aligning the content or raising
  the cap were both offered and declined.
- `ui/sidebar.tsx` untouched.
- The Next.js dev indicator left where it is; it is dev-only chrome.

## Where it is

Committed to `development` and pushed. Not deployed — only `main` auto-deploys.
