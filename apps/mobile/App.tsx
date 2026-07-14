import { registerRootComponent } from "expo";
import { useState, useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getStoredToken } from "./src/lib/trpc";
import LoginScreen from "./src/screens/LoginScreen";
import ChatScreen from "./src/screens/ChatScreen";
import MyToolsScreen from "./src/screens/MyToolsScreen";
import ScannerScreen from "./src/screens/ScannerScreen";
import NotificationsScreen from "./src/screens/NotificationsScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import PendingActionsScreen from "./src/screens/PendingActionsScreen";
import ChannelOversightScreen from "./src/screens/ChannelOversightScreen";

type Tab = "chat" | "tools" | "scanner" | "notifications" | "profile" | "pending" | "oversight";

function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>("chat");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    getStoredToken().then((token) => {
      if (token) setAuthenticated(true);
      setChecking(false);
    });
  }, []);

  if (checking) return null;

  if (!authenticated) {
    return (
      <>
        <StatusBar style="dark" />
        <LoginScreen onLogin={() => setAuthenticated(true)} />
      </>
    );
  }

  const screenMap: Record<Tab, JSX.Element> = {
    chat: <ChatScreen onLogout={() => { setAuthenticated(false); }} />,
    tools: <MyToolsScreen />,
    scanner: <ScannerScreen onScan={(tag) => { setTab("chat"); }} />,
    notifications: <NotificationsScreen />,
    profile: <ProfileScreen onLogout={() => { setAuthenticated(false); }} />,
    pending: <PendingActionsScreen />,
    oversight: <ChannelOversightScreen />,
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "chat", label: "Chat" },
    { key: "tools", label: "Tools" },
    { key: "scanner", label: "Scan" },
    { key: "notifications", label: "Alerts" },
    { key: "profile", label: "Me" },
  ];

  if (isAdmin) {
    tabs.push({ key: "pending", label: "Pending" }, { key: "oversight", label: "Feed" });
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.content}>
        {screenMap[tab]}
      </View>
      <View style={styles.tabBar}>
        {tabs.map((t) => (
          <TouchableOpacity key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

registerRootComponent(App);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#1a1a2e" },
  content: { flex: 1, backgroundColor: "#f5f5f5" },
  tabBar: { flexDirection: "row", backgroundColor: "#1a1a2e", paddingBottom: 8, paddingTop: 4 },
  tab: { flex: 1, alignItems: "center", padding: 8 },
  tabText: { color: "#666", fontSize: 12, fontWeight: "600" },
  tabActive: { color: "#4ecdc4" },
});
