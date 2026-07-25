/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "hsl(0 0% 100%)",
        foreground: "hsl(0 0% 3.9%)",
        primary: "hsl(0 0% 9%)",
        "primary-foreground": "hsl(0 0% 98%)",
        secondary: "hsl(0 0% 96%)",
        "secondary-foreground": "hsl(0 0% 9%)",
        muted: "hsl(0 0% 96%)",
        "muted-foreground": "hsl(0 0% 46%)",
        destructive: "hsl(0 84% 60%)",
        "destructive-foreground": "hsl(0 0% 98%)",
        border: "hsl(0 0% 90%)",
        input: "hsl(0 0% 90%)",
      },
      borderRadius: { lg: "0.625rem", md: "0.5rem", sm: "0.375rem" },
    },
  },
};
