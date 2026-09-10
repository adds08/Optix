"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/components/use-permissions";

import { trpc } from "@/lib/trpc";
import { ProjectMonitor } from "@/components/sti/monitor/project-monitor";

/*
  The dashboard is the project monitor: the jobs in scope, cycling one at a
  time, on a screen that does not need a mouse. The widget dashboard and the
  Desk command surface it replaced on 2026-08-23 were removed on 2026-09-03 —
  the monitor has been lived with and they are gone.

  The field redirect is carried over from that page verbatim and is not
  incidental — a wall board is the wrong thing to hand a foreman holding a
  phone in a yard, and it was already the wrong thing to hand them a desk
  dashboard. They land on the surface built for them.

  `fullBleed` on the nav entry is what makes this work: the shell drops its
  centred max-width box for this route, so the board's five bands size against
  the viewport instead of against an auto-height wrapper that would leave the
  transport bar below the fold.
*/
export default function HomePage() {
  const router = useRouter();
  const { role, usesFieldLayout } = usePermissions();
  /*
    First-run setup wins over this redirect, and the ORDER is the whole reason
    this query is here.

    Both fire on the same sign-in. This one only needs `role`, which lands with
    `identity.me`; the wizard gate in `app-shell.tsx` waits for
    `onboarding.state`, which lands later. So a field role who had never set up
    was bounced to `/my-tools` first, and because that is a client-side
    navigation the shell never remounts and its gate's dependencies never change
    again — the wizard simply never opened. Reproducible on every single
    sign-in as a superintendent, and invisible on a hard reload, which is what
    made it look like it worked.

    Waiting for DATA rather than checking `isPending`: this query is disabled
    until `me` resolves, and a disabled query is not pending, so `isPending`
    would wave the redirect straight through the window it is meant to close.

    The comment above was true of the intent and not of the code: `enabled`
    was never actually set, so this fetched unconditionally on every render of
    `/home` — including the moment right after sign-in, before the shell's own
    `mustChangePassword` gate has had its say. `onboarding.state` is ONE cache
    entry; an unguarded fetch here hands the shell's own gated instance data
    it never asked for, exactly the class of bug `setup-notice.tsx`'s
    unguarded copy of this same query caused (see its comment). Gated here the
    same way, and for the same reason — kept in lockstep by hand.
  */
  const me = trpc.identity.me.useQuery();
  const onboarding = trpc.onboarding.state.useQuery(undefined, {
    enabled: !!me.data && !me.data.mustChangePassword,
  });

  useEffect(() => {
    if (!onboarding.data) return;
    if (onboarding.data.shouldPrompt) return;
    if (usesFieldLayout) router.replace("/my-tools");
  }, [usesFieldLayout, router, onboarding.data]);

  return <ProjectMonitor />;
}
