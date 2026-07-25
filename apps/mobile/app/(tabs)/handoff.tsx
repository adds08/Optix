import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { trpc } from "../../lib/trpc";
import { Button, Card, Empty, ErrorNote, Loading, ScreenTitle } from "../../components/ui";

/*
  The whole product thesis on one screen: the foreman types the sentence they
  would have sent to WhatsApp, and it comes back as a custody action to confirm.

  While a message is being parsed we poll — the parse happens in a background
  worker, so the answer arrives a second or two after the send.
*/
export default function HandOffScreen() {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<ScrollView>(null);
  const utils = trpc.useUtils();

  const channels = trpc.messaging.listChannels.useQuery();
  const channelId = channels.data?.[0]?.id;

  const thread = trpc.messaging.messages.useQuery(
    { channelId: channelId!, limit: 30 },
    {
      enabled: !!channelId,
      /* Poll while anything is still being worked on by the parser. */
      refetchInterval: (q) => {
        const items = q.state.data?.items ?? [];
        const busy = items.some(
          (m) => m.processingStatus === "queued" || m.processingStatus === "processing",
        );
        return busy ? 1500 : false;
      },
    },
  );

  const send = trpc.messaging.send.useMutation({
    onSuccess: () => {
      setDraft("");
      if (channelId) utils.messaging.messages.invalidate({ channelId, limit: 30 });
    },
  });

  const confirm = trpc.messaging.confirmAction.useMutation({
    onSuccess: () => {
      if (channelId) utils.messaging.messages.invalidate({ channelId, limit: 30 });
      utils.asset.list.invalidate();
    },
  });

  /* Oldest at top reads like a conversation. */
  const messages = [...(thread.data?.items ?? [])].reverse();

  useEffect(() => {
    if (messages.length) scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  if (channels.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
        <Loading />
      </SafeAreaView>
    );
  }

  if (channels.isError || !channelId) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
        <View className="px-5 py-4">
          <ErrorNote
            message="No equipment channel is available. The yard desk needs to set one up before you can hand tools over here."
            onRetry={() => channels.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={90}
        className="flex-1"
      >
        <View className="px-5 pt-4">
          <ScreenTitle
            title="Hand Off"
            subtitle="Say it the way you'd text it. We'll turn it into a record for you to confirm."
          />
        </View>

        <ScrollView ref={scrollRef} contentContainerClassName="px-5 pb-4 gap-3">
          {!messages.length ? (
            <Empty
              title="Nothing here yet"
              body={'Try: "gave the rotary hammer UIC-1012 to Dwayne for Trinity Bridge"'}
            />
          ) : (
            messages.map((m) => <Bubble key={m.id} m={m} onConfirm={confirm} />)
          )}
        </ScrollView>

        <View className="flex-row items-end gap-2 border-t border-border bg-card px-4 py-3">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder="What happened?"
            placeholderTextColor="#98A0AA"
            className="max-h-28 min-h-[48px] flex-1 rounded-md border border-input bg-background px-4 py-3 text-[16px] text-foreground"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send"
            disabled={!draft.trim() || send.isPending}
            onPress={() => send.mutate({ channelId, body: draft.trim() })}
            className={`h-[48px] w-[48px] items-center justify-center rounded-md bg-primary ${
              !draft.trim() || send.isPending ? "opacity-50" : ""
            }`}
          >
            <Ionicons name="arrow-up" size={22} color="#FCFDFD" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type Msg = {
  id: string;
  body: string;
  processingStatus: string;
  intentType: string | null;
  proposedAction: unknown;
};

function Bubble({
  m,
  onConfirm,
}: {
  m: Msg;
  onConfirm: { mutate: (v: { messageId: string }) => void; isPending: boolean };
}) {
  const action = (m.proposedAction ?? null) as { type?: string; assetIds?: string[] } | null;

  return (
    <View className="gap-2">
      <View className="self-end rounded-md rounded-br-sm bg-primary px-4 py-3">
        <Text className="text-[15px] leading-5 text-primary-foreground">{m.body}</Text>
      </View>

      {m.processingStatus === "queued" || m.processingStatus === "processing" ? (
        <Text className="self-start text-[13px] text-muted-foreground">Reading that…</Text>
      ) : null}

      {m.processingStatus === "action_proposed" && action ? (
        <Card className="border-primary">
          <View className="gap-3">
            <Text className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              Confirm this
            </Text>
            <Text className="text-[16px] leading-6 text-foreground">
              {describe(action.type, m.intentType)}
              {action.assetIds?.length ? ` · ${action.assetIds.length} tool${action.assetIds.length === 1 ? "" : "s"}` : ""}
            </Text>
            <Button
              label="Yes, do it"
              onPress={() => onConfirm.mutate({ messageId: m.id })}
              busy={onConfirm.isPending}
            />
          </View>
        </Card>
      ) : null}

      {m.processingStatus === "action_executed" ? (
        <View className="flex-row items-center gap-1.5 self-start">
          <Ionicons name="checkmark-circle" size={16} color="#1F6B57" />
          <Text className="text-[13px] text-ok">Recorded</Text>
        </View>
      ) : null}

      {m.processingStatus === "pending_manual" ? (
        <View className="rounded-md border border-warn bg-warn-bg px-4 py-3">
          <Text className="text-[14px] leading-5 text-warn">
            The yard desk will pick this up — we could not match it to a tool automatically.
          </Text>
        </View>
      ) : null}

      {m.processingStatus === "error" ? (
        <View className="rounded-md border border-crit bg-crit-bg px-4 py-3">
          <Text className="text-[14px] leading-5 text-crit">
            That message could not be processed. Tell the yard desk directly.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function describe(type?: string, intent?: string | null): string {
  switch (type ?? intent) {
    case "assign":
      return "Give this tool to someone";
    case "transfer":
      return "Move this tool to someone else";
    case "return":
      return "Return this tool to the yard";
    case "lost":
      return "Report this tool missing";
    case "repair":
      return "Send this tool for repair";
    default:
      return "Record this";
  }
}
