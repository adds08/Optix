import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { trpc } from "../lib/trpc";

type Assignment = {
  id: string;
  tag: string;
  modelName: string;
  custodianName: string;
  projectName: string | null;
  locationName: string | null;
  type: string;
  status: string;
  overdue: boolean;
};

export default function MyToolsScreen() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const rows = await trpc.assignment.list.query();
      setAssignments(rows);
    } catch (err) {
      console.error("Failed to load assignments", err);
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
      <Text style={styles.title}>My Tools</Text>
      {assignments.length === 0 ? (
        <Text style={styles.empty}>No tools assigned to you.</Text>
      ) : (
        assignments.map((a) => (
          <View key={a.id} style={[styles.card, a.overdue && styles.cardOverdue]}>
            <View style={styles.cardHeader}>
              <Text style={styles.tag}>{a.tag}</Text>
              {a.overdue && <Text style={styles.overdueBadge}>OVERDUE</Text>}
            </View>
            <Text style={styles.model}>{a.modelName}</Text>
            <Text style={styles.detail}>Project: {a.projectName ?? "N/A"}</Text>
            <Text style={styles.detail}>Location: {a.locationName ?? "N/A"}</Text>
            <Text style={styles.detail}>Type: {a.type}</Text>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#f5f5f5" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 16, marginTop: 8 },
  empty: { textAlign: "center", color: "#666", marginTop: 40, fontSize: 16 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#eee" },
  cardOverdue: { borderColor: "#ff6b6b", borderWidth: 2 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  tag: { fontSize: 16, fontWeight: "700", color: "#1a1a2e" },
  overdueBadge: { backgroundColor: "#ff6b6b", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, color: "#fff", fontSize: 10, fontWeight: "700" },
  model: { fontSize: 14, color: "#333", marginBottom: 4 },
  detail: { fontSize: 13, color: "#666", marginBottom: 2 },
});
