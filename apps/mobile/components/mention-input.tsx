import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  MENTION_MIN_QUERY,
  activeMentionQuery,
  applyMention,
  type ChatMention,
  type MentionKind,
} from "@stinventory/types";
import { trpc } from "../lib/trpc";

/*
  The message box, with one addition: `@` opens a list.

  A foreman types the sentence they would have texted. Nothing else changes —
  no command to remember, no order to follow, and sending without ever touching
  `@` behaves exactly as it always has. The list is there for when they want to
  be sure the yard knows which tool: `@10` finds UIC-1012, TRU-010 and job
  10021 together, and tapping one leaves the name in the sentence while the id
  travels with it.

  Rows are deliberately tall. This is used one-handed, outdoors, in gloves.
*/

const KIND_ICON: Record<MentionKind, keyof typeof Ionicons.glyphMap> = {
  asset: "construct-outline",
  employee: "person-outline",
  project: "business-outline",
  location: "location-outline",
  vehicle: "car-outline",
};

/* Words from the yard, not from the schema. */
const KIND_LABEL: Record<MentionKind, string> = {
  asset: "Tool",
  employee: "Person",
  project: "Job",
  location: "Place",
  vehicle: "Truck",
};

type Hit = {
  kind: MentionKind;
  id: string;
  label: string;
  subtitle?: string;
};

export function MentionInput({
  value,
  onChange,
  mentions,
  onMentionsChange,
  placeholder = "What happened?",
}: {
  value: string;
  onChange: (v: string) => void;
  mentions: ChatMention[];
  onMentionsChange: (m: ChatMention[]) => void;
  placeholder?: string;
}) {
  const ref = useRef<TextInput>(null);
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  /* Controlling `selection` permanently fights the platform on Android, so it
     is set for exactly one render after an insertion and then released. */
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(null);

  /* The labels already picked tell the parser when a mention is finished —
     without them the query keeps growing past the name and the panel never
     closes, sitting over the keyboard. See activeMentionQuery. */
  const appliedLabels = useMemo(() => mentions.map((m) => m.label), [mentions]);
  const active = useMemo(
    () => activeMentionQuery(value, caret, appliedLabels),
    [value, caret, appliedLabels],
  );
  const open = !!active && active.start !== dismissedAt && active.query.length >= MENTION_MIN_QUERY;

  const results = trpc.entity.search.useQuery(
    { q: active?.query ?? "", limit: 12 },
    { enabled: open, staleTime: 10_000 },
  );

  const hits: Hit[] = open ? ((results.data ?? []) as Hit[]) : [];

  /* A mention only counts while its name is still in the sentence. Deleting
     "@Dwayne Ellis" has to drop the id with it. */
  useEffect(() => {
    const live = mentions.filter((m) => value.includes(m.label));
    if (live.length !== mentions.length) onMentionsChange(live);
  }, [value, mentions, onMentionsChange]);

  /*
    The button does what typing `@` does.

    On a phone keyboard `@` is behind the numeric layer, and a foreman who has
    not been shown the feature will never find it. A visible control is the
    difference between this being used and not — the gesture has to be tappable,
    not remembered.
  */
  function openPicker() {
    const at = caret || value.length;
    const needsSpace = at > 0 && !/\s/.test(value[at - 1] ?? " ");
    const insert = needsSpace ? " @" : "@";
    const next = value.slice(0, at) + insert + value.slice(at);
    onChange(next);
    const caretAt = at + insert.length;
    setCaret(caretAt);
    setPendingSelection({ start: caretAt, end: caretAt });
    setDismissedAt(null);
    ref.current?.focus();
  }

  function pick(hit: Hit) {
    if (!active) return;
    const next = applyMention(value, active.start, caret, hit.label);
    onChange(next.text);
    onMentionsChange([
      ...mentions.filter((m) => !(m.kind === hit.kind && m.id === hit.id)),
      { kind: hit.kind, id: hit.id, label: hit.label },
    ]);
    setCaret(next.caret);
    setPendingSelection({ start: next.caret, end: next.caret });
    setDismissedAt(null);
    ref.current?.focus();
  }

  return (
    <View className="flex-1">
      {open ? (
        <View className="mb-2 overflow-hidden rounded-md border border-primary bg-card">
          {results.isLoading ? (
            <Text className="px-4 py-3 text-[14px] text-muted-foreground">Looking…</Text>
          ) : !hits.length ? (
            <Text className="px-4 py-3 text-[14px] text-muted-foreground">
              Nothing matches that. Carry on typing — the yard desk will still get your message.
            </Text>
          ) : (
            <ScrollView className="max-h-64" keyboardShouldPersistTaps="always">
              {hits.map((hit) => (
                <Pressable
                  key={`${hit.kind}:${hit.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${KIND_LABEL[hit.kind]}: ${hit.label}`}
                  onPress={() => pick(hit)}
                  className="min-h-[56px] flex-row items-center gap-3 border-b border-border px-4 py-3"
                >
                  <Ionicons name={KIND_ICON[hit.kind]} size={20} color="#98A0AA" />
                  <View className="flex-1">
                    <Text className="text-[16px] font-medium text-foreground" numberOfLines={1}>
                      {hit.label}
                    </Text>
                    {hit.subtitle ? (
                      <Text className="text-[13px] text-muted-foreground" numberOfLines={1}>
                        {hit.subtitle}
                      </Text>
                    ) : null}
                  </View>
                  <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {KIND_LABEL[hit.kind]}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      ) : null}

      <View className="flex-row items-end gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Find a tool, person or job"
        onPress={openPicker}
        className="h-[48px] w-[44px] items-center justify-center rounded-md border border-input bg-card"
      >
        <Text className="text-[20px] font-semibold text-primary">@</Text>
      </Pressable>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(t) => {
          onChange(t);
          /* Typing moves the caret to the end of what was typed; the selection
             callback corrects it for mid-sentence edits. */
          setCaret(t.length);
        }}
        selection={pendingSelection ?? undefined}
        onSelectionChange={(e) => {
          setCaret(e.nativeEvent.selection.start);
          if (pendingSelection) setPendingSelection(null);
        }}
        multiline
        placeholder={placeholder}
        placeholderTextColor="#98A0AA"
        className="max-h-28 min-h-[48px] flex-1 rounded-md border border-input bg-background px-4 py-3 text-[16px] text-foreground"
      />
      </View>
    </View>
  );
}

/* What the sentence resolved to, shown before sending. The point of the list
   is that these stopped being guesses, so they are worth showing. */
export function MentionChips({
  mentions,
  onRemove,
}: {
  mentions: ChatMention[];
  onRemove?: (m: ChatMention) => void;
}) {
  if (!mentions.length) return null;
  return (
    <View className="flex-row flex-wrap items-center gap-1.5 px-4 pb-2">
      {mentions.map((m) => (
        <Pressable
          key={`${m.kind}:${m.id}`}
          accessibilityRole={onRemove ? "button" : undefined}
          accessibilityLabel={onRemove ? `Remove ${m.label}` : m.label}
          onPress={onRemove ? () => onRemove(m) : undefined}
          className="flex-row items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1"
        >
          <Ionicons name={KIND_ICON[m.kind]} size={12} color="#98A0AA" />
          <Text className="text-[12px] text-foreground">{m.label}</Text>
          {onRemove ? <Ionicons name="close" size={12} color="#98A0AA" /> : null}
        </Pressable>
      ))}
    </View>
  );
}
