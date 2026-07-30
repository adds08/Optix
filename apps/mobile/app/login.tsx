import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
import { Button, SCREEN_CONTENT } from "../components/ui";

const DEMO = [
  { email: "foreman.miguel@stinventory.local", who: "Miguel Torres — Foreman" },
  { email: "admin@stinventory.local", who: "Karen Osei — Equipment Admin" },
];

export default function LoginScreen() {
  const [email, setEmail] = useState("foreman.miguel@stinventory.local");
  const [password, setPassword] = useState("stinventory-demo");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  async function submit() {
    setError("");
    setBusy(true);
    try {
      await signIn(email.trim(), password.trim());
      router.replace("/(tabs)");
    } catch {
      setError("That email and password did not work. Check both and try again.");
      setBusy(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="grow justify-center px-6 py-10 gap-8"
        contentContainerStyle={SCREEN_CONTENT}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-2">
            <View className="h-10 w-10 items-center justify-center rounded-md bg-primary">
              <Text className="text-[13px] font-bold text-primary-foreground">ST</Text>
            </View>
            <Text className="pt-3 text-[30px] font-bold tracking-tight text-foreground">
              STInventory
            </Text>
            <Text className="text-[15px] leading-5 text-muted-foreground">
              Sign in to see what you are holding and hand tools over.
            </Text>
          </View>

          <View className="gap-4">
            <View className="gap-2">
              <Text className="text-[14px] font-medium text-foreground">Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                placeholder="you@urbaninfra.com"
                placeholderTextColor="#98A0AA"
                className="min-h-[52px] rounded-md border border-input bg-card px-4 text-[16px] text-foreground"
              />
            </View>

            <View className="gap-2">
              <Text className="text-[14px] font-medium text-foreground">Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                onSubmitEditing={submit}
                returnKeyType="go"
                placeholder="••••••••"
                placeholderTextColor="#98A0AA"
                className="min-h-[52px] rounded-md border border-input bg-card px-4 text-[16px] text-foreground"
              />
            </View>

            {error ? (
              <View className="rounded-md border border-crit bg-crit-bg px-4 py-3">
                <Text className="text-[14px] leading-5 text-crit">{error}</Text>
              </View>
            ) : null}

            <Button label={busy ? "Signing in…" : "Sign in"} onPress={submit} busy={busy} />
          </View>

          <View className="gap-2 rounded-md border border-border bg-muted p-4">
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Demo accounts · password stinventory-demo
            </Text>
            {DEMO.map((d) => (
              <Pressable
                key={d.email}
                onPress={() => {
                  setEmail(d.email);
                  setPassword("stinventory-demo");
                }}
                className="min-h-[44px] justify-center rounded-sm py-1"
              >
                <Text className="font-mono text-[12px] text-foreground">{d.email}</Text>
                <Text className="text-[12px] text-muted-foreground">{d.who}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
