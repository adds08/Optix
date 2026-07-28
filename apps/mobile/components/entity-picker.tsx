import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { trpc } from "../lib/trpc";

/*
  One picker for every entity the field references.

  Everything resolves to a code and a name — UIC-1012 / Rotary Hammer,
  #4471 / Dwayne Miller — so a single control covers assets, people, projects,
  locations and vehicles. `entity.suggest` already searches both axes, which is
  why nobody has to remember which one the system wants.

  Nothing here accepts free text: the value is an id or it is empty. That is
  what keeps the form incapable of producing the dangling references the parser
  can produce on a bad day.
*/

export type EntityKind = "asset" | "employee" | "project" | "location" | "vehicle";

export type EntityValue = { id: string; label: string } | null;

const PLACEHOLDER: Record<EntityKind, string> = {
  asset: "Search tag, model or serial",
  employee: "Search name or number",
  project: "Search project",
  location: "Search yard, gang box or truck",
  vehicle: "Search unit number",
};

export function EntityPicker({
  kind,
  label,
  value,
  onChange,
  required,
}: {
  kind: EntityKind;
  label: string;
  value: EntityValue;
  onChange: (v: EntityValue) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  /* Two characters before hitting the network — one character matches most of
     the yard and is never the answer anyone wanted. */
  const suggestions = trpc.entity.suggest.useQuery(
    { kind, q: q.trim(), limit: 8 },
    { enabled: open && q.trim().length >= 2 },
  );

  if (!open) {
    return (
      <View className="gap-1.5">
        <FieldLabel label={label} required={required} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={value ? `${label}: ${value.label}. Tap to change` : `Choose ${label}`}
          onPress={() => {
            setOpen(true);
            setQ("");
          }}
          className="min-h-[52px] flex-row items-center justify-between rounded-md border border-input bg-background px-4 py-3"
        >
          <Text
            className={`flex-1 text-[16px] ${value ? "text-foreground" : "text-muted-foreground"}`}
            numberOfLines={1}
          >
            {value ? value.label : "Not set"}
          </Text>
          {value ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Clear ${label}`}
              hitSlop={12}
              onPress={() => onChange(null)}
              className="ml-2"
            >
              <Ionicons name="close-circle" size={22} color="#98A0AA" />
            </Pressable>
          ) : (
            <Ionicons name="search" size={20} color="#98A0AA" />
          )}
        </Pressable>
      </View>
    );
  }

  const results = suggestions.data ?? [];

  return (
    <View className="gap-1.5">
      <FieldLabel label={label} required={required} />
      <View className="overflow-hidden rounded-md border border-primary bg-background">
        <View className="flex-row items-center gap-2 px-4 py-3">
          <Ionicons name="search" size={20} color="#98A0AA" />
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder={PLACEHOLDER[kind]}
            placeholderTextColor="#98A0AA"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            className="min-h-[28px] flex-1 text-[16px] text-foreground"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel search"
            hitSlop={12}
            onPress={() => setOpen(false)}
          >
            <Text className="text-[15px] font-medium text-primary">Cancel</Text>
          </Pressable>
        </View>

        {q.trim().length < 2 ? (
          <Hint text="Type at least two characters." />
        ) : suggestions.isLoading ? (
          <Hint text="Searching…" />
        ) : !results.length ? (
          <Hint text="Nothing matches that. Check the tag or try the model name." />
        ) : (
          <View className="border-t border-border">
            {results.map((r) => (
              <Pressable
                key={r.id}
                accessibilityRole="button"
                accessibilityLabel={r.label}
                onPress={() => {
                  onChange({ id: r.id, label: r.label });
                  setOpen(false);
                }}
                className="min-h-[52px] justify-center border-b border-border px-4 py-2.5"
              >
                <Text className="text-[16px] font-medium text-foreground">{r.label}</Text>
                {r.subtitle ? (
                  <Text className="text-[13px] text-muted-foreground">{r.subtitle}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text className="text-[13px] font-medium text-muted-foreground">
      {label}
      {required ? <Text className="text-crit"> *</Text> : null}
    </Text>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <Text className="border-t border-border px-4 py-3 text-[14px] text-muted-foreground">
      {text}
    </Text>
  );
}
