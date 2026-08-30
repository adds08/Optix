# STI-404 — Foundation-owned fields read-only in the UI

**Phase:** 4 — Foundation entity load
**Size:** 1 unit
**Status:** BLOCKED by STI-402

---

## Why this exists

`SYSTEM_PLAN.md` §6.4: *"Fields owned by Foundation are read-only in the UI once an
`external_ref` exists, so a local edit cannot silently diverge and then be
overwritten."*

The failure this prevents is specific and demoralising: someone corrects a job name
in STInventory, the next sync overwrites it from Foundation, and the correction
vanishes with no error and no record. It happens twice before anyone stops trusting
the system.

## Acceptance criteria

1. Fields Foundation owns (the list comes from STI-401 question 4) render read-only
   on any record with an `external_ref`.
2. **Enforced on the server too**, not only in the UI. A disabled input is a hint; the
   procedure is the control. Rejecting the write needs a typed error the UI can
   render.
3. The UI says *why* a field is locked and where it is edited instead. A disabled
   field with no explanation reads as a bug and generates support load.
4. Records with no `external_ref` stay fully editable — manual and imported rows are
   still owned locally.
5. Fields Foundation does **not** own stay editable on synced records. Locking a whole
   record is easier and wrong.
6. Verified in a browser on a synced record and a manual one.

## Files

- `apps/web/app/(app)/projects/page.tsx`, `apps/web/app/(app)/people/[id]/page.tsx`
- `packages/api-contracts/src/routers/project.ts` — employee and project mutations
- STI-402's columns
