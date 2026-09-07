# A reset that locked people out, and mutations that said nothing

Two problems found by trying to use the product rather than read it. The client
asked whether sending an invite gives any confirmation — it does not — and
chasing that answer uncovered something worse in the action next to it.

## What changed

### `user.resetPassword` no longer locks the person out

The procedure does four things: generates a password, hashes it, sets
`mustChangePassword`, **deletes every session for that user**, and returns
`{ temporaryPassword }`. It sends no mail. There is no token and no link, by
design — the note at the top of `routers/user.ts` calls it a temporary
credential an administrator conveys out of band.

Every layer of the UI contradicted that. The row action said **"Send a password
reset"**, the success message said **"A reset link has been sent"**, and the
call site **discarded the returned credential**. So the actual behaviour was:
the account's password silently became a random string nobody had ever seen,
all their sessions were revoked, and the administrator was told an email had
gone out. **That locks the person out permanently with no recovery path.**

Found the hard way — fired twice against a real invited account while testing
the invite flow, on the strength of the label. It had to be repaired with a
hand-written bcrypt hash written straight to the `user` row, because there is
no in-product way back from it.

Now: the action is called **"Reset password"**, and the credential is shown
once in a dialog with a copy button, an explicit "this is not emailed to them"
warning, and a note that their sessions have been signed out. No toast for this
one on purpose — a toast auto-dismisses, and a credential that vanishes after
four seconds is the same defect in a smaller font.

### Mutations say whether they worked

`sonner` had been a dependency since before this work and was imported by
nothing: no `Toaster` mounted, no `toast()` call among sixty-eight
`useMutation` call sites. The feedback model was that failures print an inline
`ErrorNote` and successes say nothing at all — you infer the outcome from the
table refetching underneath you.

Tolerable for a create you can see land in a row. Not tolerable for an invite,
where the observable change is one cell moving from "Not invited" to "Invited"
on a twenty-five row table, and the actual effect happens in somebody else's
inbox where the sender cannot check it.

`Toaster` is mounted at the ROOT rather than in the app shell, so the
unauthenticated routes get it too — `/invite/[token]`, `/reset/[token]`,
`/forgot-password` and `/welcome` all sit outside the `(app)` group and are
exactly where somebody needs to know whether what they submitted worked. Theme
comes from `useThemeStore`, the same source the shell's `applyTheme` reads, so
a toast cannot render light while the app is dark.

Wired into the invite and the account actions. The invite success names the
address back, because a typo in it is otherwise indistinguishable from a
delivery that has not happened yet. Failures toast **and** keep their inline
message: the dialog stays open so the address can be corrected, and `failed` on
the register is keyed by row id so "they are still holding tools" renders
against the row that refused.

Deletes get a toast and **no undo**, which is not an omission.
`employee.delete` is a hard `db.delete` with no soft-delete column to restore
from, so an Undo could only re-INSERT — minting a new uuid and a different row
that merely looks the same. Offering it would be a lie about what happened. The
blast radius is already narrow: the procedure refuses outright if the person
holds tools or appears anywhere in custody history.

The `notice` banner at the top of the register is gone with the two messages
that fed it. A banner above the table is not where anybody is looking after
clicking a row action twenty rows down.

### Two more pickers stopped naming one role

- **`vehicle-form`** asked for `e.role === "foreman"` — the last custodian
  picker still naming a single role while its five siblings all read the shared
  `CUSTODIAN_ROLES`. A superintendent has held custody since 2026-09-01 and
  still could not be given a truck. Not a decision anybody made; the literal
  was simply older than the change that widened custody.
- **`rig-picker`** collapsed everyone to two names —
  `f.role === "superintendent" ? "superintendent" : "foreman"` — under a
  comment claiming it passed "the person's own role, not a hard-coded
  foreman". A two-value whitelist is exactly a hard-coded pair, and it filed a
  `general_superintendent` or a `mechanic` under `foreman`: the wrong roster
  row on somebody else's tier, which is the failure that comment names. It now
  checks the person's role against `projectTeam.roles.list` and passes it when
  it is a real tier, falling back to `foreman` only when it genuinely is not
  one — the same answer as before for those cases.

  `f.role` could not simply be passed through: it is the legacy employee column
  and not all of its values exist as tiers (`mechanic` is not one), so
  `requireTeamRole` would have refused it.

## Verified

- `pnpm typecheck` — 14/14. 242 tests across 11 files still passing.
- The reset dialog driven in a real browser against a live invited account: it
  renders "Temporary password for Richard Willis", a 16-character credential, a
  copy button, and both warning lines. The account was then restored to the
  known local password so the client's onboarding testing can continue.
- `Toaster` confirmed mounted in the DOM (sonner renders its container as a
  `<section aria-label="Notifications alt+T">`; the `[data-sonner-toaster]` list
  only appears once a toast exists, which is why a first check for the list
  looked like a missing Toaster).

**Not verified.** No automated test covers the reset dialog or any toast. The
toast render was confirmed by the container being present and by the mutation
returning 200 into a handler that calls `toast.success`, not by catching a
visible toast in the DOM — three attempts to do so kept missing the four-second
window between tool round-trips.

## Deliberately not done

- No undo on delete — see above; it would need soft-delete first.
- `user.resetPassword` was NOT changed to email a link. The temporary-credential
  design is deliberate and argued at the top of `routers/user.ts`; the defect
  was the UI lying about it, and that is what was fixed. Making it genuinely
  send a link is a separate decision.
- The remaining toast coverage: sixty-odd mutations across tools, projects,
  vehicles and custody still say nothing on success.

## Where it is

Committed to `development` and pushed. Not deployed — only `main` auto-deploys.
