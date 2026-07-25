import { Redirect, Tabs } from "expo-router";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../../lib/auth";
import { Loading } from "../../components/ui";

/*
  Three tabs, no more. A foreman in a truck has exactly three jobs: see what
  they hold, hand something over, and deal with what is chasing them.
*/
export default function TabsLayout() {
  const { token, hydrating } = useAuth();

  if (hydrating) {
    return (
      <View className="flex-1 justify-center bg-background">
        <Loading />
      </View>
    );
  }
  if (!token) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#1F6E8C",
        tabBarInactiveTintColor: "#69727E",
        tabBarStyle: { borderTopColor: "#DFE4E9", height: 64, paddingBottom: 8, paddingTop: 8 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "My Tools",
          tabBarIcon: ({ color }) => <Ionicons name="construct" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="handoff"
        options={{
          title: "Hand Off",
          tabBarIcon: ({ color }) => <Ionicons name="swap-horizontal" size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: "Alerts",
          tabBarIcon: ({ color }) => <Ionicons name="notifications" size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
