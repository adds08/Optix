import { cookies } from "next/headers";
import { AppShell } from "@/components/sti/app-shell";
import { JobScopeProvider } from "@/components/job-scope";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  /* SidebarProvider writes this cookie on every toggle but never reads it, so
     a collapsed rail used to render expanded and then snap shut once the
     client took over. Reading it here means the first paint is already right. */
  const open = (await cookies()).get("sidebar_state")?.value !== "false";

  return (
    <JobScopeProvider>
      <AppShell defaultSidebarOpen={open}>{children}</AppShell>
    </JobScopeProvider>
  );
}
