"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { JobsStep } from "@/components/onboarding/jobs-step";
import { EmptyState, PageHeader, TableSkeleton } from "@/components/sti/page";

/*
  TAKING ON A JOB, after setup is over.

  The same control the first-run wizard shows on its first step, promoted to a
  page of its own. Claiming used to close permanently the moment onboarding
  finished, so a director who took on a new job in March had no way to record it
  — an administrator had to reopen their onboarding, which made a routine act
  need a support request. `onboarding.state` now keeps the ability for roles
  holding a claim grant; this is where they reach it.

  ONE component, not a second copy. The wizard step and this page render
  `JobsStep`, so the rules about which projects are offered and which tiers are
  permitted are decided in one place and cannot drift into two answers.

  Not in the sidebar for people who cannot use it: `nav-config.ts` gates the
  entry on `project.team.assign`, which is the tenant-wide grant the three
  leadership roles carry. Somebody without it who reaches this URL is told so
  plainly rather than shown an empty picker.
*/
export default function ClaimAJobPage() {
  const state = trpc.onboarding.state.useQuery();

  if (state.isLoading) return <TableSkeleton />;

  if (!state.data?.canClaim) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Take on a job" description="Record the jobs you run, so you can staff them." />
        <EmptyState
          title="Your role does not take on jobs directly"
          description="Whoever runs a job puts people onto it. Ask them to add you, and it will appear in your projects."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Take on a job"
        description="Add the jobs you run. Once a job is yours you can build its team — and everyone you add can staff the tiers below them."
      />
      <JobsStep />
      {/* The next step, named. Claiming on its own changes nothing anybody can
          see; the point of it is the crew that follows. */}
      <Link
        href="/project-teams"
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        Build the team on a job you have taken on
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}
