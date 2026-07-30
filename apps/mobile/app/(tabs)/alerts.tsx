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

  /*
    Everything on this screen is about the person holding the phone.

    This app is the foreman's tool; the desk works in the browser. So the scope
    is asked for explicitly rather than left to the server's default, which
    widens to the whole tenant for anyone who is not a foreman. Without it a
    superintendent opening the app got the company's entire overdue list under a
    heading that said "chasing you", with instructions to return tools they had
    never touched. Self-scoping is what makes the copy below simply true.
  */
  const me = trpc.identity.me.useQuery();
  const myEmployeeId = me.data?.employeeId ?? undefined;

  const overdue = trpc.dashboard.overdueLoans.useQuery(
    { employeeId: myEmployeeId },
    { ...live, enabled: !!myEmployeeId },
  );
  const notifications = trpc.notification.list.useQuery(undefined, live);
  /* Read-only by design: the desk approves, the foreman needs to know it is
     sitting there. Especially outbound — a tool handed over in the yard is
     still on this person's name until the desk clears it. */
  const waiting = trpc.dashboard.awaitingDesk.useQuery(
    { employeeId: myEmployeeId },
    { ...live, enabled: !!myEmployeeId },
  );
  const utils = trpc.useUtils();

  const markRead = trpc.notification.markRead.useMutation({
    onSuccess: () => utils.notification.list.invalidate(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([overdue.refetch(), notifications.refetch(), waiting.refetch()]);
    setRefreshing(false);
  }, [overdue, notifications, waiting]);

  const loans = overdue.data ?? [];
  const notes = (notifications.data ?? []).filter((n) => !n.readAt);
  const pending = waiting.data ?? [];
  const nothing = !loans.length && !notes.length && !pending.length;

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
        <ScreenTitle title="Alerts" subtitle="Things chasing you, most overdue first." />

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
                      {/* Second person, and now accurate: the query above is
                          scoped to the reader, so every row here is a tool they
                          are personally holding. It used to say "Held by Sofia
                          Ramirez. Return it to the yard..." to whoever opened
                          the app, which for the desk was an instruction they
                          could not carry out about a tool they had never
                          touched. */}
                      <Text className="text-[13px] leading-5 text-muted-foreground">
                        Due back {o.expectedEnd ?? "on an unrecorded date"}. Return it to the yard,
                        or hand it to someone else from the Hand Off tab.
                      </Text>
                    </View>
                  </Card>
                ))}
              </View>
            ) : null}

            {/*
              Sitting with the desk. No buttons: the desk approves, and a
              foreman does not hold transfer.approve. Showing it anyway is the
              point — the outbound rows say "you are still the custodian of
              record", which is the thing a foreman would otherwise get wrong
              after physically handing a tool to somebody.
            */}
            {pending.length ? (
              <View className="gap-3">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  With the equipment desk
                </Text>
                {pending.map((p) => {
                  const outgoing = p.direction === "outgoing";
                  return (
                    <Card key={`${p.kind}-${p.id}`} className={outgoing ? "border-warn" : ""}>
                      <View className="gap-2">
                        <View className="flex-row items-center justify-between">
                          <Tag>{p.tag}</Tag>
                          <View className="flex-row items-center gap-1">
                            <Ionicons
                              name={outgoing ? "hourglass-outline" : "arrow-down-circle-outline"}
                              size={14}
                              color={outgoing ? "#8A5A16" : "#69727E"}
                            />
                            <Text
                              className={`text-[13px] font-semibold ${outgoing ? "text-warn" : "text-muted-foreground"}`}
                            >
                              {outgoing ? "Still yours" : "Coming to you"}
                            </Text>
                          </View>
                        </View>
                        <Text className="text-[16px] font-semibold text-foreground">{p.modelName}</Text>
                        <Text className="text-[13px] leading-5 text-muted-foreground">
                          {outgoing
                            ? `Waiting for the equipment desk to sign it over${p.otherPartyName ? ` to ${p.otherPartyName}` : ""}. It stays on your name until they do — keep track of where it actually is.`
                            : `${p.otherPartyName ? `${p.otherPartyName} is handing this to you` : "The desk is assigning this to you"}. It shows up in My Tools once they sign it off — you are not responsible for it yet.`}
                        </Text>
                      </View>
                    </Card>
                  );
                })}
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
