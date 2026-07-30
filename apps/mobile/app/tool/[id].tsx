import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { trpc } from "../../lib/trpc";
import { Card, Empty, ErrorNote, Loading, StatusPill, Tag, SCREEN_CONTENT } from "../../components/ui";

export default function ToolDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const asset = trpc.asset.get.useQuery({ id: id! }, { enabled: !!id });
  const events = trpc.transaction.list.useQuery({ assetId: id!, limit: 50 }, { enabled: !!id });

  const a = asset.data;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="flex-row items-center gap-2 border-b border-border px-3 py-2">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          className="min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <Ionicons name="chevron-back" size={24} color="#1B1F26" />
        </Pressable>
        <Text className="text-[16px] font-semibold text-foreground">Tool</Text>
      </View>

      <ScrollView contentContainerClassName="px-5 py-4 gap-5 pb-10"
        contentContainerStyle={SCREEN_CONTENT}>
        {asset.isLoading ? (
          <Loading />
        ) : asset.isError ? (
          <ErrorNote message="Could not load this tool." onRetry={() => asset.refetch()} />
        ) : !a ? (
          <Empty title="No such tool" body="This tag does not exist, or it was removed." />
        ) : (
          <>
            <View className="gap-2">
              <View className="flex-row items-center justify-between">
                <Tag>{a.tag}</Tag>
                <StatusPill status={a.status} />
              </View>
              <Text className="text-[24px] font-bold leading-7 text-foreground">{a.modelName}</Text>
              {a.serialNumber ? (
                <Text className="font-mono text-[13px] text-muted-foreground">
                  Serial {a.serialNumber}
                </Text>
              ) : null}
            </View>

            <Card>
              <View className="gap-3">
                <Row label="Held by" value={a.custodianName ?? "In the yard"} />
                <Row label="On project" value={a.currentProjectName ?? "—"} />
                <Row label="Location" value={a.locationName ?? "—"} />
                <Row label="Condition" value={a.condition ?? "—"} />
              </View>
            </Card>

            {/* The manual path. Present whether or not the parser is reachable —
                the tool screen is the one place a foreman always knows how to
                get to. Which actions make sense depends on where the tool is:
                nothing in the yard needs returning. */}
            <View className="gap-2">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                What do you need to do?
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {(a.custodianId
                  ? ([
                      ["transfer", "Move it"],
                      ["return", "Return it"],
                    ] as const)
                  : ([["assign", "Give it out"]] as const)
                ).map(([type, label]) => (
                  <ActionChip
                    key={type}
                    label={label}
                    onPress={() => router.push(`/action/${type}?assetId=${a.id}`)}
                  />
                ))}
                <ActionChip
                  label="Broken"
                  onPress={() => router.push(`/action/repair?assetId=${a.id}`)}
                />
                <ActionChip
                  label="Missing"
                  tone="crit"
                  onPress={() => router.push(`/action/lost?assetId=${a.id}`)}
                />
                <ActionChip
                  label="Add note"
                  onPress={() => router.push(`/action/report?assetId=${a.id}`)}
                />
              </View>
            </View>

            <View className="gap-3">
              <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                History
              </Text>
              {events.isLoading ? (
                <Loading label="Loading history…" />
              ) : !events.data?.length ? (
                <Empty title="No history recorded" />
              ) : (
                <View className="gap-2">
                  {events.data.map((e) => (
                    <Card key={String(e.id)}>
                      <View className="gap-1">
                        <View className="flex-row items-center justify-between">
                          <Text className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                            {e.eventType.replace(/_/g, " ")}
                          </Text>
                          <Text className="text-[12px] text-muted-foreground">
                            {new Date(e.occurredAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </Text>
                        </View>
                        {e.note ? (
                          <Text className="text-[14px] leading-5 text-foreground">{e.note}</Text>
                        ) : null}
                      </View>
                    </Card>
                  ))}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionChip({
  label,
  onPress,
  tone = "default",
}: {
  label: string;
  onPress: () => void;
  tone?: "default" | "crit";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className={`min-h-[48px] items-center justify-center rounded-md border px-4 ${
        tone === "crit" ? "border-crit bg-crit-bg" : "border-border bg-card"
      }`}
    >
      <Text
        className={`text-[15px] font-semibold ${tone === "crit" ? "text-crit" : "text-foreground"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-baseline justify-between gap-3">
      <Text className="text-[13px] text-muted-foreground">{label}</Text>
      <Text className="flex-1 text-right text-[15px] font-medium text-foreground">{value}</Text>
    </View>
  );
}
