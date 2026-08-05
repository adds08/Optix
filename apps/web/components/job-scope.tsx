"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

/*
  Job scope — the jobs the signed-in user is allowed to see.

  Operations and the equipment desk group jobs into named buckets and assign
  those buckets to users. A user WITH group assignments only ever sees the
  jobs in their groups; the sidebar's job selector (the shadcn-account-selector
  pattern) is what picks between "all my groups" and one specific group. A user
  with NO assignments gets `projectIds: null`, which every consumer treats as
  "everything" — the desk keeps full access.

  Pages read the scope through `useJobScope()` and filter client-side; the
  selector itself lives in the sidebar.
*/

export type JobScopeValue = {
  /* Project ids visible to the user, or null when nothing restricts them. */
  projectIds: Set<string> | null;
  /* The groups the user belongs to — the selector's options. */
  groups: { id: string; name: string; description: string | null; projects: { id: string; name: string }[] }[];
  /* The selected group id; "" = all of the user's groups. */
  selectedGroup: string;
  setSelectedGroup: (id: string) => void;
  /* True while the user's assignments are still loading. */
  loading: boolean;
};

const STORAGE_KEY = "sti-job-group";

const JobScopeCtx = createContext<JobScopeValue>({
  projectIds: null,
  groups: [],
  selectedGroup: "",
  setSelectedGroup: () => {},
  loading: false,
});

export function useJobScope() {
  return useContext(JobScopeCtx);
}

export function JobScopeProvider({ children }: { children: React.ReactNode }) {
  const [selectedGroup, setSelectedGroupState] = useState("");
  const mine = trpc.projectGroup.mine.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
  });
  const groups = mine.data ?? [];

  /* A saved selection is only valid while it still names one of the user's
     groups; otherwise fall back to "all my groups". */
  useEffect(() => {
    if (mine.isLoading) return;
    let saved = "";
    try {
      saved = localStorage.getItem(STORAGE_KEY) ?? "";
    } catch {
      /* storage unavailable — default to all */
    }
    if (saved && groups.some((g) => g.id === saved)) setSelectedGroupState(saved);
  }, [mine.isLoading, groups]);

  const projectIds = useMemo(() => {
    if (!groups.length) return null;
    const ids = new Set<string>();
    for (const g of groups) {
      if (selectedGroup && g.id !== selectedGroup) continue;
      for (const p of g.projects) ids.add(p.id);
    }
    return ids;
  }, [groups, selectedGroup]);

  const setSelectedGroup = (id: string) => {
    setSelectedGroupState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const value: JobScopeValue = {
    projectIds,
    groups,
    selectedGroup,
    setSelectedGroup,
    loading: mine.isLoading,
  };

  return <JobScopeCtx.Provider value={value}>{children}</JobScopeCtx.Provider>;
}
