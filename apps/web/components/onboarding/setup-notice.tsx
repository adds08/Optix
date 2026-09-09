"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, HardHat } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/*
  "Your setup isn't finished" — the way back into a wizard somebody skipped.

  Skipping used to be a dead end. `complete({ dismissed: true })` stamped the
  same `completedAt` a real finish does, the gate stopped firing, and there was
  no route to the wizard from anywhere in the product: the work was simply
  abandoned with no way to pick it up. This is that route.

  A NUDGE, NOT A GATE, and the distinction is the whole design. The first-run
  redirect fires once and never again, deliberately, because a gate that
  reappears every session stands between a foreman and the tool they came to
  check out. This sits quietly in the sidebar instead — visible on every screen,
  costing nothing, and dismissible by doing the work rather than by arguing with
  a modal.

  Reads `needsSetup`, computed on the server, which is false for anybody who
  finished properly AND for an account with no employee record (never sent to
  the wizard in the first place, so nagging it about setup would be nagging
  about a task the product will not let it do).

  Renders NOTHING in the collapsed icon-only rail. A 48px column has no room for
  a sentence, and a lone icon there would be an unexplained badge somebody
  cannot act on.
*/
export function SetupNotice() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { state, isMobile } = useSidebar();
  /*
    Gated exactly like `app-shell.tsx`'s own `onboarding.state` read, and for
    the identical reason: `onboarding.state` is one cache entry shared by every
    caller, `enabled: false` only stops THIS hook from fetching it, and a
    sibling that fetches it unconditionally still hands this component (and
    the shell's own gated instance) whatever it found. This component renders
    in the sidebar on every `(app)` page, `/account/password` included — an
    unguarded fetch here populated the shared cache with `shouldPrompt: true`
    while `mustChangePassword` was still true, and the shell's redirect fired
    off that borrowed data despite its own `enabled` flag never having allowed
    it to ask. Keep this in lockstep with the shell's gate by hand; a change to
    one without the other reopens the race.
  */
  const me = trpc.identity.me.useQuery();
  const onboarding = trpc.onboarding.state.useQuery(undefined, {
    enabled: !!me.data && !me.data.mustChangePassword,
  });

  const resume = trpc.onboarding.resume.useMutation({
    onSuccess: async () => {
      /* The gate reads this query. Invalidating before navigating means the
         wizard opens because the state says it should, rather than racing a
         redirect that might bounce back. */
      await utils.onboarding.state.invalidate();
      router.push("/welcome");
    },
  });

  if (!onboarding.data?.needsSetup) return null;
  if (state === "collapsed" && !isMobile) return null;

  return (
    <button
      type="button"
      disabled={resume.isPending}
      onClick={() => resume.mutate()}
      className={cn(
        "group flex w-full flex-col gap-1.5 rounded-md border border-primary/25 bg-primary/[0.07] p-2.5 text-left transition-colors",
        "hover:border-primary/40 hover:bg-primary/[0.12] disabled:opacity-60",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <HardHat className="size-3.5 shrink-0 text-primary" aria-hidden />
        Finish your setup
      </span>
      <span className="text-[0.6875rem] leading-snug text-muted-foreground">
        You skipped it. Pick up where you left off — it takes a minute.
      </span>
      <span className="flex items-center gap-1 text-[0.6875rem] font-medium text-primary">
        {resume.isPending ? "Opening…" : "Continue setup"}
        <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  );
}
