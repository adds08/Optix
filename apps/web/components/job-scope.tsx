"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { trpc, retryUnlessUnauthorized } from "@/lib/trpc";

/*
  Job scope — the jobs the signed-in user is looking at, system-wide.

  The sidebar's job selector at the top of the rail drives it. Three levels:
    - Show All      — everything the server lets this user see
    - a job group   — the jobs in that group
    - one job       — just that project

  What the user may see at all is decided server-side (visibleProjectScope on
  project.list): owners and the equipment department see every project; a
  scoped user sees the union of their job groups and the projects their
  project_team_member row names. The client filter below only narrows a list
  the API already scoped — it cannot widen it.
  Every page reads `projectIds` through `useJobScope()` and filters client-side,
  so the selection applies everywhere at once.
*/

export type JobProject = { id: string; name: string; externalId: string | null };
export type JobGroup = {
  id: string;
  name: string;
  description: string | null;
  projects: JobProject[];
};

export type JobScopeValue = {
  /* Project ids visible right now, or null when nothing is restricted. */
  projectIds: Set<string> | null;
  /* The user's job groups — the selector's group options. */
  groups: JobGroup[];
  /* Every project — the selector's flat options when there are no groups. */
  projects: JobProject[];
  selectedGroup: string;
  setSelectedGroup: (id: string) => void;
  selectedProject: string;
  setSelectedProject: (id: string) => void;
  loading: boolean;
};

const GROUP_KEY = "sti-job-group";
const PROJECT_KEY = "sti-job-project";

const JobScopeCtx = createContext<JobScopeValue>({
  projectIds: null,
  groups: [],
  projects: [],
  selectedGroup: "",
  setSelectedGroup: () => {},
  selectedProject: "",
  setSelectedProject: () => {},
  loading: false,
});

export function useJobScope() {
  return useContext(JobScopeCtx);
}

export function JobScopeProvider({ children }: { children: React.ReactNode }) {
  const [selectedGroup, setSelectedGroupState] = useState("");
  const [selectedProject, setSelectedProjectState] = useState("");
  /* These two are what the saved selection is validated against below. Giving
     up on the first failure left both lists empty, so a stored group or project
     matched nothing and the session silently fell back to Show All — every
     page unfiltered, from one dropped request. The stored value survives (only
     the setters write), so it comes back on a load that succeeds; retrying
     means the user does not watch their scope evaporate in the meantime.
     Not a security question — the server scopes every read on its own. */
  const mine = trpc.projectGroup.mine.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: retryUnlessUnauthorized,
  });
  const projectsQuery = trpc.project.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: retryUnlessUnauthorized,
  });
  const groups = mine.data ?? [];
  const projects = projectsQuery.data ?? [];

  /* A saved selection is only valid while it still names something real;
     otherwise fall back to Show All. */
  useEffect(() => {
    if (mine.isLoading || projectsQuery.isLoading) return;
    let g = "";
    let p = "";
    try {
      g = localStorage.getItem(GROUP_KEY) ?? "";
      p = localStorage.getItem(PROJECT_KEY) ?? "";
    } catch {
      /* storage unavailable — default to all */
    }
    if (g && groups.some((x) => x.id === g)) setSelectedGroupState(g);
    if (p && projects.some((x) => x.id === p)) setSelectedProjectState(p);
  }, [mine.isLoading, projectsQuery.isLoading, groups, projects]);

  const projectIds = useMemo(() => {
    if (selectedProject) return new Set([selectedProject]);
    if (selectedGroup) {
      const g = groups.find((x) => x.id === selectedGroup);
      return new Set((g?.projects ?? []).map((p) => p.id));
    }
    return null;
  }, [selectedProject, selectedGroup, groups]);

  const setSelectedGroup = (id: string) => {
    setSelectedGroupState(id);
    if (id) setSelectedProjectState("");
    try {
      localStorage.setItem(GROUP_KEY, id);
      if (id) localStorage.removeItem(PROJECT_KEY);
    } catch {
      /* ignore */
    }
  };

  const setSelectedProject = (id: string) => {
    setSelectedProjectState(id);
    if (id) setSelectedGroupState("");
    try {
      localStorage.setItem(PROJECT_KEY, id);
      if (id) localStorage.removeItem(GROUP_KEY);
    } catch {
      /* ignore */
    }
  };

  const value: JobScopeValue = {
    projectIds,
    groups,
    projects,
    selectedGroup,
    setSelectedGroup,
    selectedProject,
    setSelectedProject,
    loading: mine.isLoading || projectsQuery.isLoading,
  };

  return <JobScopeCtx.Provider value={value}>{children}</JobScopeCtx.Provider>;
}
