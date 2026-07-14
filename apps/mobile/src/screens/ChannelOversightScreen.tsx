import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Platform, StyleSheet, Text, View } from "react-native";
import { trpc } from "../lib/trpc";

export default function ChannelOversightScreen() {
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await trpc.messaging.feed.query({ limit: 50 });
      setMessages(rows as any[]);
    } catch (err) {
      console.error("Failed to load feed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const statusColor = (s: string) => {
    switch (s) {
      case "action_proposed": return "#4ecdc4";
      case "action_executed": return "#2ecc71";
      case "pending_manual": return "#f39c12";
      case "error": return "#ff6b6b";
      default: return "#999";
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Channel Oversight</Text>
      <FlatList
        data={messages}
        keyExtractor={(item: any) => item.id}
        renderItem={({ item }: { item: any }) => (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.statusBadge, { backgroundColor: statusColor(item.processingStatus) }]}>
                <Text style={styles.statusText}>{item.processingStatus.replace(/_/g, " ")}</Text>
              </View>
              {item.intentType && <Text style={styles.intent}>{item.intentType}</Text>}
            </View>
            <Text style={styles.body}>{item.body}</Text>
            {item.intentPayload && (
              <Text style={styles.payload}>
                Entities: {JSON.stringify(item.intentPayload?.entities ?? {}, null, 1)}
              </Text>
            )}
            {item.proposedAction && (
              <Text style={styles.action}>
                Proposed: {JSON.stringify(item.proposedAction)}
              </Text>
            )}
            <Text style={styles.time}>{new Date(item.createdAt).toLocaleString()}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#f5f5f5" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 16 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  statusBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  statusText: { color: "#fff", fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  intent: { fontSize: 12, color: "#666", fontWeight: "600" },
  body: { fontSize: 15, color: "#1a1a2e", marginBottom: 6 },
  payload: { fontSize: 11, color: "#666", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginBottom: 4 },
  action: { fontSize: 11, color: "#4ecdc4", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", marginBottom: 4 },
  time: { fontSize: 11, color: "#999", marginTop: 4 },
});
