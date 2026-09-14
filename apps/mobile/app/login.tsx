import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
import { Button, SCREEN_CONTENT } from "../components/ui";


export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
          <View className="gap-3">
            {/*
              The logo on its plate — the supplied artwork, composed once into
              `assets/optix-logo.png` rather than redrawn. It replaced an "ST"
              tile and the word STInventory on 2026-09-01: the product is Optix
              in the interface, and this screen was the last place the old name
              was still being read out to a user.

              A raster rather than the web app's SVG paths because this app has
              no `react-native-svg` and a logo is not worth a native dependency.
              The plate carries its own two colours, so it needs nothing from
              the theme and reads on any background.
            */}
            <Image
              source={require("../assets/optix-logo.png")}
              style={{ width: 174, height: 64 }}
              resizeMode="contain"
              accessibilityRole="image"
              accessibilityLabel="Optix"
            />
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

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
