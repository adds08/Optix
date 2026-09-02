"use client";

import { useMemo, useState } from "react";
import { HardHat } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { trpc } from "@/lib/trpc";
import { PageHeader, TableSkeleton, ErrorNote, EmptyState } from "@/components/sti/page";
import { Button } from "@/components/ui/button";
import { StatusPill, Tag } from "@/components/sti/status";
import { CreateAction } from "@/components/sti/create-action";
import { ImportButton } from "@/components/import-dialog";
import { ProjectForm, type ProjectEditable } from "@/components/project-form";
import { useJobScope } from "@/components/job-scope";
import { RowActions } from "@/components/sti/row-actions";
import { shortDate } from "@/lib/format";
import { DataTable } from "@/components/sti/data-table/data-table";
import { col } from "@/components/sti/data-table/columns";

/*
  The projects tools get charged to.

  `externalId` is the code FoundationSoft knows a project by. It is shown
  as a tag rather than buried, because reconciling equipment cost against the
  accounting system is the whole reason the column exists.
*/
export default function ProjectsPage() {
  const [editing, setEditing] = useState<ProjectEditable | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  /* No bulk action reads this yet — turned on for consistency with the other
     registers, which all now offer a checkbox whether or not anything acts
     on the selection. */
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
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
        header: "Project Code",
        accessorFn: (p) => p.externalId ?? "",
        width: "8rem",
        cell: (p) => (p.externalId ? <Tag>{p.externalId}</Tag> : <Muted />),
      }),
      col<Row>({
        header: "Project",
        accessorFn: (p) => p.name,
        cell: (p) => <span className="font-medium">{p.name}</span>,
      }),
      col<Row>({
        header: "Site",
        accessorFn: (p) => p.siteAddress ?? "",
        cell: (p) => <span className="truncate block">{p.siteAddress ?? <Muted />}</span>,
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
        header: "Actions",
        sortable: false,
        stickyRight: true,
        /* One trigger. The 10rem here was sized for Edit + delete plus the
           wider "Keep / Delete" pair the old inline confirmation swapped in;
           the confirmation now happens inside the menu, so nothing in this
           cell changes width when it opens. */
        width: "5rem",
        cell: (p) => (
          <RowActions
            perm="project.manage"
            label={p.name}
            onEdit={() =>
              setEditing({
                id: p.id,
                name: p.name,
                externalId: p.externalId,
                description: p.description,
                status: p.status,
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
    <div className="flex flex-col gap-4">
      {editing ? <ProjectForm open onClose={() => setEditing(null)} edit={editing} /> : null}
      <PageHeader
        icon={HardHat}
        title="Projects"
        hideTitle
        description="The jobs tools and people are assigned to, and what gets charged against them."
        actions={
          <>
            <ImportButton entity="project" />
            <CreateAction perm="project.manage" label="New project" Form={ProjectForm} />
          </>
        }
      />
      {projects.isLoading ? (
        <TableSkeleton />
      ) : projects.isError ? (
        <ErrorNote message="Projects could not be loaded. Check that the API is running, then reload." />
      ) : !rows.length ? (
        hiddenByScope > 0 ? (
          <EmptyState
            icon={HardHat}
            title="No projects match the current scope"
            description={`${hiddenByScope} ${hiddenByScope === 1 ? "project is" : "projects are"} hidden by the job scope you have selected. A project you have just created belongs to no group yet, so it will not appear until you show all projects.`}
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
              {hiddenByScope} {hiddenByScope === 1 ? "project is" : "projects are"} hidden by the current job
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
            searchPlaceholder="Search projects…"
            enableSelection
            selection={selectedIds}
            onSelectionChange={setSelectedIds}
          />
        </>
      )}
    </div>
  );
}

function Muted() {
  return <span className="text-muted-foreground">—</span>;
}
