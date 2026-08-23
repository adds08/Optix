"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/components/use-permissions";
import { isFieldRole } from "@/components/sti/nav-config";
import { ProjectMonitor } from "@/components/sti/monitor/project-monitor";

/*
  The dashboard is the project monitor: the jobs in scope, cycling one at a
  time, on a screen that does not need a mouse. The widget dashboard it replaced
  on 2026-08-23 is still here, unchanged, at /old-dash.

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
  const { role } = usePermissions();

  useEffect(() => {
    if (isFieldRole(role)) router.replace("/my-tools");
  }, [role, router]);

  return <ProjectMonitor />;
}
