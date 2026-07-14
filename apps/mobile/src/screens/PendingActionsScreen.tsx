import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@stinventory/api-contracts";
import { trpc } from "../lib/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type PendingItem = RouterOutput["messaging"]["pendingActions"][number];

export default function PendingActionsScreen() {
  const [messages, setMessages] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionType, setActionType] = useState<string>("assign");
  const [subjectId, setSubjectId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const rows = await trpc.messaging.pendingActions.query({});
      setMessages(rows as unknown as PendingItem[]);
    } catch (err) {
      console.error("Failed to load pending actions", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleManualEntry = useCallback(async (msgId: string) => {
    if (!subjectId.trim()) {
      Alert.alert("Error", "Asset ID is required");
      return;
    }
    try {
      await trpc.messaging.manualEntry.mutate({
        messageId: msgId,
        actionType: actionType as "assign" | "return" | "transfer" | "repair" | "lost",
        assetIds: [subjectId.trim()],
        note: note.trim() || undefined,
      });
      Alert.alert("Done", "Action executed");
      setSubjectId("");
      setNote("");
      load();
    } catch (err) {
      Alert.alert("Error", err instanceof Error ? err.message : "Failed");
    }
  }, [actionType, subjectId, note, load]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pending Actions</Text>
      {messages.length === 0 ? (
        <Text style={styles.empty}>No pending actions.</Text>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.body}>{item.body}</Text>
              {item.intentType && <Text style={styles.intent}>Intent: {item.intentType}</Text>}
              {item.errorNote && <Text style={styles.error}>Error: {item.errorNote}</Text>}
              <Text style={styles.time}>{new Date(item.createdAt).toLocaleDateString()}</Text>

              <View style={styles.entryForm}>
                <Text style={styles.formLabel}>Manual Entry</Text>
                <View style={styles.actionRow}>
                  {["assign", "return", "transfer", "repair", "lost"].map((t) => (
                    <TouchableOpacity
                      key={t}
                      style={[styles.actionChip, actionType === t && styles.actionChipActive]}
                      onPress={() => setActionType(t)}
                    >
                      <Text style={[styles.actionChipText, actionType === t && styles.actionChipTextActive]}>
                        {t}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="Asset ID (uuid)"
                  placeholderTextColor="#999"
                  value={subjectId}
                  onChangeText={setSubjectId}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Note (optional)"
                  placeholderTextColor="#999"
                  value={note}
                  onChangeText={setNote}
                />
                <TouchableOpacity style={styles.executeButton} onPress={() => handleManualEntry(item.id)}>
                  <Text style={styles.executeText}>Execute</Text>
                </TouchableOpacity>
              </View>
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
  title: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 16 },
  empty: { textAlign: "center", color: "#666", marginTop: 40, fontSize: 16 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12 },
  body: { fontSize: 15, color: "#1a1a2e", marginBottom: 4 },
  intent: { fontSize: 12, color: "#4ecdc4", fontWeight: "600", marginBottom: 4 },
  error: { fontSize: 12, color: "#ff6b6b", marginBottom: 4 },
  time: { fontSize: 11, color: "#999", marginBottom: 12 },
  entryForm: { borderTopWidth: 1, borderTopColor: "#eee", paddingTop: 12 },
  formLabel: { fontSize: 13, fontWeight: "600", color: "#666", marginBottom: 8 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  actionChip: { backgroundColor: "#eee", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  actionChipActive: { backgroundColor: "#1a1a2e" },
  actionChipText: { fontSize: 12, color: "#666" },
  actionChipTextActive: { color: "#fff" },
  input: { backgroundColor: "#f5f5f5", borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 8, borderWidth: 1, borderColor: "#ddd" },
  executeButton: { backgroundColor: "#4ecdc4", borderRadius: 8, padding: 12, alignItems: "center" },
  executeText: { color: "#fff", fontWeight: "600" },
});
