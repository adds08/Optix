"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Moon, RotateCw, Sun, TriangleAlert } from "lucide-react";
import { trpc, retryUnlessUnauthorized } from "@/lib/trpc";
import { clearSession, getSession, logout } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppRail } from "@/components/app-rail";
import { AiPanel } from "@/components/ai-panel";
import { NotificationCenter } from "@/components/notification-center";
import { UserMenu } from "@/components/user-menu";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";
import { Search } from "lucide-react";
import { WorkingBar } from "@/components/working-bar";
import { AppSplash } from "./app-splash";
import { DUR, EASE } from "@/lib/motion";
import { useThemeStore } from "@/lib/themes/store";
import { applyTheme } from "@/lib/themes/apply-theme";
import { DEFAULT_PREFS, type ThemePrefs } from "@/lib/themes/themes";
import { allItems, groupKey, isFieldRole, matchItem, navFor, type NavGroup } from "./nav-config";

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
  const [aiOpen, setAiOpen] = useState(false);
  /* Whether the light/dark preference has been read out of storage yet. It is
     a separate flag from `dark` itself because `false` is a legitimate value
     for that and "not asked yet" has to be distinguishable from "light". */
  const [darkKnown, setDarkKnown] = useState(false);
  /* ⌘K and "/" live in the hook so the button and the key handler cannot
     disagree about what opens the palette. */
  const { open: paletteOpen, setOpen: setPaletteOpen } = useCommandPalette();

  /* Guard: no session, no app. Runs before any query fires. */
  useEffect(() => {
    if (!getSession()) router.replace("/");
    else setReady(true);
  }, [router]);

  /*
    `identity.me` is what decides whether the caller is still signed in, so it
    is the one query whose failure is allowed to touch stored credentials — and
    only when the failure says the session is gone.

    UNAUTHORIZED means exactly that: expired, revoked, or deactivated
    mid-session. Anything else — unreachable API, 500, timeout — leaves a
    perfectly good credential in place. Conflating the two (a bare `me.isError`
    with `retry: false`) signed people out because one request lost the network,
    then asked them for a password to fix it.
  */
  const me = trpc.identity.me.useQuery(undefined, {
    enabled: ready,
    retry: retryUnlessUnauthorized,
  });
  const sessionIsDead = me.isError && me.error?.data?.code === "UNAUTHORIZED";
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
    /* Dark unless explicitly turned off — matches the boot script in
       layout.tsx, which must agree with this or the first paint flips. */
    setDark(localStorage.getItem("sti-theme") !== "light");
    setDarkKnown(true);
  }, [setDark]);

  useEffect(() => {
    if (prefs.data) setPrefs(prefs.data as ThemePrefs);
    /* A failed preferences read must still settle, or the shell waits behind
       the splash forever on a request that is never coming back. The defaults
       are the honest answer at that point. */
    else if (prefs.isError) setPrefs(DEFAULT_PREFS);
  }, [prefs.data, prefs.isError, setPrefs]);

  /*
    Do not repaint until BOTH facts are in — this is the whole theme-flash fix.

    The boot script in `layout.tsx` has already painted the cached appearance
    onto <html> before first paint, and it is CORRECT. This effect used to run
    on mount regardless, with `dark` still at its initial `false` and no
    preferences yet, so `applyTheme(DEFAULT_PREFS, false)` cleared every inline
    variable the boot script had set and dropped the `dark` class. That is the
    flash: not a theme arriving late, but the right theme being actively wiped
    and then restored a few hundred milliseconds later once the query landed.

    So the shell now leaves the boot script's paint alone until it can improve
    on it, and `AppSplash` covers the gap. `storePrefs` rather than
    `prefs.data` is what is waited on, because the appearance settings page
    writes the store directly for instant preview and must keep winning here.
  */
  const appearanceSettled = darkKnown && storePrefs !== null;

  useEffect(() => {
    if (!appearanceSettled || !storePrefs) return;
    applyTheme(storePrefs, dark);
  }, [appearanceSettled, storePrefs, dark]);

  useEffect(() => {
    if (sessionIsDead) {
      clearSession();
      router.replace("/");
    }
  }, [sessionIsDead, router]);

  /*
    A credential somebody else chose is a credential somebody else knows.

    STI-303 set `must_change_password` on every account an administrator
    creates or resets, and deliberately did NOT enforce it as a login refusal —
    a user who cannot sign in also cannot change their password. Enforcement
    belongs here instead: they sign in normally and land on the one screen that
    clears the flag.

    Reads the flag from `identity.me` rather than from the login response, so
    an administrator resetting a password mid-session reaches that user on
    their next page load rather than only if they happen to sign in again.

    Not a security boundary — it is a redirect, and the API does not consult
    it. Someone who ignores it keeps a password their administrator picked;
    they do not gain anything they did not already have.
  */
  useEffect(() => {
    if (me.data?.mustChangePassword && pathname !== "/account/password") {
      router.replace("/account/password");
    }
  }, [me.data?.mustChangePassword, pathname, router]);

  const role = me.data?.role ?? null;
  const perms = me.data?.permissions ?? [];
  const field = isFieldRole(role);
  const current = matchItem(allItems(role), pathname);

  /* Two-pane shell (Blocky): the rail draws one glyph per group, the sidebar
     shows the active group's rows. A group reaches the rail only if at least
     one of its rows survives the permission filter — a glyph that opens an
     empty sidebar is worse than no glyph at all. */
  const groups = navFor(role);
  const railGroups: NavGroup[] = groups
    .map((g) => ({ ...g, items: g.items.filter((n) => !n.perm || perms.includes(n.perm)) }))
    .filter((g) => g.items.length > 0);
  const activeGroup = railGroups.find((g) => g.items.some((i) => i.href === current?.href));
  const activeGroupKey = activeGroup ? groupKey(activeGroup) : undefined;

  /* Wall surfaces (the project monitor) own the whole region: no max-width, no
     padding, and no scroll — the readme is explicit that a scrolling embed
     needs a definite height at every link in the chain, and the centred content
     box below is auto-height, so `h-full` inside it would resolve to nothing. */
  const fullBleed = current?.fullBleed ?? false;

  const userName = `${me.data?.firstName ?? ""} ${me.data?.lastName ?? ""}`.trim();

  async function onLogout() {
    try {
      await logout();
    } finally {
      clearSession();
      router.replace("/");
    }
  }

  /* No session read yet, and a dead session on its way to `/`. Both used to
     paint nothing, which is a flash of bare canvas in whatever colour the
     boot script left behind. The mask is the same element the booting shell
     shows, so the hand-off between them is invisible. */
  if (!ready) return <AppSplash show />;
  if (sessionIsDead) return <AppSplash show />;

  /*
    Signed in, but the API is not answering — the retries above are spent.

    This is a wall rather than a sign-out, which is the whole point of the
    change: the credential is untouched, so "Try again" is genuinely all that
    is needed, and a foreman does not have to remember a password because the
    yard wifi dropped. The shell itself cannot render behind this — without
    `me.data` there are no permissions, so the navigation would come out empty
    and every panel inside it would be failing too. Borrowed from
    `(app)/error.tsx` deliberately: to the person looking at it this is the
    same kind of event, and it should not look like a different product.
  */
  if (me.isError) {
    return (
      <div className="grid min-h-svh place-items-center px-6">
        <div className="flex max-w-[46ch] flex-col items-center gap-3 rounded-md border bg-card px-6 py-14 text-center">
          <span
            aria-hidden
            className="flex size-11 items-center justify-center rounded-full bg-crit-bg text-crit"
          >
            <TriangleAlert className="size-5" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="font-medium">Cannot reach the server</p>
            <p className="text-sm text-muted-foreground text-pretty">
              You are still signed in and nothing was lost. This is usually the
              connection — try again in a moment.
            </p>
          </div>
          <Button onClick={() => me.refetch()} size="sm" variant="outline" disabled={me.isFetching}>
            <RotateCw className={cn("size-4", me.isFetching && "animate-spin")} />
            {me.isFetching ? "Trying…" : "Try again"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    /*
      Two classes here are load-bearing, not tidiness.

      `relative` makes this the containing block for the assistant panel's
      `absolute`, so the panel's 400px of travel is clipped here instead of
      overflowing the document.

      `overflow-clip` rather than `overflow-hidden` clips the same way but does
      NOT make this a scroll container — so nothing inside the shell can ask an
      ancestor to scroll it sideways. `overflow-hidden` is scrollable
      programmatically, and one `scrollIntoView()` in the assistant was enough
      to drag the rail and the content column off-screen while the fixed
      sidebar stayed behind. See the note in `ai-panel.tsx`.
    */
    <SidebarProvider defaultOpen={defaultSidebarOpen} className="relative h-dvh overflow-clip">
      <AppSplash show={!me.data || !appearanceSettled} />
      <WorkingBar />
      <AppRail
        groups={railGroups}
        activeKey={activeGroupKey}
        aiOpen={aiOpen}
        onToggleAi={() => setAiOpen((v) => !v)}
      />
      <AppSidebar
        groups={railGroups}
        activeGroupKey={activeGroupKey}
        inboxCount={inboxCount}
      />
      <SidebarInset>
        {/* Top bar — page context, search, notifications, account. h-14 is
            shared with the rail's header so the two bottom borders meet as a
            single line across the shell. */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 lg:px-6">
          <SidebarTrigger className="-ml-1.5" />
          <span className={cn("truncate text-sm font-medium", pathname === "/home" && "hidden")}>
            {current?.label ?? "Optix"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {!field ? (
              /* The trigger is a button, not an input: the palette owns the
                 field, so a second one here would take focus from it. */
              <Button
                variant="outline"
                onClick={() => setPaletteOpen(true)}
                className="h-8 w-64 max-w-[40vw] justify-start gap-2 px-2.5 text-sm font-normal text-muted-foreground"
              >
                <Search className="size-4 shrink-0" aria-hidden />
                <span className="truncate">Search tools, people, jobs…</span>
                <kbd className="ml-auto hidden shrink-0 rounded-sm border bg-muted px-1.5 font-mono text-[11px] text-muted-foreground sm:inline">
                  ⌘K
                </kbd>
              </Button>
            ) : null}
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
        <div className={cn("min-h-0 flex-1", fullBleed ? "overflow-hidden" : "sti-scroll")}>
          {fullBleed ? (
            /* Wall surfaces are deliberately NOT faded. The monitor is a board
               somebody has left running on a screen across the room; a
               transition on every cycle would be a flicker in the corner of
               the room, and the `h-full` chain it needs must not gain a
               wrapper that breaks it. */
            children
          ) : (
            /* Keyed on the pathname so each route fades up rather than
               snapping in. Short on purpose — this sits in front of every
               navigation in the product, and it is the one transition capable
               of making the whole thing feel slow. */
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.route, ease: EASE.out }}
              className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8"
            >
              {children}
            </motion.div>
          )}
        </div>
      </SidebarInset>
      <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} />
      {!field ? <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} /> : null}
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
