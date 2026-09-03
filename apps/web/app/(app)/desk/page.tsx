"use client";

import { PageHeader } from "@/components/sti/page";
import { Desk } from "@/components/desk/desk";

/*
  The Desk — SYSTEM_PLAN §6.5.

  Its own route rather than a tab on the dashboard, for a reason that only
  showed up in the browser: `/home` redirects field roles to `/my-tools`
  (`home/page.tsx`), so a Desk living there would have been unreachable for a
  foreman, a mechanic and a superintendent — exactly the people `tools.mine`
  and `crew.tools` exist for. A surface the plan calls "the intended long-term
  surface for the entire system" cannot be behind a redirect that excludes
  half the company.

  It is also the shape §7 assumes: Release 2's question-and-answer interface
  answers ON the Desk, which wants a place of its own rather than a tab inside
  a fleet dashboard.

  The page holds no logic. Composition is `PANEL_REGISTRY` filtered by
  permission (`components/desk/desk.tsx`); adding a panel touches neither this
  file nor any role logic.
*/
export default function DeskPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Desk"
        hideTitle
        description="The command surface — every panel your account may open, assembled from one registry."
      />
      <Desk />
    </div>
  );
}
