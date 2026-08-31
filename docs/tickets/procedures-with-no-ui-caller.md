# Procedures with no UI caller

**Phase:** 1 — Custody trail (follow-up)
**Size:** unsized — the triage is the first half of the work
**Status:** READY
**Opened:** 2026-08-22, by the Phase 3/5 reachability sweep
**Depends on:** nothing

---

## Why this exists

`SYSTEM_PLAN.md` §9 makes reachability the acceptance standard, not a nicety:

> Reachable through the UI by a user with the right permission

This is the failure mode that already cost this project real time. Six backend procedures
had no UI caller, which is how the **desk approval queue became unreachable** — a fully
built second-signature gate that no screen could open, found only when somebody went
looking. STI-105 fixed the instance. Nothing was put in place to catch the next one.

A sweep on 2026-08-22, mapping `appRouter`'s keys to each router's procedure names and
grepping both clients for `.<key>.<proc>`, found **22** procedures nothing calls. Two were
resolved during Phase 5:

- `messaging.pendingVerification` — **deleted.** It served the `verify` custody outcome,
  removed on 2026-08-09. Dead code carrying a live permission — the same class STI-111
  swept, missed because it was named for the queue rather than the outcome.
- `user.changePassword` — **now reachable** at `/account/password`. STI-303 set
  `must_change_password` on every account an administrator creates or resets, `login()`
  reported it, and no client read it. Every such user was told to change a password they
  had no way to change.

The rest are untriaged.

## The list, as of 2026-08-22

**Do not treat this list as authoritative** — recompute it. It moves whenever a screen is
added, and a stale list here would be exactly the kind of confidently-wrong document
CLAUDE.md warns about.

| Procedure | First guess | Why it needs a human |
|---|---|---|
| `assignment.return` | **Likely a real hole** | Returning a tool to the yard is an ordinary desk action. If there is no button, how does a tool come back? |
| `projectTeam.remove` | **Likely a real hole** | `projectTeam.assign` has a UI; its inverse does not |
| `asset.delete` | Probably correct as-is | It exists to REFUSE — it throws a message explaining tools are never deleted. A procedure whose only job is to say no may not need a caller |
| `asset.rebuild`, `asset.verifyProjection` | Probably ops | The reconciliation pair (STI-106). Deliberately separate actions; may belong on an admin screen rather than nowhere |
| `vehicle.updateGps`, `location.updateGps` | Probably integration | Written for a GPS provider, not a person |
| `task.create`/`get`/`update`/`delete`/`approve` | Unclear | Tasks are created by the chat path. Whether the CRUD is dead or just unbuilt needs deciding |
| `category.rename`/`delete`/`adoptInUse` | Unclear | Category management may simply have no screen yet |
| `department.create`/`update` | Unclear | Same |
| `vehicle.delete` | Unclear | `vehicle.update` has a UI |
| `notification.all` | Unclear | The admin-wide view; `notification.list` (own) is used |
| `messaging.feed` | Unclear | Chat uses `listMessages`; what `feed` is for is not obvious from the code |

## Acceptance criteria

1. **Triage every procedure into exactly one of three buckets**, with a one-line reason
   each: *needs a UI*, *legitimately has no UI* (ops, integration, or refusal-only), or
   *dead — delete it*. The triage is the deliverable even if nothing is built.
2. Anything in *dead* is deleted, not left with a comment saying it is unused. A procedure
   with a live `requirePermission` and no caller is an attack surface with no reason to
   exist.
3. Anything in *legitimately has no UI* carries a comment on the procedure saying so and
   why, so the next sweep does not re-triage it from scratch.
4. Anything in *needs a UI* becomes its own ticket with a screen named. Do **not** build
   eleven screens under this ticket.
5. **A test that fails on the next one.** This is the point of the ticket — the sweep exists
   as a script and should not. Model it on
   `packages/api-contracts/src/tenant-predicate.test.ts` and the router walk in
   `rbac-matrix.test.ts`: enumerate `appRouter`, grep the clients, fail on anything not in a
   documented exemption list, and make each exemption carry its reason.

## The trap

The exemption list is where this ticket goes wrong. If triage puts everything ambiguous
into *legitimately has no UI* to get the test green, the test asserts history rather than
policy and the next unreachable desk queue slips through inside it. **Prefer leaving a
procedure failing the test and the ticket open** over an exemption nobody can justify in a
sentence.

## Files

- `packages/api-contracts/src/index.ts` — `appRouter`, the authoritative key→router map
- `packages/api-contracts/src/rbac-matrix.test.ts` — the router-walk pattern to copy
- `packages/api-contracts/src/tenant-predicate.test.ts` — the exemption-with-a-reason pattern
