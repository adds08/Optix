import { colors } from "../tokens/colors";
import { typography } from "../tokens/typography";
import { radii } from "../tokens/radii";

export const tailwindPreset = {
  theme: {
    extend: {
      colors: {
        background: colors.background,
        foreground: colors.foreground,
        card: colors.card,
        "card-foreground": colors.cardForeground,
        primary: colors.primary,
        "primary-foreground": colors.primaryForeground,
        secondary: colors.secondary,
        "secondary-foreground": colors.secondaryForeground,
        muted: colors.muted,
        "muted-foreground": colors.mutedForeground,
        destructive: colors.destructive,
        "destructive-foreground": colors.destructiveForeground,
        border: colors.border,
        input: colors.input,
        ring: colors.ring,
        sidebar: colors.sidebar,
        "sidebar-foreground": colors.sidebarForeground,
        "sidebar-accent": colors.sidebarAccent,
        "sidebar-accent-foreground": colors.sidebarAccentForeground,
      },
      borderRadius: {
        lg: `${radii.lg}px`,
        md: `${radii.md}px`,
        sm: `${radii.sm}px`,
      },
      fontFamily: { sans: [typography.fontSans], mono: [typography.fontMono] },
      fontSize: typography.fontSize,
    },
  },
};
