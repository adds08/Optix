import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { trpc } from "../../lib/trpc";
import { Card, Empty, ErrorNote, Loading, ScreenTitle, Tag, SCREEN_CONTENT } from "../../components/ui";

export default function AlertsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  /* Alerts are pushed here by other people — a declined request, a tool going
     overdue. Pull-to-refresh alone means an alert is only as timely as the
     next time somebody thinks to check. */
  const live = { refetchInterval: 30_000 };
  const overdue = trpc.dashboard.overdueLoans.useQuery(undefined, live);
  const notifications = trpc.notification.list.useQuery(undefined, live);
  /*
    Who is looking. `overdueLoans` scopes itself to the caller only when they
    are a foreman — a superintendent or the equipment desk gets the whole
    tenant's overdue list, which is correct but means most rows on this screen
    are about somebody else's tool.
  */
  const me = trpc.identity.me.useQuery();
  const myEmployeeId = me.data?.employeeId ?? null;
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
        contentContainerStyle={SCREEN_CONTENT}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1F6E8C" />
        }
      >
        {/* "newest first" was wrong twice over: the list had no ordering at all,
            and on this screen the useful order is worst first, not newest. */}
        <ScreenTitle
          title="Alerts"
          subtitle={
            myEmployeeId && loans.every((o) => o.custodianId === myEmployeeId)
              ? "Things chasing you, most overdue first."
              : "Overdue tools and anything waiting on you, most overdue first."
          }
        />

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
                      {/*
                        Only tell somebody to return a tool if they are the one
                        holding it. This used to read "Held by Sofia Ramirez.
                        Return it to the yard or hand it over from the Hand Off
                        tab" to the equipment desk — an instruction the reader
                        cannot carry out, about a tool they have never touched,
                        pointing at their own Hand Off tab which only moves
                        their own custody.
                      */}
                      <Text className="text-[13px] leading-5 text-muted-foreground">
                        {myEmployeeId && o.custodianId === myEmployeeId
                          ? "You're holding this. Return it to the yard or hand it over from the Hand Off tab."
                          : `Held by ${o.custodianName ?? "somebody not on record"} — due back ${o.expectedEnd ?? "on an unrecorded date"}. Chase the return or move it from the tool's page.`}
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
