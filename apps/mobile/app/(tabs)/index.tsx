import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { formatAssetModel } from "@stinventory/types";
import { trpc } from "../../lib/trpc";
import { AnimatedRow, ScreenFade } from "../../components/motion";
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await tools.refetch();
    setRefreshing(false);
  }, [tools]);

  const rows = tools.data ?? [];

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScreenFade>
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
