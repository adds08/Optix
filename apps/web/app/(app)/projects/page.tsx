"use client";

import { useState } from "react";
import { HardHat } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote, EmptyState, TableWrap } from "@/components/sti/page";
import { StatusPill, Tag } from "@/components/sti/status";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { BottomToolbar } from "@/components/bottom-toolbar";
import { idName } from "@/lib/format";
import { ProjectForm, type ProjectEditable } from "@/components/project-form";
import { useJobScope } from "@/components/job-scope";
import { RowActions } from "@/components/sti/row-actions";
import { shortDate } from "@/lib/format";

/*
  The job sites tools get charged to.

  `externalId` is the cost code FoundationSoft knows a project by. It is shown
  as a tag rather than buried, because reconciling equipment cost against the
  accounting system is the whole reason the column exists.
*/
export default function ProjectsPage() {
  const [editing, setEditing] = useState<ProjectEditable | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const utils = trpc.useUtils();

  const remove = trpc.project.delete.useMutation({
    onSuccess: () => {
      setFailed(null);
      utils.project.list.invalidate();
    },
    onError: (e, vars) => setFailed({ id: vars.id, message: e.message }),
  });

  const projects = trpc.project.list.useQuery();
  /* A scoped user only sees the jobs in their groups. */
  const { projectIds: scopeProjects } = useJobScope();
  const rows = (projects.data ?? []).filter((p) =>
    scopeProjects ? scopeProjects.has(p.id) : true,
  );

  return (
    <div className="flex flex-col gap-6">
      {editing ? <ProjectForm open onClose={() => setEditing(null)} edit={editing} /> : null}
      {projects.isLoading ? (
        <TableSkeleton />
      ) : projects.isError ? (
        <ErrorNote message="Projects could not be loaded. Check that the API is running, then reload." />
      ) : !rows.length ? (
        <EmptyState
          icon={HardHat}
          title="No projects yet"
          description="Add the projects you run, or bring them across from a spreadsheet."
        />
      ) : (
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="px-4 py-2.5 font-medium">Job</th>
                <th className="px-4 py-2.5 font-medium">Job ID</th>
                <th className="px-4 py-2.5 font-medium">Site</th>
                <th className="px-4 py-2.5 font-medium">Cost center</th>
                <th className="px-4 py-2.5 font-medium">Started</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2.5 font-medium">{idName(p.externalId, p.name)}</td>
                  <td className="px-4 py-2.5">
                    {p.externalId ? <Tag>{p.externalId}</Tag> : <Muted />}
                  </td>
                  <td className="max-w-[22ch] truncate px-4 py-2.5" title={p.siteAddress ?? undefined}>
                    {p.siteAddress ?? <Muted />}
                  </td>
                  <td className="px-4 py-2.5">{p.costCenter ?? <Muted />}</td>
                  <td className="px-4 py-2.5">{p.startDate ? shortDate(p.startDate) : <Muted />}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill status={p.status} className="text-xs" />
                  </td>
                  <td className="px-4 py-2.5">
                    <RowActions
                      perm="project.manage"
                      label={p.name}
                      onEdit={() =>
                        setEditing({
                          id: p.id,
                          name: p.name,
                          externalId: p.externalId,
                          status: p.status,
                          costCenter: p.costCenter,
                          siteAddress: p.siteAddress,
                          startDate: p.startDate,
                          endDate: p.endDate,
                        })
                      }
                      onDelete={() => remove.mutate({ id: p.id })}
                      deleting={remove.isPending}
                      error={failed?.id === p.id ? failed.message : null}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}

      <BottomToolbar>
        <ImportButton entity="project" />
        <CreateAction perm="project.manage" label="New project" Form={ProjectForm} />
      </BottomToolbar>
    </div>
  );
}

function Muted() {
  return <span className="text-muted-foreground">—</span>;
}
