import "../global.css";

import { useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../lib/auth";
import { createClient, trpc } from "../lib/trpc";

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /* Yards have bad signal. Don't hammer a flaky connection, and keep
               showing the last good answer while refetching. */
            retry: 2,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [client] = useState(() => createClient());

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <trpc.Provider client={client} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }}>
              {/* Action forms come up as a sheet over the tool they act on, so
                  the foreman never loses sight of which tool they picked. */}
              <Stack.Screen
                name="action/[type]"
                options={{
                  presentation: "formSheet",
                  sheetAllowedDetents: [0.75, 1],
                  sheetGrabberVisible: true,
                }}
              />
            </Stack>
          </QueryClientProvider>
        </trpc.Provider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
