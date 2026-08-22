import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";

/* Inter Tight for everything human-readable, JetBrains Mono for everything
   machine-readable — tags, unit numbers, counts, timestamps and every
   uppercase label. That split is the design system's loudest signal: if a
   string came out of the database, it is set in mono. */
const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = { title: "STInventory", description: "Small tools & equipment management" };

/*
  Repaint the saved appearance before first paint.

  React can only apply a theme once it has mounted and the preferences query has
  come back, so every reload rendered the default palette first and swapped to
  the user's a moment later. Running this synchronously in <head> — off the
  values `applyTheme` caches — means the first frame is already correct. It
  reads resolved variables, never the theme catalog, so this stays a few lines
  and cannot drift from `themes.ts`.
*/
const BOOT_THEME = `
try {
  var r = document.documentElement;
  if (localStorage.getItem('sti-theme') === 'dark' ||
      (!localStorage.getItem('sti-theme') && matchMedia('(prefers-color-scheme: dark)').matches)) {
    r.classList.add('dark');
  }
  var a = JSON.parse(localStorage.getItem('sti-appearance') || 'null');
  if (a) {
    for (var k in a.vars) r.style.setProperty(k, a.vars[k]);
    if (a.fontSize) r.style.fontSize = a.fontSize;
    if (a.fontFamily) r.style.fontFamily = a.fontFamily;
    if (a.density) r.dataset.density = a.density;
    if (a.themeName) r.dataset.theme = a.themeName;
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_THEME }} />
      </head>
      <body className={cn(sans.variable, mono.variable, "font-sans antialiased")}>
        <TooltipProvider>
          <Providers>{children}</Providers>
        </TooltipProvider>
      </body>
    </html>
  );
}
