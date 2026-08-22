"use client";
import { trpc } from "@/lib/trpc";
import { VIEW_SCOPES, type Permission, type ViewScope } from "@stinventory/types";

export function usePermissions() {
  const me = trpc.identity.me.useQuery();
  const role = me.data?.role ?? null;
  const perms = me.data?.permissions ?? [];
  const has = (perm: Permission) => perms.includes(perm);
  return { role, has };
}

/*
  The visibility ladder, client side (STI-302 / STI-307).

  Three forms used to ask `role === "superintendent"` to decide whether the
  custodian picker should be narrowed to a crew. That is the pattern
  SYSTEM_PLAN §9 forbids, and it was wrong in a way that mattered: it hard-coded
  ONE role into the answer, so a mechanic got the full company-wide picker and
  an engineer got a picker they had no business filling in. Adding a role got
  the widest possible behaviour by default.

  Resolution order and meaning are identical to `viewTierOf` in
  `packages/api-contracts/src/scope.ts`, reading the same VIEW_SCOPES array —
  widest first, first match wins.

  This narrows a PICKER, nothing more. The server refuses out-of-scope writes
  on its own and does not trust anything decided here; a client check that the
  server does not repeat is a suggestion, not a control.
*/
export function useViewTier(): ViewScope | "none" {
  const { has } = usePermissions();
  return VIEW_SCOPES.find((scope) => has(scope)) ?? "none";
}
