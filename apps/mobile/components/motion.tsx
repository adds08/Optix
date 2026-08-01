import type { ReactNode } from "react";
import { Pressable, type PressableProps, type ViewStyle } from "react-native";
import Animated, {
  FadeInDown,
  FadeOutUp,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

/*
  The motion layer (docs/19, phase 5).

  Three primitives, all reanimated 4 on the new architecture:
  - PressableScale: spring press feedback for anything tappable.
  - ScreenFade: a gentle fade+rise when a screen mounts, so switching tabs
    reads as moving between surfaces instead of swapping pages.
  - AnimatedRow: rows that animate in, and out, when the list they are in
    changes — a chat action confirming must not make its card vanish.

  These are the whole "premium feel" budget. No parallax, no confetti: the
  foreman is in daylight, holding a tool, and the app's job is to not feel
  dead, not to show off.
*/

export function PressableScale({
  style,
  children,
  ...props
}: PressableProps & { style?: ViewStyle }) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[style, animated]}>
      <Pressable
        {...props}
        onPressIn={(e) => {
          scale.value = withSpring(0.97, { damping: 20, stiffness: 300 });
          props.onPressIn?.(e);
        }}
        onPressOut={(e) => {
          scale.value = withSpring(1, { damping: 16, stiffness: 260 });
          props.onPressOut?.(e);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export function ScreenFade({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <Animated.View entering={FadeInDown.duration(260).springify().damping(20)} style={[{ flex: 1 }, style]}>
      {children}
    </Animated.View>
  );
}

export function AnimatedRow({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <Animated.View
      style={style}
      layout={LinearTransition.springify().damping(20)}
      entering={FadeInDown.duration(220)}
      exiting={FadeOutUp.duration(140)}
    >
      {children}
    </Animated.View>
  );
}
