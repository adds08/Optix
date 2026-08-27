"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { trpc, trpcClient } from "./trpc";

export function Providers({ children }: { children: React.ReactNode }) {
  /*
    `staleTime: 0` — the default — means every window focus refires every
    mounted query. That is wasted work on a list, and actively harmful on a
    form: a refetch that lands mid-edit re-runs whatever effect seeds the
    fields from server data and wipes what was being typed. Ten seconds is
    short enough that a page still feels live and long enough that flicking to
    another window and back is not a network event.
  */
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } }),
  );
  const [client] = useState(() => trpcClient());
  /*
    `reducedMotion="user"` is not a default — `motion` animates regardless of
    the OS setting unless it is told otherwise, which would have made the JS
    animations the one part of this app that ignores a preference every
    keyframe in `globals.css` already respects. Set once, at the root, so no
    component has to remember: transforms and layout animations are dropped for
    a reduced-motion visitor while opacity still cross-fades, which is the
    behaviour that keeps a state change legible instead of instantaneous.
  */
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
