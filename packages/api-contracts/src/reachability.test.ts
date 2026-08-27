import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { appRouter } from "./index.js";

/*
  STI-121 — "a task is done when it is reachable".

  `SYSTEM_PLAN.md` §9 makes that the acceptance standard, not a nicety, and the
  reason is on the record: six backend procedures once had no UI caller, which
  is how the **desk approval queue** — a fully built second-signature gate —
  became something no screen could open. Nobody noticed until somebody went
  looking. STI-105 fixed that instance; nothing was put in place to catch the
  next one, and a sweep in August 2026 found twenty-two.

  This is that catch. It walks `appRouter`, greps both clients for
  `.<router>.<procedure>`, and fails on anything unreachable that is not in the
  list below **with a reason somebody had to write**.

  ## Read this before adding an entry

  The list is where this test goes wrong. If an awkward procedure gets dropped
  into it to make the build green, the test asserts history instead of policy,
  and the next unreachable desk queue hides inside it. Three rules:

  1. An entry needs a REASON, not a restatement of the name.
  2. "Nobody has built the screen yet" is not a reason to exempt — it is a
     reason to open a ticket and leave this failing. Entries below that say
     `TODO:` are exactly that: knowingly unreachable, tracked, and NOT silently
     blessed. They are in the list so the build is green on work already
     ticketed, and the `TODO:` prefix is what a reviewer greps for.
  3. Deleting is a legitimate outcome and usually the right one. A procedure
     with a live `requirePermission` and no caller is an attack surface with no
     reason to exist.

  ## The grep, and what it cannot see

  It matches `.router.procedure` anywhere in the client source, which covers
  `trpc.x.y.useQuery()`, `utils.client.x.y.mutate()` and `utils.x.y.invalidate()`
  alike. That last one is a known weakness: an `.invalidate()` with no
  corresponding query counts as a caller here and is really a no-op. Two such
  dead invalidates are known (`task.list`, `messaging.pendingActions`) and are
  noted in STI-121 rather than papered over — narrowing the grep to
  distinguish them is a refinement, not a reason to leave the whole check out.
*/

const CLIENT_ROOTS = ["apps/web", "apps/mobile"];

/*
  Triaged 2026-08-22. Three buckets, per STI-121's acceptance criteria:
  legitimately UI-less, or knowingly unbuilt and ticketed (`TODO:`), or
  deleted (in which case they are not here at all — `messaging.pendingVerification`
  was, and went).
*/
const NO_UI_BY_DESIGN: Record<string, string> = {
  /*
    Superseded on 2026-08-28, not unbuilt — which is why this has no `TODO:`.

    A role now lives on the PERSON (`employee.roleId`), and `employee.update` is
    the single writer that keeps `user_role` in step with it, covered by
    `role-sync.test.ts`. Changing somebody's role is therefore done on the
    person, and `/admin/users` — the screen that used to call this — was deleted
    with the merge.

    It stays because an account with no `employee` row still exists as a
    deliberate case (`user.create` documents it: somebody who signs in but never
    holds a tool) and this is the only way to move one. Deleting it would leave
    that account's role unchangeable through the API.
  */
  "user.setRole": "Superseded by the person's role (employee.roleId) plus the user_role sync in employee.update. Still the only path for an account with no employee row, which user.create explicitly allows.",

  /*
    Parked 2026-08-27, not unbuilt. Urban does not want an offboarding gate, so
    the clearance queue and the departure form came off every screen. The ENGINE
    was deliberately kept: `departure.ts` moves a leaver's tools, their company
    truck and trailer and everything riding in them to a named successor in one
    transaction, with ~600 lines of tests that still run.

    These three were counted as reachable until 2026-08-28 purely because the
    dead `departure-form.tsx` still referenced them — a false green of exactly
    the kind the note at the top of this file warns about, and the reason that
    file was finally deleted rather than left parked. They are `TODO:` because a
    screen for them is a real decision somebody still has to make, not because
    nobody got round to it.
  */
  "departure.preview": "TODO: parked with the offboarding gate (2026-08-27). The engine and its tests are kept; where a 'reassign a leaver's tools' action belongs is undecided.",
  "departure.reassign": "TODO: parked with the offboarding gate (2026-08-27). One-transaction move of a leaver's tools, truck and trailer to a successor — kept because marking tools lost does not replace it.",
  "dashboard.clearanceQueue": "TODO: parked with the offboarding gate (2026-08-27). Lists tools still on a terminated person's name; nothing enforced it and no screen shows it now.",

  // ---- legitimately reachable by nothing a person clicks ----
  "asset.delete":
    "Exists to REFUSE. It throws a sentence explaining tools are never deleted because the ledger is the audit trail — a procedure whose only job is to say no does not need a button.",
  "vehicle.updateGps":
    "Written for a GPS provider to call, not a person. There is no screen where somebody types a latitude.",
  "user.create":
    "Superseded in the UI by `user.invite` (2026-08-24) — the product now has no direct signup, so the only way an account becomes usable is by its owner consuming an emailed link. Offering both a screen for this AND for invite would mean choosing between a credential an admin typed out loud and one nobody but the recipient ever sees, which is the exact split the invite work exists to close. Kept, not deleted: `user-admin.test.ts` uses it as the fast, no-email way to seed a fully active test account, and it is a legitimate escape hatch when SMTP is not configured on this server at all.",

  // ---- knowingly unbuilt, ticketed, NOT blessed ----
  "asset.rebuild":
    "TODO: the STI-106 repair half. The boot sweep calls the shared fold directly, so the mechanism runs — but a desk that is told the register diverged has no screen to act on it. Needs an admin reconciliation page.",
  "asset.verifyProjection":
    "TODO: the STI-106 report half, same missing page. Invariant 4 is fully built and only observable from a log line.",
  "assignment.return":
    "TODO: returning a tool to the yard IS reachable — through chat, via apply-action's `return` case — but there is no button anywhere. The capability exists; the desk affordance does not.",
  "category.rename": "TODO: no category management screen exists; only create and list are wired.",
  "category.delete": "TODO: the same missing screen. Note it already refuses to delete a category still in use, so the hard part is built and only the button is absent.",
  "category.adoptInUse": "TODO: the same missing screen. It promotes a free-text category somebody typed on a tool into a real one — the tidy-up step for a register that accepts either.",
  "department.create": "TODO: there is no department admin page at all; only `department.list` is consumed, as a picker.",
  "department.update": "TODO: the same missing page. Departments are the cost target for shop tools, so getting one wrong misroutes a mechanic's charges rather than just a label.",
  "vehicle.delete": "TODO: `vehicle.update` has a UI and its delete does not. It carries the friendly guard in front of the composite-FK error (STI-203), so the reasoning exists and only the affordance is missing.",
  "location.delete": "TODO: same shape as vehicle.delete — a place can be created and edited from the locations screen but never removed, so a decommissioned gang box stays in every picker forever.",
  "notification.all": "TODO: the tenant-wide alert view for the desk. `notification.list` (your own) is wired; this is not.",
  "messaging.feed":
    "TODO: admin oversight across channels with the intent readout — a different thing from `messaging.messages`, which is per-channel and IS wired. Unbuilt, not duplicated.",
  "task.get": "TODO: a task detail view. The inbox renders everything it shows from `task.list`, so a request with a long description is only ever seen truncated.",
  "task.create": "TODO: tasks are raised by the chat path today; a form to raise one directly is unbuilt.",
  "task.update": "TODO: no screen edits a task. A desk that wants to correct a mistyped request has to decline it and ask for it again, which loses the thread.",
  "task.delete": "TODO: no screen deletes a task, and the flow that exists DECLINES instead — which is better, because it keeps the fact that somebody asked and was refused. Deleting may simply be wrong here; that is the decision to make.",
  "task.approve":
    "TODO: the inbox wires `task.decline` but not `task.approve`, which is the asymmetry worth looking at first — a desk can refuse a request from the UI and cannot grant one.",
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist" || entry === ".expo") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

/* The repo root, from this file's location inside packages/api-contracts/src. */
const ROOT = new URL("../../../", import.meta.url).pathname;

const clientSource = CLIENT_ROOTS.flatMap((r) => sourceFiles(join(ROOT, r)))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

/* `appRouter._def.procedures` is keyed "router.procedure" already — the same
   walk `rbac-matrix.test.ts` uses for the permission check, and authoritative
   in a way a hand-maintained inventory is not. */
const procedures = Object.keys(
  (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures,
);

describe("reachability (STI-121)", () => {
  it("can see the client source at all", () => {
    /* If the roots move, every procedure looks unreachable and the exemption
       list looks complete — a silent pass in the shape of a silent failure. */
    expect(clientSource.length).toBeGreaterThan(50_000);
    expect(clientSource).toContain("trpc.asset.list");
  });

  it("enumerates the router tree", () => {
    expect(procedures.length).toBeGreaterThan(50);
  });

  it("has no procedure that no client calls and nobody has accounted for", () => {
    const unreachable = procedures.filter((name) => {
      if (name in NO_UI_BY_DESIGN) return false;
      /* Escaped: procedure names are plain identifiers, but the dot is not. */
      const re = new RegExp(`\\.${name.replace(".", "\\.")}\\b`);
      return !re.test(clientSource);
    });

    expect(
      unreachable,
      `procedures no screen can reach:\n  ${unreachable.join("\n  ")}\n\n` +
        "SYSTEM_PLAN §9: a task is done when it is reachable. Build the screen, delete the " +
        "procedure, or add it to NO_UI_BY_DESIGN with a reason — and read the note at the " +
        "top of this file before choosing the third.",
    ).toEqual([]);
  });

  it("has no stale exemptions", () => {
    /* A procedure that has since gained a caller, or been deleted, must leave
       the list — otherwise it is a blanket pass sitting behind a name that no
       longer means anything. */
    const known = new Set(procedures);
    const stale = Object.keys(NO_UI_BY_DESIGN).filter((name) => {
      if (!known.has(name)) return true; // deleted
      const re = new RegExp(`\\.${name.replace(".", "\\.")}\\b`);
      return re.test(clientSource); // now reachable
    });
    expect(stale, `exemptions that are no longer needed:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("gives every exemption a reason somebody wrote", () => {
    for (const [name, reason] of Object.entries(NO_UI_BY_DESIGN)) {
      expect(reason.length, `"${name}" has no real reason`).toBeGreaterThan(40);
      /* A reason that just restates the name tells the next reader nothing. */
      expect(reason.toLowerCase()).not.toBe(name.toLowerCase());
    }
  });

  it("keeps the unbuilt ones visible as unbuilt", () => {
    /* The `TODO:` prefix is the difference between "this needs no UI" and
       "this needs a UI nobody has built". Collapsing the two is how the list
       stops meaning anything, so the count is asserted rather than left to
       drift: it may go DOWN as screens get built, never up without somebody
       changing this line and explaining why. */
    const todo = Object.values(NO_UI_BY_DESIGN).filter((r) => r.startsWith("TODO:"));
    /* Raised from 18 to 21 on 2026-08-28, with the reason this line demands.
       The three are the departure trio above, and they did not become
       unreachable — they always were. Deleting the dead `departure-form.tsx`
       stopped it propping them up, so this ceiling going UP is the test
       becoming more honest rather than less. */
    expect(todo.length).toBeLessThanOrEqual(21);
  });
});
