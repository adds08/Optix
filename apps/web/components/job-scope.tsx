"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

/*
  Job scope — the jobs the signed-in user is looking at, system-wide.

  The sidebar's job selector at the top of the rail drives it. Three levels:
    - Show All      — nothing restricted (projectIds: null, everything passes)
    - a job group   — the jobs in that group
    - one job       — just that project

  Users with job-group assignments are additionally confined to their groups'
  jobs even under Show All; a user with no assignments sees every project.
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
  const mine = trpc.projectGroup.mine.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
  });
  const projectsQuery = trpc.project.list.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
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
