import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuth } from "@stinventory/frontend-shared/auth";
import { Redirect } from "expo-router";
import { View, Text, ActivityIndicator } from "react-native";

const queryClient = new QueryClient();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator /></View>;
  if (!isAuthenticated) return <Redirect href="/login" />;
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="dashboard" />
        <Stack.Screen name="assets" />
        <Stack.Screen name="assignments" />
      </Stack>
    </QueryClientProvider>
  );
}
