import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { Permission } from "@stinventory/types";
import { trpc } from "../../lib/trpc";
import { EntityPicker, type EntityValue } from "../../components/entity-picker";
import { Button, Card, ErrorNote, Loading, StatusPill, Tag, SCREEN_CONTENT } from "../../components/ui";

/*
  The manual path, and the shape the chat confirm card will collapse into.

  Every custody change a foreman can describe in a sentence is reachable here by
  tapping, so the app stays usable when the parser is wrong, slow, or switched
  off entirely. The screen submits to `action.submit`, which is the same
  executor chat confirmations run through — the record is identical either way.
*/

type ActionType = "assign" | "transfer" | "return" | "repair" | "lost" | "report";

const COPY: Record<ActionType, { title: string; blurb: string; verb: string }> = {
  assign: {
    title: "Give this tool out",
    blurb: "Hand it to someone. They hold it until it comes back or moves on.",
    verb: "Give it",
  },
  transfer: {
    title: "Move this tool",
    blurb: "Send it to another person, or park it somewhere.",
    verb: "Move it",
  },
  return: {
    title: "Return this tool",
    blurb: "Bring it back in. It goes back on the available list.",
    verb: "Return it",
  },
  repair: {
    title: "Send for repair",
    blurb: "Something is broken or not working right.",
    verb: "Send it",
  },
  lost: {
    title: "Report it missing",
    blurb: "It cannot be found. Say where it was last seen.",
    verb: "Report it",
  },
  report: {
    title: "Add a note",
    blurb: "Record something about this tool without changing who has it.",
    verb: "Save note",
  },
};

/* Mirrors ACTION_PERMISSIONS on the server. Kept here only to choose the button
   wording — the server decides for real, and a mismatch downgrades to a request
   rather than failing. */
const NEEDS: Record<ActionType, Permission | null> = {
  assign: "assignment.create",
  return: "assignment.create",
  transfer: "transfer.create",
  repair: "asset.manage",
  lost: "asset.manage",
  report: null,
};

const NOTE_REQUIRED: ActionType[] = ["repair", "lost", "report"];

export default function ActionScreen() {
  const params = useLocalSearchParams<{ type: string; assetId: string }>();
  const router = useRouter();
  const utils = trpc.useUtils();

  const type = (params.type ?? "report") as ActionType;
  const assetId = params.assetId;
  const copy = COPY[type] ?? COPY.report;

  const [custodian, setCustodian] = useState<EntityValue>(null);
  const [project, setProject] = useState<EntityValue>(null);
  const [location, setLocation] = useState<EntityValue>(null);
  const [note, setNote] = useState("");

  const me = trpc.identity.me.useQuery();
  const asset = trpc.asset.get.useQuery({ id: assetId! }, { enabled: !!assetId });

  const submit = trpc.action.submit.useMutation({
    onSuccess: () => {
      if (assetId) {
        utils.asset.get.invalidate({ id: assetId });
        utils.transaction.list.invalidate({ assetId });
      }
      utils.asset.list.invalidate();
      utils.dashboard.overdueLoans.invalidate();
      utils.task.list.invalidate();
      router.back();
    },
  });

  const needed = NEEDS[type];
  const permissions = me.data?.permissions ?? [];
  /* Undecided while `me` loads — assume allowed so the button does not flicker
     from "Send request" to the real verb. */
  const willApply = !needed || !me.data || permissions.includes(needed);

  const wantsCustodian = type === "assign" || type === "transfer";
  const wantsPlace = type === "assign" || type === "transfer";
  const noteRequired = NOTE_REQUIRED.includes(type);

  const missing: string[] = [];
  if (type === "assign" && !custodian) missing.push("who is getting it");
  if (type === "transfer" && !custodian && !location) missing.push("where it is going");
  if (noteRequired && !note.trim()) missing.push("a short note");

  const ready = !!assetId && missing.length === 0 && !asset.isLoading;

  if (!assetId) {
    return (
      <View className="flex-1 bg-background px-5 py-6">
        <ErrorNote message="No tool was selected for this action." />
      </View>
    );
  }

  const a = asset.data;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={40}
      className="flex-1 bg-background"
    >
      <ScrollView contentContainerClassName="px-5 py-5 gap-5 pb-8"
        contentContainerStyle={SCREEN_CONTENT} keyboardShouldPersistTaps="handled">
        <View className="gap-1.5">
          <Text className="text-[22px] font-bold leading-7 text-foreground">{copy.title}</Text>
          <Text className="text-[15px] leading-5 text-muted-foreground">{copy.blurb}</Text>
        </View>

        {asset.isLoading ? (
          <Loading label="Loading tool…" />
        ) : a ? (
          <Card>
            <View className="gap-2">
              <View className="flex-row items-center justify-between">
                <Tag>{a.tag}</Tag>
                <StatusPill status={a.status} />
              </View>
              <Text className="text-[17px] font-semibold text-foreground">{a.modelName}</Text>
              <Text className="text-[13px] text-muted-foreground">
                {a.custodianName ? `Held by ${a.custodianName}` : "In the yard"}
              </Text>
            </View>
          </Card>
        ) : (
          <ErrorNote message="Could not load this tool." onRetry={() => asset.refetch()} />
        )}

        {wantsCustodian ? (
          <EntityPicker
            kind="employee"
            label={type === "assign" ? "Who is getting it" : "Give it to"}
            value={custodian}
            onChange={setCustodian}
            required={type === "assign"}
          />
        ) : null}

        {wantsPlace ? (
          <>
            <EntityPicker kind="project" label="Project" value={project} onChange={setProject} />
            <EntityPicker
              kind="location"
              label={type === "transfer" ? "Or park it at" : "Where it will live"}
              value={location}
              onChange={setLocation}
            />
          </>
        ) : null}

        <View className="gap-1.5">
          <Text className="text-[13px] font-medium text-muted-foreground">
            Note{noteRequired ? <Text className="text-crit"> *</Text> : " (optional)"}
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            placeholder={
              type === "lost"
                ? "Where was it last seen?"
                : type === "repair"
                  ? "What is wrong with it?"
                  : "Anything worth recording"
            }
            placeholderTextColor="#98A0AA"
            className="min-h-[96px] rounded-md border border-input bg-background px-4 py-3 text-[16px] leading-6 text-foreground"
            textAlignVertical="top"
          />
        </View>

        {!willApply ? (
          <View className="rounded-md border border-warn bg-warn-bg px-4 py-3">
            <Text className="text-[14px] leading-5 text-warn">
              You can report this, but the yard desk makes the change. It goes to them as a
              request and the tool stays as it is until they sign off.
            </Text>
          </View>
        ) : null}

        {submit.isError ? (
          <ErrorNote message={submit.error.message || "That did not go through. Try again."} />
        ) : null}

        {missing.length ? (
          <Text className="text-[13px] text-muted-foreground">Still need {missing.join(" and ")}.</Text>
        ) : null}

        <View className="gap-2">
          <Button
            label={willApply ? copy.verb : "Send request"}
            onPress={() =>
              submit.mutate({
                type,
                assetIds: [assetId],
                custodianId: custodian?.id,
                projectId: project?.id,
                locationId: location?.id,
                note: note.trim() || undefined,
              })
            }
            disabled={!ready}
            busy={submit.isPending}
            variant={type === "lost" ? "danger" : "primary"}
          />
          <Button label="Cancel" variant="outline" onPress={() => router.back()} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
