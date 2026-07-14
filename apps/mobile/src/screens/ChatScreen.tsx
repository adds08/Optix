import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@stinventory/api-contracts";
import { logoutRequest, trpc } from "../lib/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type MessageItem = RouterOutput["messaging"]["messages"]["items"][number];

type Channel = { id: string; name: string; slug: string };

export default function ChatScreen({ onLogout }: { onLogout: () => void }) {
  const [channel, setChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [composer, setComposer] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);

  // Load channels
  const loadChannels = useCallback(async () => {
    try {
      const chs = await trpc.messaging.listChannels.query();
      if (chs.length > 0 && !channel) {
        setChannel(chs[0]!);
      }
    } catch (err) {
      console.error("Failed to load channels", err);
    }
  }, [channel]);

  // Load messages
  const loadMessages = useCallback(async (reset?: boolean) => {
    if (!channel) return;
    try {
      const res = await trpc.messaging.messages.query({
        channelId: channel.id,
        cursor: reset ? undefined : cursor,
        limit: 30,
      });
      setMessages(reset ? res.items : [...messages, ...res.items]);
      setHasMore(!!res.nextCursor);
      setCursor(res.nextCursor ?? undefined);
    } catch (err) {
      console.error("Failed to load messages", err);
    } finally {
      setLoading(false);
    }
  }, [channel, cursor, messages]);

  useEffect(() => { loadChannels(); }, [loadChannels]);
  useEffect(() => { loadMessages(true); }, [channel?.id]);

  // Send message
  const handleSend = useCallback(async () => {
    if (!channel || !composer.trim()) return;
    setSending(true);
    try {
      await trpc.messaging.send.mutate({ channelId: channel.id, body: composer.trim() });
      setComposer("");
      loadMessages(true);
    } catch (err) {
      Alert.alert("Error", "Failed to send message");
    } finally {
      setSending(false);
    }
  }, [channel, composer, loadMessages]);

  // Confirm action
  const handleConfirm = useCallback(async (messageId: string) => {
    try {
      await trpc.messaging.confirmAction.mutate({ messageId });
      loadMessages(true);
    } catch (err) {
      Alert.alert("Error", "Failed to confirm action");
    }
  }, [loadMessages]);

  function renderMessage({ item }: { item: MessageItem }) {
    const isOwn = true; // In v1, the current user is always the author
    const isActionCard = item.processingStatus === "action_proposed" && !!item.proposedAction;

    return (
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        <Text style={[styles.bubbleText, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther]}>
          {item.body}
        </Text>
        {item.intentType != null && item.intentType !== "none" && (
          <View style={styles.intentBadge}>
            <Text style={styles.intentText}>{item.intentType}</Text>
          </View>
        )}
        {item.processingStatus === "action_executed" && !!item.executedTransactionIds && (
          <Text style={styles.executedLabel}>✓ Executed ({(item.executedTransactionIds as string[]).length} transactions)</Text>
        )}
        {item.processingStatus === "error" && !!item.errorNote && (
          <Text style={styles.errorLabel}>Error: {item.errorNote}</Text>
        )}
        {!!isActionCard && (
          <TouchableOpacity style={styles.confirmButton} onPress={() => handleConfirm(item.id)}>
            <Text style={styles.confirmText}>Confirm Action</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.time}>{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
      </View>
    );
  }

  if (!channel) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading channels...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{channel.name}</Text>
        <TouchableOpacity onPress={onLogout}>
          <Text style={styles.logout}>Logout</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        inverted
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.composerInput}
          placeholder="Type a message..."
          placeholderTextColor="#999"
          value={composer}
          onChangeText={setComposer}
          multiline
          maxLength={2000}
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={sending || !composer.trim()}>
          {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>Send</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { marginTop: 12, color: "#666" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, paddingTop: 56, backgroundColor: "#1a1a2e" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "600" },
  logout: { color: "#ff6b6b", fontSize: 14 },
  list: { flex: 1 },
  listContent: { padding: 12 },
  bubble: { maxWidth: "80%", padding: 12, borderRadius: 12, marginBottom: 8 },
  bubbleOwn: { backgroundColor: "#1a1a2e", alignSelf: "flex-end", borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: "#e8e8e8", alignSelf: "flex-start", borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTextOwn: { color: "#fff" },
  bubbleTextOther: { color: "#1a1a2e" },
  intentBadge: { backgroundColor: "#4ecdc4", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start", marginTop: 6 },
  intentText: { color: "#fff", fontSize: 11, fontWeight: "600", textTransform: "uppercase" },
  executedLabel: { color: "#4ecdc4", fontSize: 12, marginTop: 4 },
  errorLabel: { color: "#ff6b6b", fontSize: 12, marginTop: 4 },
  confirmButton: { backgroundColor: "#4ecdc4", borderRadius: 8, padding: 10, marginTop: 8, alignItems: "center" },
  confirmText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  time: { fontSize: 10, color: "#999", marginTop: 4, alignSelf: "flex-end" },
  composer: { flexDirection: "row", padding: 8, borderTopWidth: 1, borderTopColor: "#ddd", backgroundColor: "#fff", alignItems: "flex-end" },
  composerInput: { flex: 1, backgroundColor: "#f5f5f5", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 100 },
  sendButton: { backgroundColor: "#1a1a2e", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, marginLeft: 8 },
  sendText: { color: "#fff", fontWeight: "600" },
});
