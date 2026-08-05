import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "../../lib/trpc";
import { AnimatedRow, ScreenFade } from "../../components/motion";
import { Card, Empty, ErrorNote, Loading, ScreenTitle, StatusPill, Tag, humanize, SCREEN_CONTENT } from "../../components/ui";

/*
  The Desk, on a phone: every tool in the company, in one list.

  Field users get three tabs because they have three jobs. This is the desk
  view — the whole register, filterable by status and searchable by tag or
  model, so a superintendent standing at a trailer can answer "where is the
  generator?" without walking back to a laptop. Tapping a row opens the tool's
  full custody chain, where the usual actions live.
*/

const STATUS_CHIPS = ["", "available", "assigned", "in_maintenance", "lost"] as const;

export default function DeskScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<(typeof STATUS_CHIPS)[number]>("");
  const [q, setQ] = useState("");

  const tools = trpc.asset.list.useQuery();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await tools.refetch();
    setRefreshing(false);
  }, [tools]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (tools.data ?? []).filter((t) => {
      if (status && t.status !== status) return false;
      if (!needle) return true;
      return [t.tag, t.make, t.modelNumber, t.description, t.serialNumber].some((v) =>
        v?.toLowerCase().includes(needle),
      );
    });
  }, [tools.data, status, q]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScreenFade>
        <ScrollView
          contentContainerClassName="px-5 py-4 gap-4 pb-10"
          contentContainerStyle={SCREEN_CONTENT}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1F6E8C" />}
        >
          <ScreenTitle
            title="Desk"
            subtitle={`Every tool in the register — ${tools.data?.length ?? "…"} of them.`}
          />

          {/* Search */}
          <View className="flex-row items-center gap-2 rounded-md border border-border bg-card px-3">
            <Ionicons name="search" size={18} color="#69727E" />
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search tag, model or serial…"
              placeholderTextColor="#69727E"
              className="min-h-[48px] flex-1 text-[15px] text-foreground"
            />
          </View>

          {/* Status chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2"
          >
            {STATUS_CHIPS.map((s) => {
              const active = status === s;
              return (
                <Pressable
                  key={s || "all"}
                  onPress={() => setStatus(s)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={`rounded-full border px-4 py-2 ${
                    active ? "border-primary bg-primary" : "border-border bg-card"
                  }`}
                >
                  <Text
                    className={`text-[13px] font-semibold ${
                      active ? "text-primary-foreground" : "text-foreground"
                    }`}
                  >
                    {s ? humanize(s) : "All"}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {tools.isLoading ? (
            <Loading label="Getting the register…" />
          ) : tools.isError ? (
            <ErrorNote
              message="Could not reach the equipment system. Check your signal and try again."
              onRetry={() => tools.refetch()}
            />
          ) : !rows.length ? (
            <Empty
              title={q || status ? "No tools match" : "No tools registered"}
              body="Try a different search, or clear the filters."
            />
          ) : (
            <View className="gap-3">
              {rows.map((t) => (
                <AnimatedRow key={t.id}>
                  <Link href={{ pathname: "/tool/[id]", params: { id: t.id } }} asChild>
                    <Pressable accessibilityRole="button">
                      <Card>
                        <View className="gap-2">
                          <View className="flex-row items-center justify-between gap-3">
                            <Tag>{t.tag}</Tag>
                            <StatusPill status={t.status} />
                          </View>
                          <Text className="text-[17px] font-semibold leading-6 text-foreground">
                            {formatAssetModel(t) || "Untagged tool"}
                          </Text>
                          <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                            {t.custodianName ? (
                              <Text className="text-[13px] text-muted-foreground">
                                <Ionicons name="person" size={12} color="#69727E" /> {t.custodianName}
                              </Text>
                            ) : (
                              <Text className="text-[13px] italic text-muted-foreground">In the yard</Text>
                            )}
                            {t.currentProjectName ? (
                              <Text className="text-[13px] text-muted-foreground">
                                {t.currentProjectName}
                              </Text>
                            ) : null}
                            {t.locationName ? (
                              <Text className="text-[13px] text-muted-foreground">
                                {t.locationName}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      </Card>
                    </Pressable>
                  </Link>
                </AnimatedRow>
              ))}
            </View>
          )}
        </ScrollView>
      </ScreenFade>
    </SafeAreaView>
  );
}
