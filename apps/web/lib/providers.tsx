"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
