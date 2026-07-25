import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from "react-native";
import { useAuth } from "@stinventory/frontend-shared/auth";
import { useRouter } from "expo-router";

export default function LoginScreen() {
  const [email, setEmail] = useState("admin@stinventory.local");
  const [password, setPassword] = useState("stinventory-demo");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const submit = async () => {
    setError(""); setLoading(true);
    try {
      await login(email.trim(), password.trim());
      router.replace("/dashboard");
    } catch { setError("Invalid email or password."); }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1 bg-muted/50">
      <View className="flex-1 items-center justify-center px-6">
        <View className="w-full max-w-md bg-card rounded-xl p-8 shadow-sm border border-border">
          <View className="items-center mb-8">
            <View className="h-12 w-12 rounded-xl bg-primary/10 items-center justify-center mb-4">
              <Text className="text-2xl">📦</Text>
            </View>
            <Text className="text-2xl font-bold text-foreground">STInventory</Text>
            <Text className="text-sm text-muted-foreground mt-1">Equipment & Tool Management</Text>
          </View>
          <View className="gap-4">
            <View>
              <Text className="text-sm font-medium text-foreground mb-2">Email</Text>
              <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground" placeholder="you@company.com" />
            </View>
            <View>
              <Text className="text-sm font-medium text-foreground mb-2">Password</Text>
              <TextInput value={password} onChangeText={setPassword} secureTextEntry className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground" placeholder="••••••••" onSubmitEditing={submit} />
            </View>
            {error ? <Text className="text-sm text-destructive text-center">{error}</Text> : null}
            <TouchableOpacity onPress={submit} disabled={loading} className="h-10 rounded-lg bg-primary items-center justify-center">
              <Text className="text-sm font-medium text-primary-foreground">{loading ? "Signing in…" : "Sign in"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
