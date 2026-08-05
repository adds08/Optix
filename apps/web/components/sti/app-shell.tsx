"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { clearSession, getSession, logout } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NotificationCenter } from "@/components/notification-center";
import { UserMenu } from "@/components/user-menu";
import { GlobalSearch } from "@/components/global-search";
import { WorkingBar } from "@/components/working-bar";
import { useThemeStore } from "@/lib/themes/store";
import { applyTheme } from "@/lib/themes/apply-theme";
import { DEFAULT_PREFS, type ThemePrefs } from "@/lib/themes/themes";
import { allItems, isFieldRole, navFor } from "./nav-config";
import { JobGroupSelector } from "@/components/job-group-selector";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  /* Guard: no session, no app. Runs before any query fires. */
  useEffect(() => {
    if (!getSession()) router.replace("/");
    else setReady(true);
  }, [router]);

  const me = trpc.identity.me.useQuery(undefined, { enabled: ready, retry: false });
  const prefs = trpc.preferences.get.useQuery(undefined, { enabled: ready });
  /* Sidebar badge — the queue count the bell shows, mirrored on the nav row so
     "there is something in the inbox" survives a glance at the rail. */
  const notif = trpc.dashboard.notifications.useQuery(undefined, { enabled: ready, refetchInterval: 15_000 });
  const inboxCount = notif.data?.unread ?? 0;

  /* Theme: hydrate dark mode from storage/preference, hydrate prefs from the
     server row, then apply whenever either changes.

     The apply effect reads the STORE, not the query — the settings page
     previews by writing the store, and an effect keyed on the query result
     would never see those writes. The query only hydrates the store once. */
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
    /* Fall back to defaults before the preference row arrives, so the engine
       never flashes un-themed. */
    applyTheme(storePrefs ?? DEFAULT_PREFS, dark);
  }, [storePrefs, dark]);

  useEffect(() => {
    if (me.isError) {
      clearSession();
      router.replace("/");
    }
  }, [me.isError, router]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const role = me.data?.role ?? null;
  const perms = me.data?.permissions ?? [];
  const groups = navFor(role);
  const field = isFieldRole(role);
  const current = allItems(role).find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));

  /* Collapsible rail (docs/20, A2): a desk person on a 1400px layout gains
     ~180px of table width by folding the labels away. Desktop-only state —
     a phone drawer is always expanded. */
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    if (window.innerWidth < 1024) return;
    setCollapsed(localStorage.getItem("sti-sidebar") === "collapsed");
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem("sti-sidebar", c ? "expanded" : "collapsed");
      return !c;
    });
  };

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
    <div className="flex min-h-svh bg-background">
      <WorkingBar />
      {/* ---- rail ---- */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r bg-sidebar text-sidebar-foreground",
          "transition-[width,transform] duration-200 lg:translate-x-0",
          collapsed ? "w-16" : "w-[248px]",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className={cn("flex h-14 items-center border-b border-sidebar-border", collapsed ? "justify-center px-2" : "justify-between px-4")}>
          <Link href={field ? "/my-tools" : "/home"} className="flex items-center gap-2" title="STInventory">
            <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-sidebar-primary text-[11px] font-bold text-sidebar-primary-foreground">
              ST
            </span>
            <span className={cn("text-sm font-semibold tracking-tight", collapsed && "hidden")}>
              STInventory
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="lg:hidden"
            aria-label="Close navigation"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* The job scope selector — shadcn-account-selector pattern. Lives at
            the top of the nav so the first thing a scoped superintendent sees
            is which jobs they are looking at. */}
        <JobGroupSelector />

        <nav className={cn("flex-1 overflow-y-auto py-4", collapsed ? "px-2" : "px-3")}>
          {groups.map((g) => {
            const visible = g.items.filter((n) => !n.perm || perms.includes(n.perm));
            if (!visible.length) return null;
            return (
              <div key={g.label} className={cn("flex flex-col gap-1", !collapsed && "mb-5")}>
                <span className={cn("label-xs px-2 pb-1", collapsed && "sr-only")}>{g.label}</span>
                {visible.map((n) => {
                  const active = pathname === n.href || pathname.startsWith(n.href + "/");
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? n.label : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-md text-sm transition-colors",
                        collapsed ? "justify-center px-0 py-2.5" : "px-2 py-2",
                        field && "py-3 text-[0.95rem]",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                      )}
                    >
                      <n.icon className="size-4 shrink-0" />
                      <span className={cn("truncate", collapsed && "hidden")}>{n.label}</span>
                      {n.href === "/inbox" && inboxCount > 0 ? (
                        <span
                          className={cn(
                            "tnum ml-auto shrink-0 rounded-full bg-crit px-1.5 py-0.5 text-[10px] font-semibold leading-3 text-white",
                            collapsed && "absolute right-1 top-1 ml-0",
                          )}
                        >
                          {inboxCount > 99 ? "99+" : inboxCount}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className={cn("border-t border-sidebar-border p-3", collapsed && "px-2")}>
          {me.isLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
              <div className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                {(me.data?.firstName?.[0] ?? "") + (me.data?.lastName?.[0] ?? "")}
              </div>
              <div className={cn("flex min-w-0 flex-col leading-tight", collapsed && "hidden")}>
                <span className="truncate text-sm font-medium">
                  {me.data?.firstName} {me.data?.lastName}
                </span>
                <span className="label-xs truncate normal-case tracking-normal">
                  {role?.replace(/_/g, " ") ?? "—"}
                </span>
              </div>
              {/* The actions (profile, settings, sign out) live in the header's
                  user menu; this block is identity only. */}
            </div>
          )}
        </div>
      </aside>

      {open ? (
        <button
          type="button"
          aria-label="Close navigation overlay"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-foreground/20 lg:hidden"
        />
      ) : null}

      {/* ---- content ---- */}
      <div className={cn("flex min-w-0 flex-1 flex-col", collapsed ? "lg:pl-16" : "lg:pl-[248px]")}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          {/* Collapse toggle. It lives in the header, not at the rail's foot:
              the control belongs where the eye already is at the top of the
              page, and buried under the nav list it was a thing you had to go
              looking for. Desk only — a phone drawer never collapses. */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            title={collapsed ? "Expand navigation" : "Collapse navigation"}
            className="-ml-1 hidden text-muted-foreground hover:text-foreground lg:inline-flex"
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </Button>
          {/* Page context — the register's own title still tells you where you
              are; the dashboard drops it in favour of its tabs (docs/20). */}
          <span className={cn("truncate text-sm font-medium", pathname === "/home" && "hidden")}>
            {current?.label ?? "STInventory"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {!field ? <GlobalSearch /> : null}
            <NotificationCenter />
            <ThemeToggle />
            {me.data ? (
              <UserMenu
                name={`${me.data.firstName} ${me.data.lastName}`}
                role={me.data.role}
                onSignOut={onLogout}
              />
            ) : null}
          </div>
        </header>

        <main className={cn("mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8 lg:py-8", "pb-24")}>
          {children}
        </main>
      </div>
    </div>
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
