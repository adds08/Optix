import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@stinventory/api-contracts";
import { trpc } from "../lib/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type NotificationItem = RouterOutput["notification"]["list"][number];

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await trpc.notification.list.query();
      setNotifications(rows);
    } catch (err) {
      console.error("Failed to load notifications", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Notifications</Text>
      {notifications.length === 0 ? (
        <Text style={styles.empty}>No notifications.</Text>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={[styles.card, !item.readAt && styles.unread]}>
              <View style={styles.cardHeader}>
                <Text style={styles.type}>{item.type.replace(/_/g, " ")}</Text>
                {!item.readAt && <View style={styles.unreadDot} />}
              </View>
              <Text style={styles.titleText}>{item.title}</Text>
              {item.body && <Text style={styles.body}>{item.body}</Text>}
              <Text style={styles.time}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#f5f5f5" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 16, marginTop: 8 },
  empty: { textAlign: "center", color: "#666", marginTop: 40, fontSize: 16 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "#eee" },
  unread: { borderColor: "#4ecdc4", borderWidth: 2 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  type: { fontSize: 11, fontWeight: "600", color: "#666", textTransform: "uppercase" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#4ecdc4" },
  titleText: { fontSize: 15, fontWeight: "600", color: "#1a1a2e", marginBottom: 4 },
  body: { fontSize: 13, color: "#666", marginBottom: 4 },
  time: { fontSize: 11, color: "#999" },
});
