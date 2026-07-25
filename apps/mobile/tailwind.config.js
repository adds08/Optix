/** @type {import('tailwindcss').Config} */

/*
  Mirrors the web palette in apps/web/app/globals.css, converted to hex because
  NativeWind cannot evaluate oklch(). Keep the two in step — a foreman comparing
  the phone to the office screen should see one product.
*/
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#FAFBFC",
        foreground: "#1B1F26",
        card: "#FFFFFF",
        "card-muted": "#F4F6F8",
        primary: "#1F6E8C",
        "primary-foreground": "#FCFDFD",
        secondary: "#F1F4F6",
        "secondary-foreground": "#2B313A",
        muted: "#F1F4F6",
        "muted-foreground": "#69727E",
        destructive: "#9B3B27",
        "destructive-foreground": "#FCFDFD",
        border: "#DFE4E9",
        input: "#DFE4E9",

        /* Reserved status colors — never used decoratively. */
        ok: "#1F6B57",
        "ok-bg": "#E4F1EC",
        warn: "#8A5A16",
        "warn-bg": "#F8EEDC",
        crit: "#9B3B27",
        "crit-bg": "#F7E3DE",
        idle: "#697079",
        "idle-bg": "#EEF0F2",
      },
      borderRadius: { lg: "10px", md: "6px", sm: "4px" },
    },
  },
};
