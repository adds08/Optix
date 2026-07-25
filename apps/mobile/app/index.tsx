import { Redirect } from "expo-router";
import { View } from "react-native";
import { useAuth } from "../lib/auth";
import { Loading } from "../components/ui";

export default function Index() {
  const { token, hydrating } = useAuth();

  if (hydrating) {
    return (
      <View className="flex-1 justify-center bg-background">
        <Loading label="Checking your session…" />
      </View>
    );
  }

  return <Redirect href={token ? "/(tabs)" : "/login"} />;
}
