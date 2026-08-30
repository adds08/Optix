import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/lib/providers";
import { Inter_Tight, JetBrains_Mono } from "next/font/google";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";

/* Blocky type pairing (ADR-7): Inter Tight for human text, JetBrains Mono for
   machine-readable values. Both are variable fonts, so the weight axes the
   components use (400–700) resolve without loading extra files.

   The variable classes go on <html>, NOT <body>, and that placement is the
   whole reason the font-family preference works at all. next/font declares
   `--font-sans` inside the class it generates; with the class on <body>, the
   variable was defined on <body>, so the theme engine setting it on <html>
   could never reach anything — every font choice in Settings silently rendered
   Inter Tight. Defined at :root, an inline `--font-sans` from applyTheme sits
   on the same element and wins, which is what makes the picker real. */
const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-sans" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Optix",
  description: "AI-assisted tool and equipment custody for construction.",
};

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
  /* Dark is the product's mode, not the OS's. The design is dark-first — light
     is a supported second theme, not the baseline — so an unset preference means
     dark, and only an explicit 'light' turns it off. Reading prefers-color-scheme
     here meant a laptop on the default light OS setting opened the app in the
     secondary theme and made it look like the wrong product. */
  if (localStorage.getItem('sti-theme') !== 'light') {
    r.classList.add('dark');
  }
  var a = JSON.parse(localStorage.getItem('sti-appearance') || 'null');
  if (a) {
    for (var k in a.vars) r.style.setProperty(k, a.vars[k]);
    if (a.fontSize) r.style.fontSize = a.fontSize;
    /* Absent in a cache written before 2026-08-29; the CSS falls back to 1, so
       an old cache renders the icons at their original size rather than at
       zero. */
    if (a.iconScale) r.style.setProperty('--icon-scale', a.iconScale);
    /* fontVars, not fontFamily: the family is applied by overriding --font-sans
       at :root so every font-sans utility follows it. A cache written before
       2026-08-23 carries the old fontFamily key, which is ignored here on
       purpose - it named a font next/font never registered. */
    for (var f in a.fontVars || {}) r.style.setProperty(f, a.fontVars[f]);
    if (a.density) r.dataset.density = a.density;
    if (a.themeName) r.dataset.theme = a.themeName;
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(interTight.variable, jetbrainsMono.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_THEME }} />
      </head>
      <body className="font-sans antialiased">
        <TooltipProvider>
          <Providers>{children}</Providers>
        </TooltipProvider>
      </body>
    </html>
  );
}
