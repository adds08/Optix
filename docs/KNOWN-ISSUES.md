# Known issues

Defects that are **open**, verified against the code on the date beside each one.
Nothing here is speculative and nothing here is already fixed — an issues list
that carries closed items stops being read.

These came out of a full-repository audit on 2026-08-15 and were re-verified on
2026-08-29. They lived in `STINVENTORY-EXPLAINER.md` §12, which described a system
that has since changed enough to be misleading; the document was deleted and these
were kept, because the findings outlived the document.

Three were fixed on 2026-09-01 and their sections deleted per the rule below:
`asset.setStatus` accepting any string, `asset.create` not checking tag uniqueness,
and the case-sensitive login lookup. What remains are the two that are not one-line
changes — a trusted-proxy allow-list and worker concurrency — plus the SMS channel,
which is a decision rather than a defect.

**When you fix one, delete its section from this file** and say so in the
changelog. Do not leave it here marked resolved.

---

## 1. Rate limiting can be bypassed by rotating a header

**Severity: the highest one here.** `clientIp` (`apps/api/src/rate-limit.ts`) reads
`x-forwarded-for` and trusts it. There is no trusted-proxy allow-list, so a caller
that varies the header gets a fresh bucket per request.

This matters more than its size suggests: it is the **only** rate limit in the
system, and it guards `POST /auth/login` — the only bcrypt endpoint. Bcrypt is
deliberately expensive, so the endpoint is both the credential-stuffing target and
the cheapest way to burn the droplet's single CPU.

**The fix is not to stop reading the header.** The API sits behind a proxy, so the
real client address genuinely arrives that way. It is to trust the header only from
known proxy addresses, and to fall back to the socket address otherwise.

## 2. The workers cannot be run in more than one instance

`apps/api/src/messaging-worker.ts` claims a batch with a `SELECT` followed by a
separate `UPDATE`. There is no `FOR UPDATE SKIP LOCKED`, so **two API instances
would both claim the same rows** and process the same chat message twice.

Separately, all three `setInterval` callbacks in `apps/api/src/index.ts` are `async`
with no in-flight guard, so a scan that takes longer than its interval overlaps
itself. `deliverPendingNotifications` selects every undelivered row tenant-wide with
no pagination.

Today the deployment is a single droplet running one process, so none of this
fires. It is recorded because **the first horizontal scale-out is where it bites**,
and by then the symptom is duplicated custody actions rather than an error.

## 3. There is no SMS channel

`SMTP_*` is wired and email genuinely sends — `nodemailer` is a real dependency,
`sendMail` is called, and delivery attempts and errors are tracked on the
notification row.

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` are declared in the env
schema and in `docker-compose.yml`, and are **read by nothing**. Setting them has no
effect. Either build the channel or drop the variables; declared-and-ignored
configuration is a promise the system does not keep.

---

## Also true, and deliberate — not on this list

Recorded here because each has been reported as a bug more than once:

- **Nothing goes overdue.** There is no due date, no loan and no borrow model.
  Removed 2026-08-09.
- **There is no offboarding gate.** A tool can be marked lost or left on a departed
  person's name, and the ledger is append-only so either is reversible.
- **Hitching a trailer to a different truck does not rewrite the recorded truck of
  the tools aboard it.** That is a writer declining to claim something it was not
  asked about. See `.claude/rules/custody-and-ledger.md`.
- **`/home`'s fleet monitor overlaps its own text on a phone.** It is a wall-board.
  Reflowing it would degrade the screen it was built for; the answer is to route
  narrow viewports elsewhere, which is a product decision.
- **CSV export from the register exports one page**, and writes column ids rather
  than header labels. `report-table.tsx` gets both right and is the reference. This
  one *is* a defect, and it is here rather than above because it is a known,
  documented gap rather than a finding — see `docs/architecture/05-features.md`.
