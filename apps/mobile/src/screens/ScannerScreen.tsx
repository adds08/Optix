import { StyleSheet, Text, View } from "react-native";

type Props = {
  onScan: (tag: string) => void;
};

export default function ScannerScreen({ onScan }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.centered}>
        <Text style={styles.title}>Scanner</Text>
        <Text style={styles.subtitle}>
          Scanner requires a development build or Expo Go with expo-camera.
        </Text>
        <Text style={styles.hint}>Tap a tag manually in Chat to look it up.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  title: { fontSize: 24, fontWeight: "700", color: "#1a1a2e", marginBottom: 12 },
  subtitle: { fontSize: 15, color: "#666", textAlign: "center", marginBottom: 8, lineHeight: 22 },
  hint: { fontSize: 13, color: "#999", textAlign: "center" },
});
