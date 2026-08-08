"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { Plate } from "@/components/sti/construction";
import { toolCategoryIcon } from "@/components/sti/tool-icon";
import { AssetActions } from "@/components/asset-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { dateTime, money, relative, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/* Which events deserve visual weight in the chain. */
const EVENT_TONE: Record<string, string> = {
  assign: "border-primary bg-primary",
  transfer: "border-primary bg-primary",
  return: "border-ok bg-ok",
  receive: "border-ok bg-ok",
  tag: "border-muted-foreground bg-muted-foreground",
  lost: "border-crit bg-crit",
  found: "border-ok bg-ok",
  dispose: "border-idle bg-idle",
  repair_start: "border-warn bg-warn",
  repair_complete: "border-ok bg-ok",
  status_change: "border-muted-foreground bg-muted-foreground",
};

export default function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const utils = trpc.useUtils();
  const asset = trpc.asset.get.useQuery({ id });
  const events = trpc.transaction.list.useQuery({ assetId: id, limit: 200 });

  /* The other half of "tags that are created": an untagged tool can catch up
     without a trip through the whole edit form. The field opens EMPTY — whoever
     is holding the label gun types what is on the label, and the router's clash
     check rejects anything already in use. No suggestion, ever. */
  const [addTag, setAddTag] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [tagError, setTagError] = useState("");
  const addTagMut = trpc.asset.update.useMutation({
    onSuccess: () => {
      utils.asset.get.invalidate({ id });
      utils.asset.list.invalidate();
      setAddTag(false);
      setTagDraft("");
    },
    onError: (e) => setTagError(e.message),
  });

  const a = asset.data;

  const saveTag = () => {
    setTagError("");
    addTagMut.mutate({ id, tag: tagDraft.trim() });
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/tools"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Tool Register
      </Link>

      {asset.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-96" />
        </div>
      ) : asset.isError ? (
        <ErrorNote message="This tool could not be loaded. Check that the API is running, then reload." />
      ) : !a ? (
        <EmptyState
          title="No such tool"
          description="This tag does not exist in your tenant, or it was removed."
          action={
            <Link href="/tools" className="text-sm font-medium text-primary hover:underline">
              Back to the register
            </Link>
          }
        />
      ) : (
        <>
          <PageHeader
            icon={toolCategoryIcon(a.categoryName)}
            eyebrow={a.categoryName ?? "Equipment"}
            title={formatAssetModel(a) || "Untagged tool"}
            description={a.serialNumber ? `Serial ${a.serialNumber}` : undefined}
            actions={
              <div className="flex flex-wrap items-center gap-3">
                {/* The tag is the subject here, not one field in a grid of
                    eight — struck into a plate, not printed in a table
                    cell. Untagged tools get the "add tag" panel below
                    instead; nothing to stamp yet. */}
                {a.tag ? <Plate>{a.tag}</Plate> : null}
                <AssetActions
                  assetId={id}
                  assetTag={a.tag ?? "Untagged tool"}
                  heldBySomeone={!!a.custodianId}
                />
                <StatusPill status={a.status} className="text-xs" />
              </div>
            }
          />

          {/* Adding a tag to a tool that arrived without one. */}
          {!a.tag && (
            <div className="rounded-md border border-dashed p-4">
              {addTag ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    placeholder="Type what is on the label"
                    className="max-w-xs"
                    aria-label="New tag"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && saveTag()}
                  />
                  <Button size="sm" onClick={saveTag} disabled={!tagDraft.trim() || addTagMut.isPending}>
                    Save tag
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setAddTag(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    This tool has no tag yet. Add the label number when somebody has written one on it.
                  </p>
                  <Button size="sm" variant="outline" onClick={() => setAddTag(true)}>
                    Add tag
                  </Button>
                </div>
              )}
              {tagError ? <p className="mt-2 text-sm text-destructive">{tagError}</p> : null}
            </div>
          )}

          {/* Current state — derived, and labelled as such so nobody mistakes it
              for something they can edit here. */}
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-medium">Where it stands now</h2>
              <span className="label-xs normal-case tracking-normal">
                derived from the log below, not entered
              </span>
            </div>
            <dl className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Tag" value={<Tag>{a.tag}</Tag>} />
              <Field
                label="Held by"
                value={a.custodianName ?? <span className="text-muted-foreground">In warehouse</span>}
              />
              <Field
                label="On project"
                value={a.currentProjectName ?? <span className="text-muted-foreground">—</span>}
                hint="operational"
              />
              <Field
                label="Charged to"
                value={a.owningDepartmentName ?? a.owningProjectName ?? <span className="text-muted-foreground">—</span>}
                hint={a.costTarget === "department" ? "department, not a job" : "financial owner"}
              />
              <Field label="Location" value={a.locationName ?? <span className="text-muted-foreground">—</span>} />
              <Field label="Condition" value={a.condition ?? "—"} />
              <Field label="Acquired" value={shortDate(a.acquisitionDate)} hint={money(a.acquisitionCost)} />
              <Field
                label="Warranty"
                value={a.warrantyExpiresOn ? shortDate(a.warrantyExpiresOn) : "—"}
                hint={a.warrantyExpiresOn ? `expires ${relative(a.warrantyExpiresOn)}` : undefined}
              />
            </dl>
            {a.owningProjectName && a.currentProjectName && a.owningProjectName !== a.currentProjectName ? (
              <p className="rounded-md border border-warn/30 bg-warn-bg px-3 py-2 text-sm text-warn">
                <strong>{a.owningProjectName}</strong> paid for this tool, but it is working on{" "}
                <strong>{a.currentProjectName}</strong>. That is allowed — financial ownership and
                operational custody are tracked separately — but it is worth knowing at cost-review time.
              </p>
            ) : null}
          </section>

          {/* The custody chain. */}
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-medium">Custody chain</h2>
              <span className="label-xs normal-case tracking-normal">
                append-only · this log is the audit trail
              </span>
            </div>

            {events.isLoading ? (
              <TableSkeleton rows={5} cols={3} />
            ) : events.isError ? (
              <ErrorNote message="The event history could not be loaded." />
            ) : !events.data?.length ? (
              <EmptyState
                title="No events recorded"
                description="This tool has no transactions yet, which usually means it was imported without an intake event."
              />
            ) : (
              <ol className="relative flex flex-col">
                <span aria-hidden className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
                {events.data.map((e) => (
                  <li key={String(e.id)} className="relative flex gap-4 py-3 pl-6">
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-[18px] size-[15px] rounded-full border-2 bg-background",
                        EVENT_TONE[e.eventType] ?? "border-muted-foreground",
                      )}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="label-xs text-foreground">{e.eventType.replace(/_/g, " ")}</span>
                        {e.refType ? (
                          <span className="text-xs text-muted-foreground">via {e.refType}</span>
                        ) : null}
                      </div>
                      {e.note ? <p className="text-sm text-pretty">{e.note}</p> : null}
                      <StateDelta from={e.fromState} to={e.toState} />
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-xs text-muted-foreground">{dateTime(e.occurredAt)}</div>
                      <div className="text-xs text-muted-foreground/70">{relative(e.occurredAt)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 bg-card p-4">
      <dt className="label-xs">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

type State = { status?: string; custodianId?: string | null; projectId?: string | null; locationId?: string | null } | null;

/* Shows what actually changed in an event rather than dumping both jsonb blobs. */
function StateDelta({ from, to }: { from: unknown; to: unknown }) {
  const f = (from ?? null) as State;
  const t = (to ?? null) as State;
  if (!t) return null;
  if (f?.status && t.status && f.status !== t.status) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <StatusPill status={f.status} />
        <span className="text-muted-foreground">→</span>
        <StatusPill status={t.status} />
      </div>
    );
  }
  if (t.status) return <StatusPill status={t.status} className="w-fit" />;
  return null;
}
