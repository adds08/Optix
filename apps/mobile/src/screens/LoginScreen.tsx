import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { loginRequest } from "../lib/trpc";

type Props = {
  onLogin: () => void;
};

const DEMO_ACCOUNTS = [
  { label: "Foreman (Miguel)", email: "foreman.miguel@stinventory.local" },
  { label: "Admin (Karen)", email: "admin@stinventory.local" },
  { label: "Super (Carlos)", email: "super.carlos@stinventory.local" },
] as const;

const DEMO_PASSWORD = "stinventory-demo";

export default function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Error", "Please enter email and password");
      return;
    }
    setLoading(true);
    try {
      await loginRequest(email.trim(), password.trim());
      onLogin();
    } catch (err) {
      Alert.alert("Login Failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin(demoEmail: string) {
    setLoading(true);
    try {
      await loginRequest(demoEmail, DEMO_PASSWORD);
      onLogin();
    } catch (err) {
      Alert.alert("Login Failed", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>STInventory</Text>
      <Text style={styles.subtitle}>Small Tool Inventory</Text>
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#999"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#999"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Login</Text>}
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>Demo Login</Text>
          <View style={styles.dividerLine} />
        </View>

        {DEMO_ACCOUNTS.map((demo) => (
          <TouchableOpacity
            key={demo.email}
            style={styles.demoButton}
            onPress={() => handleDemoLogin(demo.email)}
            disabled={loading}
          >
            <Text style={styles.demoButtonText}>{demo.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#f5f5f5" },
  title: { fontSize: 32, fontWeight: "700", textAlign: "center", color: "#1a1a2e", marginBottom: 4 },
  subtitle: { fontSize: 14, textAlign: "center", color: "#666", marginBottom: 40 },
  form: { gap: 12 },
  input: { backgroundColor: "#fff", borderRadius: 8, padding: 14, fontSize: 16, borderWidth: 1, borderColor: "#ddd" },
  button: { backgroundColor: "#1a1a2e", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#ddd" },
  dividerText: { marginHorizontal: 12, color: "#999", fontSize: 13 },
  demoButton: { backgroundColor: "#4ecdc4", borderRadius: 8, padding: 12, alignItems: "center" },
  demoButtonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
});
