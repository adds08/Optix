"use client";

import Link from "next/link";
import { MessageSquare, Wrench } from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { EmptyState, TableSkeleton, ErrorNote, PageHeader } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { Button } from "@/components/ui/button";

/*
  The field view on the web, matching the mobile My Tools screen. A foreman
  who opens the browser instead of the app should land somewhere that answers
  "what am I holding" without a filter step.
*/
export default function MyToolsPage() {
  const me = trpc.identity.me.useQuery();
  const employeeId = me.data?.employeeId ?? undefined;

  const tools = trpc.asset.list.useQuery({ custodianId: employeeId }, { enabled: !!employeeId });

  const rows = tools.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My tools"
        hideTitle
        description={
          rows.length
            ? `You are holding ${rows.length} tool${rows.length === 1 ? "" : "s"}.`
            : "Nothing in your custody right now."
        }
        actions={
          <Link href="/chat">
            <Button size="sm">
              <MessageSquare className="size-4" />
              Hand something off
            </Button>
          </Link>
        }
      />

      {me.isLoading || tools.isLoading ? (
        <TableSkeleton rows={4} cols={3} />
      ) : !employeeId ? (
        <EmptyState
          title="This login is not linked to a field record"
          description="Custody is tracked against an employee. Ask the equipment desk to link your account."
        />
      ) : tools.isError ? (
        <ErrorNote message="Your tools could not be loaded." />
      ) : !rows.length ? (
        <EmptyState
          icon={Wrench}
          title="You are not holding any tools"
          description="When the yard issues you something, it appears here."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tools/${t.id}`}
                className="flex flex-col gap-2 rounded-md border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <Tag>{t.tag}</Tag>
                  <StatusPill status={t.status} />
                </div>
                <span className="font-medium">{formatAssetModel(t) || "Untagged tool"}</span>
                <span className="text-sm text-muted-foreground">
                  {[t.currentProjectName, t.locationName].filter(Boolean).join(" · ") || "—"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
