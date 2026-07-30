import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../lib/auth";
import { Card, Empty, ErrorNote, Loading, ScreenTitle, StatusPill, Tag, SCREEN_CONTENT } from "../../components/ui";

export default function MyToolsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const me = trpc.identity.me.useQuery();
  const employeeId = me.data?.employeeId ?? undefined;

  /* Scoped to this person. A foreman should never have to filter a company-wide
     list down to their own name. */
  const tools = trpc.asset.list.useQuery(
    { custodianId: employeeId },
    { enabled: !!employeeId },
  );
  const overdue = trpc.dashboard.overdueLoans.useQuery();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([tools.refetch(), overdue.refetch()]);
    setRefreshing(false);
  }, [tools, overdue]);

  const overdueIds = new Set((overdue.data ?? []).map((o) => o.assetId));
  const rows = tools.data ?? [];

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerClassName="px-5 py-4 gap-4 pb-10"
        contentContainerStyle={SCREEN_CONTENT}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1F6E8C" />}
      >
        <View className="flex-row items-start justify-between">
          <ScreenTitle
            title={me.data ? `Hi, ${me.data.firstName}` : "My Tools"}
            subtitle={
              rows.length
                ? `You are holding ${rows.length} tool${rows.length === 1 ? "" : "s"}.`
                : undefined
            }
          />
          <Pressable
            onPress={onSignOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            className="min-h-[44px] min-w-[44px] items-center justify-center"
          >
            <Ionicons name="log-out-outline" size={22} color="#69727E" />
          </Pressable>
        </View>

        {overdueIds.size > 0 ? (
          <View className="flex-row items-center gap-2 rounded-md border border-crit bg-crit-bg px-4 py-3">
            <Ionicons name="alert-circle" size={18} color="#9B3B27" />
            <Text className="flex-1 text-[14px] leading-5 text-crit">
              {overdueIds.size} of your tools {overdueIds.size === 1 ? "is" : "are"} past its due
              date. Return or hand them over.
            </Text>
          </View>
        ) : null}

        {tools.isLoading || me.isLoading ? (
          <Loading label="Getting your tools…" />
        ) : tools.isError ? (
          <ErrorNote
            message="Could not reach the equipment system. Check your signal and try again."
            onRetry={() => tools.refetch()}
          />
        ) : !rows.length ? (
          <Empty
            title="You are not holding any tools"
            body="When the yard issues you something, it will show up here."
          />
        ) : (
          <View className="gap-3">
            {rows.map((t) => (
              <Link key={t.id} href={{ pathname: "/tool/[id]", params: { id: t.id } }} asChild>
                <Pressable accessibilityRole="button">
                  <Card className={overdueIds.has(t.id) ? "border-crit" : ""}>
                    <View className="gap-2">
                      <View className="flex-row items-center justify-between gap-3">
                        <Tag>{t.tag}</Tag>
                        {overdueIds.has(t.id) ? (
                          <StatusPill status="overdue" label="Overdue" />
                        ) : (
                          <StatusPill status={t.status} />
                        )}
                      </View>
                      <Text className="text-[17px] font-semibold leading-6 text-foreground">
                        {t.modelName}
                      </Text>
                      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
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
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
