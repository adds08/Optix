"use client";

import { useMemo, useState } from "react";
import { HardHat } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { Button } from "@/components/ui/button";
import { StatusPill, Tag } from "@/components/sti/status";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { idName } from "@/lib/format";
import { ProjectForm, type ProjectEditable } from "@/components/project-form";
import { useJobScope } from "@/components/job-scope";
import { RowActions } from "@/components/sti/row-actions";
import { shortDate } from "@/lib/format";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";

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
  const { projectIds: scopeProjects, setSelectedGroup, setSelectedProject } = useJobScope();
  const rows = (projects.data ?? []).filter((p) =>
    scopeProjects ? scopeProjects.has(p.id) : true,
  );
  /*
    UI-74: "after creating a new project, the project does not appear in the
    list". The create works and the list refetches — the row is filtered out
    HERE, because a brand-new job belongs to no job group and the scope
    selection persists in localStorage across reloads.

    Filtering is not the bug; doing it silently is. Worse, an empty result fell
    through to "No projects yet", which is a flat untruth when the register
    holds sixteen jobs and the scope is hiding all of them — so the one screen
    that could have explained the disappearance asserted the opposite instead.
  */
  const hiddenByScope = (projects.data?.length ?? 0) - rows.length;
  const clearScope = () => {
    setSelectedGroup("");
    setSelectedProject("");
  };

  type Row = (typeof rows)[number];

  const TABLE_COLUMNS: ColumnDef<Row>[] = useMemo(
    () => [
      col<Row>({
        header: "Job",
        accessorFn: (p) => idName(p.externalId, p.name),
        cell: (p) => <span className="font-medium">{idName(p.externalId, p.name)}</span>,
      }),
      col<Row>({
        header: "Job ID",
        accessorFn: (p) => p.externalId ?? "",
        width: "6rem",
        cell: (p) => (p.externalId ? <Tag>{p.externalId}</Tag> : <Muted />),
      }),
      col<Row>({
        header: "Site",
        accessorFn: (p) => p.siteAddress ?? "",
        cell: (p) => <span className="truncate block">{p.siteAddress ?? <Muted />}</span>,
      }),
      col<Row>({
        header: "Cost center",
        accessorFn: (p) => p.costCenter ?? "",
        width: "8rem",
        cell: (p) => p.costCenter ?? <Muted />,
      }),
      col<Row>({
        header: "Started",
        accessorFn: (p) => p.startDate ?? "",
        width: "7rem",
        cell: (p) => (p.startDate ? shortDate(p.startDate) : <Muted />),
      }),
      col<Row>({
        header: "Status",
        accessorFn: (p) => p.status,
        width: "7rem",
        cell: (p) => <StatusPill status={p.status} className="text-xs" />,
      }),
      col<Row>({
        id: "actions",
        header: "",
        sortable: false,
        /* Edit + delete, and the wider "Keep / Delete" pair once the delete
           confirmation opens. At 3rem the buttons overflowed the cell and their
           opaque backgrounds covered the status pill next door. */
        width: "10rem",
        cell: (p) => (
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
        ),
      }),
    ],
    [remove.isPending, failed],
  );

  return (
    <div className="flex flex-col gap-6">
      {editing ? <ProjectForm open onClose={() => setEditing(null)} edit={editing} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <HardHat className="size-4 text-muted-foreground" aria-hidden />
          Projects / Jobs
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <ImportButton entity="project" />
          <CreateAction perm="project.manage" label="New project" Form={ProjectForm} />
        </div>
      </div>
      {projects.isLoading ? (
        <TableSkeleton />
      ) : projects.isError ? (
        <ErrorNote message="Projects could not be loaded. Check that the API is running, then reload." />
      ) : !rows.length ? (
        hiddenByScope > 0 ? (
          <EmptyState
            icon={HardHat}
            title="No jobs match the current scope"
            description={`${hiddenByScope} ${hiddenByScope === 1 ? "job is" : "jobs are"} hidden by the job scope you have selected. A job you have just created belongs to no group yet, so it will not appear until you show all projects.`}
            action={<Button onClick={clearScope}>Show all projects</Button>}
          />
        ) : (
          <EmptyState
            icon={HardHat}
            title="No projects yet"
            description="Add the projects you run, or bring them across from a spreadsheet."
          />
        )
      ) : (
        <>
          {hiddenByScope > 0 ? (
            <p className="text-xs text-muted-foreground">
              {hiddenByScope} {hiddenByScope === 1 ? "job is" : "jobs are"} hidden by the current job
              scope.{" "}
              <button type="button" onClick={clearScope} className="underline underline-offset-2">
                Show all projects
              </button>
            </p>
          ) : null}
          <DataTable<Row>
            mode="client"
            columns={TABLE_COLUMNS}
            rows={rows}
            rowId={(p) => p.id}
            searchPlaceholder="Search jobs…"
          />
        </>
      )}
    </div>
  );
}

function Muted() {
  return <span className="text-muted-foreground">—</span>;
}
