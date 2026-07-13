"use client";
import { trpc } from "@/lib/trpc";
import type { Permission } from "@stinventory/types";

export function usePermissions() {
  const me = trpc.identity.me.useQuery();
  const role = me.data?.role ?? null;
  const perms = me.data?.permissions ?? [];
  const has = (perm: Permission) => perms.includes(perm);
  return { role, has };
}
