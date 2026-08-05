"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { clearSession, getSession, logout } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationCenter } from "@/components/notification-center";
import { UserMenu } from "@/components/user-menu";
import { GlobalSearch } from "@/components/global-search";
import { WorkingBar } from "@/components/working-bar";
import { useThemeStore } from "@/lib/themes/store";
import { applyTheme } from "@/lib/themes/apply-theme";
import { DEFAULT_PREFS, type ThemePrefs } from "@/lib/themes/themes";
import { allItems, isFieldRole } from "./nav-config";

/*
  The app shell, reshaped on shadcn's dashboard-01 skeleton.

  SidebarProvider owns the rail: collapse-to-icons on a desk layout, a sheet on
  a phone, state persisted — all from the shared Sidebar primitive. The rail
  carries the system-wide project switcher at its head, the role's navigation,
  and the signed-in user at its foot. The inset holds the sticky header (page
  label, search, notifications, theme, account) and the page itself.
*/

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  /* Guard: no session, no app. Runs before any query fires. */
  useEffect(() => {
    if (!getSession()) router.replace("/");
    else setReady(true);
  }, [router]);

  const me = trpc.identity.me.useQuery(undefined, { enabled: ready, retry: false });
  const prefs = trpc.preferences.get.useQuery(undefined, { enabled: ready });
  /* Sidebar badge — the queue count the bell shows, mirrored on the nav row. */
  const notif = trpc.dashboard.notifications.useQuery(undefined, { enabled: ready, refetchInterval: 15_000 });
  const inboxCount = notif.data?.unread ?? 0;

  /* Theme: hydrate dark mode + prefs, then apply on change (see the effect
     notes below — the store, not the query, drives the apply). */
  const dark = useThemeStore((s) => s.dark);
  const setDark = useThemeStore((s) => s.setDark);
  const setPrefs = useThemeStore((s) => s.setPrefs);
  const storePrefs = useThemeStore((s) => s.prefs);

  useEffect(() => {
    const saved = localStorage.getItem("sti-theme");
    const prefers = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(saved ? saved === "dark" : prefers);
  }, [setDark]);

  useEffect(() => {
    if (prefs.data) setPrefs(prefs.data as ThemePrefs);
  }, [prefs.data, setPrefs]);

  useEffect(() => {
    applyTheme(storePrefs ?? DEFAULT_PREFS, dark);
  }, [storePrefs, dark]);

  useEffect(() => {
    if (me.isError) {
      clearSession();
      router.replace("/");
    }
  }, [me.isError, router]);

  const role = me.data?.role ?? null;
  const perms = me.data?.permissions ?? [];
  const field = isFieldRole(role);
  const current = allItems(role).find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));
  const userName = `${me.data?.firstName ?? ""} ${me.data?.lastName ?? ""}`.trim();

  async function onLogout() {
    try {
      await logout();
    } finally {
      clearSession();
      router.replace("/");
    }
  }

  if (!ready) return null;

  return (
    <SidebarProvider>
      <WorkingBar />
      <AppSidebar
        userRole={role}
        permissions={perms}
        inboxCount={inboxCount}
        userName={userName || "STInventory"}
        onSignOut={onLogout}
        variant="inset"
      />
      <SidebarInset>
        {/* Sticky top bar — page context, search, notifications, account. */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur lg:px-6">
          <SidebarTrigger className="-ml-1" />
          <span className={cn("truncate text-sm font-medium", pathname === "/home" && "hidden")}>
            {current?.label ?? "STInventory"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {!field ? <GlobalSearch /> : null}
            <NotificationCenter />
            <ThemeToggle />
            {me.data ? (
              <UserMenu
                name={userName}
                role={me.data.role}
                onSignOut={onLogout}
              />
            ) : null}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 pb-24 lg:px-8 lg:py-8">
          {me.isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            children
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function ThemeToggle() {
  const dark = useThemeStore((s) => s.dark);
  const setDark = useThemeStore((s) => s.setDark);

  function toggle() {
    const on = !dark;
    setDark(on);
    document.documentElement.classList.toggle("dark", on);
    localStorage.setItem("sti-theme", on ? "dark" : "light");
  }

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
