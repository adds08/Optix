import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { trpc } from "../../lib/trpc";
import { Card, Empty, ErrorNote, Loading, ScreenTitle, Tag } from "../../components/ui";

export default function AlertsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const overdue = trpc.dashboard.overdueLoans.useQuery();
  const notifications = trpc.notification.list.useQuery();
  const utils = trpc.useUtils();

  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => utils.notification.list.invalidate(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([overdue.refetch(), notifications.refetch()]);
    setRefreshing(false);
  }, [overdue, notifications]);

  const loans = overdue.data ?? [];
  const notes = (notifications.data ?? []).filter((n) => !n.readAt);
  const nothing = !loans.length && !notes.length;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerClassName="px-5 py-4 gap-5 pb-10"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1F6E8C" />
        }
      >
        <ScreenTitle title="Alerts" subtitle="Things chasing you, newest first." />

        {overdue.isLoading || notifications.isLoading ? (
          <Loading />
        ) : overdue.isError ? (
          <ErrorNote
            message="Could not reach the equipment system. Check your signal and try again."
            onRetry={onRefresh}
          />
        ) : nothing ? (
          <Empty title="You're clear" body="No overdue tools and nothing waiting on you." />
        ) : (
          <>
            {loans.length ? (
              <View className="gap-3">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Overdue tools
                </Text>
                {loans.map((o) => (
                  <Card key={o.id} className="border-crit">
                    <View className="gap-2">
                      <View className="flex-row items-center justify-between">
                        <Tag>{o.tag}</Tag>
                        <View className="flex-row items-center gap-1">
                          <Ionicons name="time" size={14} color="#9B3B27" />
                          <Text className="text-[13px] font-semibold text-crit">
                            {o.daysOverdue} day{o.daysOverdue === 1 ? "" : "s"} over
                          </Text>
                        </View>
                      </View>
                      <Text className="text-[16px] font-semibold text-foreground">{o.modelName}</Text>
                      <Text className="text-[13px] leading-5 text-muted-foreground">
                        Held by {o.custodianName ?? "—"}. Return it to the yard or hand it over from
                        the Hand Off tab.
                      </Text>
                    </View>
                  </Card>
                ))}
              </View>
            ) : null}

            {notes.length ? (
              <View className="gap-3">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Notifications
                </Text>
                {notes.map((n) => (
                  <Pressable
                    key={n.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Dismiss ${n.title}`}
                    onPress={() => markRead.mutate({ id: n.id })}
                  >
                    <Card>
                      <View className="flex-row items-start gap-3">
                        <Ionicons name="notifications-outline" size={18} color="#69727E" />
                        <View className="flex-1 gap-1">
                          <Text className="text-[15px] font-semibold text-foreground">{n.title}</Text>
                          {n.body ? (
                            <Text className="text-[13px] leading-5 text-muted-foreground">{n.body}</Text>
                          ) : null}
                          <Text className="text-[12px] text-muted-foreground">Tap to dismiss</Text>
                        </View>
                      </View>
                    </Card>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
