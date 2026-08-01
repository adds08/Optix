"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Menu, Moon, Sun, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { clearSession, getSession, logout } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { NotificationCenter } from "@/components/notification-center";
import { UserMenu } from "@/components/user-menu";
import { useThemeStore } from "@/lib/themes/store";
import { applyTheme } from "@/lib/themes/apply-theme";
import { DEFAULT_PREFS, type ThemePrefs } from "@/lib/themes/themes";
import { allItems, isFieldRole, navFor } from "./nav-config";

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
      {/* ---- rail ---- */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r bg-sidebar text-sidebar-foreground",
          "transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <Link href={field ? "/my-tools" : "/home"} className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-sm bg-sidebar-primary text-[11px] font-bold text-sidebar-primary-foreground">
              ST
            </span>
            <span className="text-sm font-semibold tracking-tight">STInventory</span>
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

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map((g) => {
            const visible = g.items.filter((n) => !n.perm || perms.includes(n.perm));
            if (!visible.length) return null;
            return (
              <div key={g.label} className="mb-5 flex flex-col gap-1">
                <span className="label-xs px-2 pb-1">{g.label}</span>
                {visible.map((n) => {
                  const active = pathname === n.href || pathname.startsWith(n.href + "/");
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors",
                        field && "py-3 text-[0.95rem]",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                      )}
                    >
                      <n.icon className="size-4 shrink-0" />
                      <span className="truncate">{n.label}</span>
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          {me.isLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <div className="flex items-center gap-2">
              <div className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                {(me.data?.firstName?.[0] ?? "") + (me.data?.lastName?.[0] ?? "")}
              </div>
              <div className="flex min-w-0 flex-col leading-tight">
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
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur lg:px-8">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-medium">{current?.label ?? "STInventory"}</span>
          <div className="ml-auto flex items-center gap-1">
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

        <main className={cn("mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8 lg:py-8")}>
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
