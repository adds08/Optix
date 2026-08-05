import { AppShell } from "@/components/sti/app-shell";
import { JobScopeProvider } from "@/components/job-scope";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <JobScopeProvider>
      <AppShell>{children}</AppShell>
    </JobScopeProvider>
  );
}
