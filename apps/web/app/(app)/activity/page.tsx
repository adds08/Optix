"use client";

import { trpc } from "@/lib/trpc";
import { TableSkeleton, ErrorNote } from "@/components/sti/page";
import { JobsiteActivity } from "@/components/jobsite-activity";

/*
  The live tool-movement feed, on its own page.

  It used to share the Tools by Jobsite rail, where it squeezed the jobsite
  cards and could be collapsed away. On its own it gets the full width, the
  whole feed at once, and a site filter to watch one job.
*/
export default function ActivityPage() {
  const projects = trpc.project.list.useQuery();
  const options = (projects.data ?? []).map((p) => ({ id: p.id, name: p.name }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Activity</h1>
      {projects.isLoading ? (
        <TableSkeleton cols={1} />
      ) : projects.isError ? (
        <ErrorNote message="Activity could not be loaded. Check that the API is running, then reload." />
      ) : (
        <JobsiteActivity projectOptions={options} />
      )}
    </div>
  );
}
