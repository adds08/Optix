"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { clearSession, getSession, logout } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  The app shell on the shadcn sidebar-07 skeleton.

  The frame is the viewport. The shell is exactly one screen tall and does not
  scroll; inside it, the rail and the content column are two full-height
  columns, and the ONLY thing that scrolls is the page region under the top
  bar. That is the whole layout contract, and it is what the earlier
  document-scrolling version could not hold: with the page scrolling the
  document, a `sticky` top bar rode up over the shell's own margin and the
  sidebar-coloured canvas showed through behind it, so the header, the page
  and the background all appeared to come apart on the way down.

  Consequences worth knowing before changing anything here:

    - the top bar is a plain flex row, not `sticky`. It cannot desynchronise
      from the content because it is never in the same scroll box.
    - a dialog opening no longer shifts the page. Radix locks the document's
      scroll, and the document has none to lock.
    - `sticky top-*` inside a page still works — it resolves against the
      scroll region, so page-level sticky asides need no header offset.
    - anything that wants to fill the screen should size against its parent
      (`h-full`), not against `vh`, which does not know about the top bar.

  SidebarProvider owns the rail (collapse-to-icons, phone sheet, persisted
  state). The rail carries the system-wide job selector at its head and the
  role's navigation; the top bar carries page context, search, notifications,
  theme and the account menu.
*/

export function AppShell({
  defaultSidebarOpen = true,
  children,
}: {
  /* Read from the sidebar cookie on the server so a collapsed rail renders
     collapsed instead of expanding and then snapping shut on hydration. */
  defaultSidebarOpen?: boolean;
  children: React.ReactNode;
}) {
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

  /* Theme: hydrate dark mode + prefs, then apply on change (the store, not
     the query, drives the apply — see the effect notes below). */
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
    <SidebarProvider defaultOpen={defaultSidebarOpen} className="h-dvh overflow-hidden">
      <WorkingBar />
      <AppSidebar userRole={role} permissions={perms} inboxCount={inboxCount} />
      <SidebarInset>
        {/* Top bar — page context, search, notifications, account. h-14 is
            shared with the rail's header so the two bottom borders meet as a
            single line across the shell. */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 lg:px-6">
          <SidebarTrigger className="-ml-1.5" />
          <span className={cn("truncate text-sm font-medium", pathname === "/home" && "hidden")}>
            {current?.label ?? "STInventory"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {!field ? <GlobalSearch /> : null}
            <NotificationCenter />
            <ThemeToggle />
            {me.data ? (
              <UserMenu name={userName} role={me.data.role} onSignOut={onLogout} />
            ) : null}
          </div>
        </header>

        {/* The one scroll region. min-h-0 lets it actually shrink to the space
            the header leaves — without it a flex child refuses to go below its
            content height and the overflow escapes to the document again. */}
        <div className="sti-scroll min-h-0 flex-1">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </div>
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
