# The emails become Optix, and the short mark becomes the O

Two things a customer sees before they see the product: the invite email that
lets them in, and the small logo on it. Both were wrong.

Every transactional email said **STInventory** — in the header, the footer,
every subject line, most body copy, and the default sender address. That is the
repository name. CLAUDE.md has said since 2026-08-27 that it must never appear
on a screen, and these were not screens, so nobody checked them. They reached
real inboxes.

The short mark was a circle with a solid X shut inside it. It was a drawn idea
about the name rather than a piece of the supplied artwork, and at the size it
actually renders — a 32px rail slot, a favicon — the X read as a smudge inside
a ring.

## What changed

### The short mark is the wordmark's own O

Not a redraw. The wordmark's O is `cx 69, cy 70.5, rx 53, ry 54.5` with a 9.5
stroke, measured off `logo.png`; the glyph is that ellipse re-centred in its own
outer box, so the stroke stays at 8.02% of the height exactly as the wordmark
has it. It is very slightly wider than tall, which is visible against a true
circle — squaring it up is the mistake the comment there warns against.

Saved as standalone assets alongside `urban_logo.svg`, which is where anything
needing the mark outside React now gets it:

- `optix_glyph.svg` — `currentColor`, so one file is navy on paper and yellow on dark
- `optix_glyph_tile.svg` — the mark on its navy plate, colours baked in, for square slots

### Nothing in an email says STInventory

Rewritten templates: subjects, header, footer, body copy. The footer now signs
off as **Optix by Optix Technologies**. The default sender address changed from
`STInventory <no-reply@stinventory.local>` to `Optix <donotreply@optixtec.com>`
in all three places it was hardcoded — `apps/api`, `mail-config.ts` and
`.env.example` — because that string is what a recipient reads in their From
line, not an internal default.

Three tenant-name fallbacks also read `"STInventory"`, so a tenant whose row was
missing a name would have had it printed at them. They are `"Optix"` now.

### A resend invite says the old link is dead

`user.sendInvite` issues a new token and **consumes the previous one**, so by
the time the second mail arrives the first link is already dead. Nothing said
so. A reader holding two invites naturally opens the older one and lands on an
expired-token page with no explanation.

`inviteEmail` takes a `resend` flag: different subject (`…(resent)`), and copy
that states plainly that any earlier link has stopped working.

### The test email can send any template

Settings → Email had one hardcoded probe. It now has a **Template** dropdown —
plain, invite, resend, reset, changed — so an administrator can see how an
invite renders in their own client without inviting a real person to find out.

Samples use placeholder names and a **dead example path with no token in it**.
That is a security property, not a detail: this procedure must never mint a
credential, and a preview carrying a live invite token would be a way to issue
one to any address the sender chooses. Preview subjects are prefixed
`[Preview]`.

## What was found while building it

**The lint rule caught a native `<select>`**, which `.claude/rules/web.md` bans.
The first fix reached for `SearchSelect` and that would have been wrong for a
different reason: picking the already-selected option in `SearchSelect` CLEARS
it, which is correct for a filter and wrong for a required field with no empty
state. `EntityField` is the right component here.

**An email cannot carry this logo as an image.** SVG is stripped by Gmail,
Outlook and Yahoo; a remote image is blocked by default, so the header would be
an empty box until the reader clicks "show images"; a data: URI is blocked by
Outlook and stripped by Gmail. The mark is therefore a `div` with equal width,
height, radius and a thick border — a ring drawn by the layout engine, which
renders everywhere with images off. Outlook's Word engine ignores
`border-radius` and will square it; that is accepted, because a navy plate with
a yellow square is still legibly the brand and the alternative is VML nobody can
maintain.

**Several callers pass an empty first name on purpose** — the admin-triggered
reset has no name in hand — and the old templates rendered `Hi ,` at them.

## Verified

- `packages/mail`: 11 tests, including a guard that fails if "STInventory"
  reappears in any subject, HTML or plain-text part of any template.
- `pnpm typecheck`: 13 tasks. `pnpm lint`: 0 errors.
- Domain 147, api-contracts 381 (0 skipped, in the api container against
  `stinventory_test`).
- All four templates rendered from the real functions and read side by side.

**Not verified:** no email has been opened in a real client — Gmail, Outlook and
Apple Mail all render differently, and the Outlook degradation above is reasoned
from how its engine works rather than observed. Nothing has been sent, because
the relay still has no password.

## Deliberately not done

- **No tenant logo in the email header.** This package has no way to know where
  a tenant's artwork lives, and a broken image in the header of a password-reset
  email is worse than the tenant's name set in type, which is what the footer
  carries.
- **No template store.** A handful of emails that change twice a year do not
  earn a tenant-editable table, a preview screen and an HTML-injection review.
- **No PNG rasters of the mark.** Nothing in the repo can rasterise SVG, and the
  email path deliberately needs no image at all.

## Where it is

Branch `development`. Not on `main`, so not in production.
