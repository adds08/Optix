"use client";

import { useState } from "react";
import { ChevronRight, FolderKanban, Pencil, Plus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useJobScope } from "@/components/job-scope";
import { usePermissions } from "@/components/use-permissions";
import { JobGroupModal, type JobGroupEditable } from "@/components/job-group-modal";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

/*
  The Job Groups column in the sidebar.

  Expanded (the "other column"): the group list, one row per group — click to
  scope the whole system to it — and a "New group" action for the equipment
  desk that opens the create/edit modal. Collapsed to icons, it is a single
  folder button that opens the same list.
*/

export function JobGroupsNav() {
  const { has } = usePermissions();
  const { setSelectedGroup } = useJobScope();
  const mine = trpc.projectGroup.mine.useQuery(undefined, { retry: false });
  /* Managers see every group; everyone else only their own. */
  const all = trpc.projectGroup.list.useQuery(undefined, {
    enabled: has("project.manage"),
    retry: false,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<JobGroupEditable | null>(null);

  /* One normalized row shape for both sources — `mine` has no user list, so
     managers get the full `list` shape and everyone else gets empty users. */
  const rows: {
    id: string;
    name: string;
    description: string | null;
    projects: { id: string; name: string }[];
    users: { id: string }[];
  }[] = has("project.manage")
    ? (all.data ?? []).map((g) => ({ ...g }))
    : (mine.data ?? []).map((g) => ({ ...g, users: [] }));

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (g: (typeof rows)[number]) => {
    setEditing({
      id: g.id,
      name: g.name,
      description: g.description,
      projectIds: g.projects.map((p) => p.id),
      userIds: g.users.map((u) => u.id),
    });
    setModalOpen(true);
  };

  return (
    <SidebarGroup>
      <JobGroupModal open={modalOpen} onClose={() => setModalOpen(false)} edit={editing} />
      <SidebarGroupLabel>Job Groups</SidebarGroupLabel>
      <SidebarMenu>
        <Collapsible asChild defaultOpen className="group/collapsible">
          <SidebarMenuItem>
            <CollapsibleTrigger asChild>
              <SidebarMenuButton tooltip="Job groups">
                <FolderKanban className="size-4" />
                <span>Job groups</span>
                <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
              </SidebarMenuButton>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarMenuSub>
                {rows.length === 0 ? (
                  <SidebarMenuSubItem>
                    <span className="px-2 py-1 text-xs text-muted-foreground">No groups yet</span>
                  </SidebarMenuSubItem>
                ) : (
                  rows.map((g) => (
                    <SidebarMenuSubItem key={g.id}>
                      <SidebarMenuSubButton asChild onClick={() => setSelectedGroup(g.id)}>
                        <button type="button" className="flex w-full items-center gap-1.5 text-left">
                          <span className="min-w-0 flex-1 truncate">{g.name}</span>
                          <span className="tnum text-xs text-muted-foreground">{g.projects.length}</span>
                        </button>
                      </SidebarMenuSubButton>
                      {has("project.manage") ? (
                        <SidebarMenuAction onClick={() => openEdit(g)} aria-label={`Edit ${g.name}`}>
                          <Pencil className="size-3.5" aria-hidden />
                        </SidebarMenuAction>
                      ) : null}
                    </SidebarMenuSubItem>
                  ))
                )}
                {has("project.manage") ? (
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton asChild onClick={openNew}>
                      <button type="button" className="flex w-full items-center gap-1.5 text-left text-primary">
                        <Plus className="size-3.5" aria-hidden />
                        New group
                      </button>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ) : null}
              </SidebarMenuSub>
            </CollapsibleContent>
          </SidebarMenuItem>
        </Collapsible>
      </SidebarMenu>
    </SidebarGroup>
  );
}
