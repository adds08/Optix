# STI-205 — Error boundaries use the removed `reset` prop

**Phase:** 2 — Assignment detail
**Size:** 1 unit
**Status:** READY
**Depends on:** nothing

---

## Why this exists

Found during stack research on 2026-08-16, not in `SYSTEM_PLAN.md`.

The error boundaries added in commit `f2ec724` are real and correctly placed — that
part of §5's "no error boundaries" is genuinely resolved. But this repo runs
**Next 16.3** (`apps/web/package.json`), and in 16.3 `error.tsx` and
`global-error.tsx` receive `{ error, retry }`.

Both files destructure **`reset`**:

- `apps/web/app/(app)/error.tsx:20`
- `apps/web/app/global-error.tsx:20`

And the comment in `error.tsx` explains `reset()` semantics. The two are not
equivalent: `retry()` re-fetches and re-renders Server Components, while the old
`reset()` only cleared client state. So even where `reset` still works as an alias,
the recovery behaviour is weaker than the comment claims.

**Whether `reset` remains an alias in 16.3 is unverified.** If it does not, the
recovery button in both boundaries is `undefined` and clicking it throws — the error
screen itself breaks, which is the worst place for this bug to live.

## Acceptance criteria

1. Determine, against the installed Next version, whether `reset` still works. Say
   which, with evidence — the type definitions in `node_modules/next` are the
   authority, not a blog post.
2. Both boundaries use the supported prop.
3. **The recovery button is exercised in a real browser.** Trigger an error, click
   recover, confirm it recovers. This is a ticket about an untested code path; it
   cannot be closed by reading the diff.
4. The rationale comment in `error.tsx` is rewritten to describe what the prop
   actually does now. Per `CLAUDE.md`, when a doc and the code disagree the code wins
   and the doc is fixed in the same change — a comment describing removed framework
   behaviour is the same problem.
5. `make ENV=local typecheck` passes. If `reset` was silently untyped, typecheck may
   have been passing on `any` — note it if so.

## Scope note

Two files and a comment. Do not take the opportunity to add more boundaries, restyle
the error screens, or add error reporting. If the segment coverage looks thin, report
it as a follow-up.

## Files

- `apps/web/app/(app)/error.tsx:20`
- `apps/web/app/global-error.tsx:20`
- `docs/tickets/STACK-NOTES.md` — the research this came from
