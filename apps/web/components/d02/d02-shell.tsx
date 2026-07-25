"use client";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { clearSession } from "@/lib/auth";
import { usePermissions } from "@/components/use-permissions";
import type { Permission } from "@stinventory/types";
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton,
  SidebarGroup, SidebarGroupLabel, SidebarGroupContent,
  SidebarTrigger, SidebarInset, SidebarRail, useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  LayoutDashboard, Package, ArrowLeftRight, Truck, Users, ScrollText,
  LogOut, ClipboardCheck, ListChecks, Box,
} from "lucide-react";
import { AiChat } from "@/components/ai-chat";
import { ToastProvider } from "./d02-toast";

type NavItem = { href: string; label: string; icon: React.ReactNode; perm?: Permission };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { href: "/d02/dashboard", label: "Dashboard", icon: <LayoutDashboard /> },
    ],
  },
  {
    label: "Equipment",
    items: [
      { href: "/d02/assets", label: "Asset Register", icon: <Package />, perm: "asset.read" },
      { href: "/d02/assignments", label: "Assignments", icon: <ArrowLeftRight />, perm: "assignment.read" },
      { href: "/d02/vehicles", label: "Vehicles", icon: <Truck />, perm: "vehicle.read" },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/d02/foremen", label: "Foremen", icon: <Users />, perm: "employee.read" },
      { href: "/d02/audit", label: "Audit Trail", icon: <ScrollText />, perm: "audit.read" },
      { href: "/d02/verification", label: "Verification", icon: <ClipboardCheck />, perm: "assignment.read" },
      { href: "/d02/tasks", label: "Tasks", icon: <ListChecks />, perm: "assignment.read" },
    ],
  },
];

const ALL_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

function getSession() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("sti-session");
}

function TeamSwitcher() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Box className="size-4" />
          </div>
          <div className="flex flex-col gap-0.5 leading-none">
            <span className="font-semibold">STInventory</span>
            <span className="text-xs text-sidebar-foreground/60">Equipment Management</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavMain() {
  const router = useRouter();
  const pathname = usePathname();
  const { has } = usePermissions();
  const { setOpenMobile } = useSidebar();

  const navTo = (href: string) => {
    router.push(href);
    setOpenMobile(false);
  };

  return (
    <>
      {NAV_GROUPS.map((group) => {
        const visible = group.items.filter((n) => !n.perm || has(n.perm));
        if (visible.length === 0) return null;
        return (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {visible.map((n) => (
                  <SidebarMenuItem key={n.href}>
                    <SidebarMenuButton
                      isActive={pathname === n.href}
                      onClick={() => navTo(n.href)}
                      tooltip={n.label}
                    >
                      {n.icon}
                      <span>{n.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}
    </>
  );
}

function NavUser({ who, doLogout }: { who: string; doLogout: () => void }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <div className="flex items-center gap-2 px-1 py-1.5 group-data-[collapsible=icon]:justify-center">
          <Avatar className="h-8 w-8 rounded-lg shrink-0">
            <AvatarFallback className="rounded-lg">
              {who?.split(" ")[0]?.[0] ?? "U"}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate font-semibold">{who || "Loading\u2026"}</span>
            <span className="truncate text-xs text-sidebar-foreground/60">Equipment Admin</span>
          </div>
        </div>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={doLogout} tooltip="Sign out">
          <LogOut />
          <span>Sign out</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function D02Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [who, setWho] = useState("");
  const me = trpc.identity.me.useQuery();
  const notifications = trpc.notification.list.useQuery(undefined, { refetchInterval: 30_000 });
  const unread = notifications.data?.filter((n) => !n.readAt).length ?? 0;

  useEffect(() => {
    if (!getSession()) { router.replace("/"); return; }
    if (me.data) setWho(`${me.data.firstName} ${me.data.lastName}`);
    if (me.error?.data?.code === "UNAUTHORIZED") { clearSession(); router.replace("/"); }
  }, [me.data, me.error, router]);

  const doLogout = async () => {
    const { logout } = await import("@/lib/auth");
    await logout(); clearSession(); router.replace("/");
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <TeamSwitcher />
        </SidebarHeader>
        <SidebarContent>
          <NavMain />
        </SidebarContent>
        <SidebarFooter>
          <NavUser who={who} doLogout={doLogout} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <span className="text-sm font-medium">
            {ALL_NAV.find((n) => pathname?.startsWith(n.href))?.label ?? "STInventory"}
          </span>
          {unread > 0 && (
            <Badge className="ml-auto rounded-full px-2 text-xs" variant="secondary">
              {unread}
            </Badge>
          )}
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4">
          <ToastProvider>{children}</ToastProvider>
        </div>
      </SidebarInset>
      <AiChat />
    </SidebarProvider>
  );
}
