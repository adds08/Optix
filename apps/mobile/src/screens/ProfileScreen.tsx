import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { logoutRequest } from "../lib/trpc";

type Props = {
  onLogout: () => void;
};

export default function ProfileScreen({ onLogout }: Props) {
  const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      { text: "Logout", style: "destructive", onPress: async () => { await logoutRequest(); onLogout(); } },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <View style={styles.infoCard}>
        <Text style={styles.label}>User ID</Text>
        <Text style={styles.value}>STInventory Mobile</Text>
      </View>
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: "#f5f5f5" },
  title: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 24, marginTop: 8 },
  infoCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 24 },
  label: { fontSize: 12, color: "#999", marginBottom: 4 },
  value: { fontSize: 16, color: "#1a1a2e", fontWeight: "500" },
  logoutButton: { backgroundColor: "#ff6b6b", borderRadius: 8, padding: 14, alignItems: "center" },
  logoutText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
