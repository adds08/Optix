"use client";
import { usePermissions } from "./use-permissions";
import type { Permission } from "@optix/types";

export function Can({ perm, children, fallback }: { perm: Permission; children: React.ReactNode; fallback?: React.ReactNode }) {
  const { has } = usePermissions();
  if (has(perm)) return <>{children}</>;
  return fallback ?? null;
}
