"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, HardHat } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState, TableWrap } from "@/components/sti/page";
import { StatusPill, Tag, humanize } from "@/components/sti/status";
import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { PostingForm } from "@/components/posting-form";
import { Skeleton } from "@/components/ui/skeleton";
import { money, shortDate } from "@/lib/format";

/*
  One person: what they are holding right now, and every job they have held it on.

  This is the screen the custody model was built for. Because tools follow the
  foreman rather than the site, the answer to "what was working on Legacy West
  in March?" is not stored anywhere — it is this posting history crossed with
  the tools in this person's custody. Putting both on one page is what makes
  that reconstruction a glance instead of a query.
*/
export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const person = trpc.employee.get.useQuery({ id });
  const postings = trpc.employee.postings.useQuery({ employeeId: id });
  const held = trpc.asset.list.useQuery({ custodianId: id });
  const [moving, setMoving] = useState(false);

  const p = person.data;
  const tools = held.data ?? [];
  const value = tools.reduce((sum, t) => sum + Number(t.acquisitionCost ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/people"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        People
      </Link>

      {person.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-5 w-96" />
        </div>
      ) : person.isError ? (
        <ErrorNote message="This person could not be loaded. Check that the API is running, then reload." />
      ) : !p ? (
        <EmptyState
          title="No such person"
          description="This record does not exist in your tenant, or it was removed."
          action={
            <Link href="/people" className="text-sm font-medium text-primary hover:underline">
              Back to People
            </Link>
          }
        />
      ) : (
        <>
          <PageHeader
            eyebrow={humanize(p.role)}
            title={p.name}
            description={
              p.externalId ? `Employee ${p.externalId}` : undefined
            }
            actions={
              <div className="flex flex-wrap items-center gap-3">
                <Can perm="employee.manage">
                  <Button size="sm" onClick={() => setMoving(true)}>
                    <HardHat className="size-4" aria-hidden />
                    Move to a project
                  </Button>
                </Can>
                <StatusPill status={p.employmentStatus} className="text-xs" />
              </div>
            }
          />
          {moving ? (
            <PostingForm
              open={moving}
              onClose={() => setMoving(false)}
              employeeId={id}
              employeeName={p.name}
              currentProjectId={p.primaryProjectId}
            />
          ) : null}

          <dl className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 lg:grid-cols-4">
            <Field
              label="On project"
              value={p.primaryProjectName ?? <span className="text-muted-foreground">unposted</span>}
            />
            <Field label="Reports to" value={p.reportsToName ?? <span className="text-muted-foreground">—</span>} />
            <Field label="Tools held" value={held.isLoading ? "…" : String(tools.length)} />
            <Field
              label="Value held"
              value={held.isLoading ? "…" : money(value)}
              hint="sum of acquisition cost"
            />
          </dl>

          {p.employmentStatus === "terminated" && tools.length ? (
            <p className="rounded-md border border-crit/30 bg-crit-bg px-3 py-2 text-sm text-crit">
              This person is terminated and still holds {tools.length}{" "}
              {tools.length === 1 ? "tool" : "tools"}. Each must be returned, transferred, or
              marked lost before offboarding can be signed off.
            </p>
          ) : null}

          {/* What they hold now. */}
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium">In their custody</h2>
            {held.isLoading ? (
              <TableSkeleton cols={5} />
            ) : held.isError ? (
              <ErrorNote message="Their tools could not be loaded." />
            ) : !tools.length ? (
              <EmptyState icon={Boxes} title="Holding nothing" description="No tool in the register names this person as custodian." />
            ) : (
              <TableWrap>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {["Tag", "Model", "On project", "Charged to", "Status", "Value"].map((h, i) => (
                        <th key={h} className={`label-xs px-4 py-2.5 ${i === 5 ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tools.map((t) => (
                      <tr key={t.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2.5">
                          <Link href={`/tools/${t.id}`} className="hover:underline">
                            <Tag>{t.tag}</Tag>
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 font-medium">{t.modelName}</td>
                        <td className="px-4 py-2.5">{t.currentProjectName ?? "—"}</td>
                        {/* Who paid. Unchanged by every move on this page. */}
                        <td className="px-4 py-2.5 text-muted-foreground">{t.owningProjectName ?? "—"}</td>
                        <td className="px-4 py-2.5"><StatusPill status={t.status} /></td>
                        <td className="px-4 py-2.5 text-right tnum">{money(t.acquisitionCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </section>

          {/* Where they have been. */}
          <section className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-medium">Job history</h2>
              <span className="label-xs normal-case tracking-normal">
                what their tools were charged against, and when
              </span>
            </div>
            {postings.isLoading ? (
              <TableSkeleton rows={3} cols={4} />
            ) : postings.isError ? (
              <ErrorNote message="The job history could not be loaded." />
            ) : !postings.data?.length ? (
              <EmptyState
                icon={HardHat}
                title="No postings recorded"
                description="Their job history starts the first time they are moved through this screen."
              />
            ) : (
              <TableWrap>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      {["Project", "Cost code", "From", "To", "Note"].map((h) => (
                        <th key={h} className="label-xs px-4 py-2.5 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {postings.data.map((row) => (
                      <tr key={row.id} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="px-4 py-2.5 font-medium">{row.projectName ?? "—"}</td>
                        <td className="px-4 py-2.5">{row.projectExternalId ? <Tag>{row.projectExternalId}</Tag> : "—"}</td>
                        <td className="px-4 py-2.5">{shortDate(row.startedOn)}</td>
                        <td className="px-4 py-2.5">
                          {row.endedOn ? shortDate(row.endedOn) : <span className="text-ok">current</span>}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{row.note ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-card p-4">
      <dt className="label-xs">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}
