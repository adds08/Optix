# The login panel became a custody route, and the rail's collapse moved to the header

Follow-up to `2026-08-02-dashboard-chat-auth-redesign.md`. Same surfaces —
`docs/20` phases A2 and E — revisited after looking at what actually shipped.

## What changed

- **The auth panel's left half is now a diagram, not a still life.** It shipped
  as four line-art icons (hard hat, hammer, crane, crate) bobbing in place next
  to the headline "Every hand-off is a transaction, not a memory." The icons
  were decoration: they illustrated *construction*, while the headline claims
  something about *custody*. The panel now draws the claim — a tool token
  travels Yard 1 → Truck 12 → Trinity Bridge along a marching dashed route,
  pausing at the truck, and each station flares as the token reaches it. The
  pause is the point: the hand-off is the event the product records.
- **The truck is a station, not a vehicle.** It sits in the route as a place
  the tool passes through, which is what a truck is in this system — a location
  that moves. Drawing it as fleet equipment would have contradicted the schema.
- **New line-art: drill, spirit level, saw blade, tape measure, wrench.** These
  are small tools, which is what the product tracks; the crane that shipped
  first was heavy equipment the product has nothing to say about. Three of them
  carry their own idle motion — the level's bubble drifts, the blade turns, the
  tape measure runs its blade out and back.
- **The line art draws itself on.** Every shape carries `pathLength="1"`, so
  one dash rule in `globals.css` animates paths, rects, circles and arcs alike
  without measuring geometry in JS or hand-tuning a dash length per icon.
- **The sidebar collapse toggle moved from the rail's foot to the header.**
  `docs/20` A2 put it at the foot of the rail, below the nav list. That is
  where you put a control you do not expect anyone to find. It is now a ghost
  icon button at the left of the top bar, next to the mobile menu trigger,
  where the eye already is. Behaviour and the `sti-sidebar` localStorage key
  are unchanged.

## Found while doing it

- **`.sti-ink > *` will silently erase any child that opts out of the draw-on.**
  The saw blade's rim is a dashed/rotating element with no `pathLength`, so it
  inherited `stroke-dasharray: 1` against its real ~129-unit circumference and
  rendered as a bullseye of ~129 tiny dots. Anything inside an `.sti-ink` svg
  that does not want the draw-on must reset `stroke-dasharray` and
  `stroke-dashoffset` explicitly at higher specificity — inheriting the rule
  and only overriding `animation` is not enough.
- **A saw blade drawn as ticks around a circle reads as a sun.** Radial teeth,
  even raked, look like hair. Drawing the rim as one closed twelve-tooth
  zig-zag — the plate's actual outline, mitred so the points stay sharp against
  the panel's default round caps — was the fix.
- **The initial hidden state has to live inside the no-preference query.** A
  `stroke-dashoffset` declared outside it leaves reduced-motion visitors on a
  permanently blank panel. Verified with Playwright's `reducedMotion: "reduce"`:
  the finished drawing renders, with no motion.
- **The token disappearing behind the Truck 12 card during its pause is
  correct**, not an occlusion bug. For the 1.3s it is there, the tool is on the
  truck.

## Not done

- **The panel is still `lg:` only.** Below 1024px the sign-in form fills the
  page as before. A phone signing in does not need the argument for the
  product, and the form is the task.
- **The tool strip hides under 820px of viewport height** rather than
  reflowing. The route carries the idea on its own; the strip is the first
  thing that should go on a short laptop.
- **`docs/20` A2 and E were left as written.** The spec's reasoning outlives
  the work — this file is where the change of mind is recorded.
- **The desk shell was not screenshot-verified.** Docker was not running, so
  there was no API to sign in against; the collapse move is markup-only and
  passes typecheck, but nobody has looked at it in a browser yet.

## Where it is deployed

Committed only. Not yet on the droplet.
