import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from "react-native";
import { PressableScale } from "./motion";

/*
  Field UI primitives.

  Everything here is sized for a gloved thumb in daylight: minimum 48pt touch
  targets, high contrast, no hover states, and labels that say what happens
  rather than what the system calls it.
*/

/*
  Keeps the app phone-shaped when it is served to a browser.

  This app is also exported for web and reached from a desktop, where a
  ScrollView happily stretches to the full width of the monitor. Nothing was
  stopping it, so a card holding forty characters of text was being drawn three
  thousand pixels wide, with the tag on the far left and the day count on the
  far right of a 27-inch screen.

  480 is a large phone. On a real device the constraint never binds — the
  viewport is narrower — so this costs native nothing.
*/
export const SCREEN_CONTENT: ViewStyle = {
  width: "100%",
  maxWidth: 480,
  alignSelf: "center",
};

const TONE = {
  ok: { text: "text-ok", bg: "bg-ok-bg", border: "border-ok" },
  warn: { text: "text-warn", bg: "bg-warn-bg", border: "border-warn" },
  crit: { text: "text-crit", bg: "bg-crit-bg", border: "border-crit" },
  idle: { text: "text-idle", bg: "bg-idle-bg", border: "border-idle" },
} as const;

export type Tone = keyof typeof TONE;

const STATUS_TONE: Record<string, Tone> = {
  available: "ok",
  assigned: "ok",
  active: "ok",
  completed: "ok",
  returned: "idle",
  reserved: "idle",
  transferred: "idle",
  disposed: "idle",
  in_transit: "idle",
  in_maintenance: "warn",
  pending_approval: "warn",
  /* historical only — the verify flow was removed 2026-08-09; no writer can
     produce this, the tone stays so old transfer rows still render */
  pending_verification: "warn",
  action_proposed: "warn",
  pending_manual: "warn",
  overdue: "crit",
  lost: "crit",
  error: "crit",
};

export function toneFor(status?: string | null): Tone {
  return (status && STATUS_TONE[status]) || "idle";
}

export function humanize(s?: string | null): string {
  if (!s) return "Unknown";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusPill({ status, label }: { status?: string | null; label?: string }) {
  const t = TONE[toneFor(status)];
  return (
    <View className={`self-start rounded-sm border px-2 py-1 ${t.bg} ${t.border}`}>
      <Text className={`text-[11px] font-semibold uppercase tracking-wide ${t.text}`}>
        {label ?? humanize(status)}
      </Text>
    </View>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  /* An untagged tool is a normal state, not missing data — it is a tool nobody
     has put a label on yet. Rendering an empty pill would read as a bug, and
     rendering nothing would leave the row with no tag at all. */
  const empty = children === null || children === undefined || children === "";
  return (
    <View className={`self-start rounded-sm px-2 py-1 ${empty ? "bg-transparent" : "bg-muted"}`}>
      <Text className={`font-mono text-[13px] ${empty ? "italic text-muted-foreground" : "text-foreground"}`}>
        {empty ? "no tag" : children}
      </Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "outline" | "danger";
  disabled?: boolean;
  busy?: boolean;
}) {
  const base = "min-h-[52px] flex-row items-center justify-center rounded-md px-5";
  const styles = {
    primary: "bg-primary",
    outline: "border border-border bg-card",
    danger: "bg-crit",
  }[variant];
  const text = {
    primary: "text-primary-foreground",
    outline: "text-foreground",
    danger: "text-primary-foreground",
  }[variant];

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || busy}
      style={{ opacity: disabled || busy ? 0.5 : 1 }}
    >
      <View className={`${base} ${styles}`}>
        {busy ? (
          <ActivityIndicator color={variant === "outline" ? "#1F6E8C" : "#FFFFFF"} />
        ) : (
          <Text className={`text-base font-semibold ${text}`}>{label}</Text>
        )}
      </View>
    </PressableScale>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <View className={`rounded-md border border-border bg-card p-4 ${className}`}>{children}</View>;
}

export function ScreenTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View className="gap-1 pb-2">
      <Text className="text-[26px] font-bold tracking-tight text-foreground">{title}</Text>
      {subtitle ? <Text className="text-[15px] leading-5 text-muted-foreground">{subtitle}</Text> : null}
    </View>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <View className="items-center gap-2 rounded-md border border-dashed border-border bg-card/50 px-6 py-12">
      <Text className="text-center text-base font-semibold text-foreground">{title}</Text>
      {body ? <Text className="text-center text-[14px] leading-5 text-muted-foreground">{body}</Text> : null}
    </View>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View className="items-center gap-3 py-16">
      <ActivityIndicator color="#1F6E8C" />
      <Text className="text-[14px] text-muted-foreground">{label}</Text>
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="gap-3 rounded-md border border-crit bg-crit-bg p-4">
      <Text className="text-[14px] leading-5 text-crit">{message}</Text>
      {onRetry ? <Button label="Try again" variant="outline" onPress={onRetry} /> : null}
    </View>
  );
}
