"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogOut } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { clearSession, logout } from "@/lib/auth";
import { TableSkeleton, ErrorNote } from "@/components/sti/page";
import { Button } from "@/components/ui/button";

/*
  Who is logged in, and what they can do. Read-only for now — the account
  itself is provisioned by the owner; this page exists so the far-right menu
  has somewhere honest to land.
*/
export default function ProfilePage() {
  const router = useRouter();
  const me = trpc.identity.me.useQuery();

  async function onLogout() {
    try {
      await logout();
    } finally {
      clearSession();
      router.replace("/");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/home"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Dashboard
      </Link>

      {me.isLoading ? (
        <TableSkeleton cols={2} />
      ) : me.isError ? (
        <ErrorNote message="Your profile could not be loaded." />
      ) : (
        <dl className="max-w-lg overflow-hidden rounded-md border">
          <Field label="Name" value={`${me.data?.firstName ?? ""} ${me.data?.lastName ?? ""}`.trim()} />
          <Field label="Email" value={me.data?.email ?? "—"} />
          <Field label="Role" value={me.data?.role?.replace(/_/g, " ") ?? "—"} />
          <Field
            label="Permissions"
            value={(me.data?.permissions?.length ?? 0) > 0 ? `${me.data?.permissions.length} granted` : "none"}
          />
        </dl>
      )}

      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={onLogout}>
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b bg-card px-4 py-3 last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
