# The roster line gets real chips, and a little more room

Direct feedback on the crew-assignment work minutes after it landed: the
PM/superintendent line on the card face was plain, cramped text with no
employee code — inconsistent with the house rule this session had already
been holding itself to everywhere else (a tool's tag next to its name, a
foreman's external ID next to theirs), and with the real chip the sheet
right below it already draws for the same two people.

## What changed

**The card face's roster line is now the same chip `jobsite-team-strip.tsx`
draws** — a role-tinted pill, `PM`/`SUP` before the code, `EXT-ID · Name`
always both, never a name alone. It had been a comma-joined string built
specifically for the card face (`"PM Dana Whitmore"`, no code, no chip). Only
the remove button is missing, which is deliberate and stated in the code
comment carried over from the first cut: the whole card is a `<button>` that
opens the sheet, and nesting a control inside another interactive element is
invalid HTML regardless of styling. The real, removable chip is one click
away in the sheet.

**The card gained a touch more breathing room** — `p-3` → `p-3.5`,
`gap-2.5` → `gap-3`. Three dense lines (name, roster chips, tool count) had
been pressed against a 12px edge since the PM/Super line joined them; this is
the "just a bit, nothing more" version, not a resize pass.

## Verified

- `pnpm typecheck` and lint clean; `turbo run test` green across all eight
  packages.
- `jobsites-card-actions.spec.ts`'s face assertion is now stricter than
  before, not just re-passing: it checks the exact chip text
  (`PM-001 · Dana Whitmore`, `SUP-001 · Marcus Whitfield`) rather than a
  loose `/PM |Super /` pattern — the abbreviation changed from "Super" to
  "SUP" to match the sheet exactly, which the old regex would have missed
  entirely if it had stayed.
- Both `jobsites-card-actions.spec.ts` tests and `jobsites-card-view.spec.ts`
  pass against the change.

## Where it is

Committed on `development`, immediately following the crew-assignment
commit it corrects. Presentational only — no new props, no new wiring, the
same `leadersByProject` data the previous commit already threaded through.
