import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ServiceWorker } from "@/components/shell/ServiceWorker";
import "./globals.css";

/**
 * Fonts are self-hosted rather than pulled from Google at build time.
 *
 * next/font/google fetches the files during the build, which makes the build
 * depend on network access to a third party -- it failed exactly that way on a
 * machine that could not reach fonts.googleapis.com. Self-hosting also means no
 * request leaves the user's browser to a third party when the app loads, and
 * the files are served from the same origin behind the same cache headers.
 *
 * Latin subset only; these are the weights the design system actually uses.
 *
 * Archivo and Plex Sans are VARIABLE fonts -- one file each, carrying an `fvar`
 * axis, declared with a weight RANGE so the browser interpolates along it.
 *
 * They were previously declared three times apiece, once per weight, pointing at
 * three copies of the same file. That rendered correctly -- a variable face
 * pinned to 600, 700 and 800 gives three real weights -- but it shipped the same
 * bytes under three URLs, all of them `preload`ed, on every page. 157 KB of the
 * 280 KB font payload was the same two files downloaded twice more each. A range
 * gets identical rendering from one download.
 *
 * Plex Mono is genuinely three static faces and stays as it was.
 */
const archivo = localFont({
  variable: "--font-archivo",
  display: "swap",
  src: [{ path: "./fonts/Archivo-var.woff2", weight: "600 800", style: "normal" }],
});

const plexSans = localFont({
  variable: "--font-plex-sans",
  display: "swap",
  src: [{ path: "./fonts/IBMPlexSans-var.woff2", weight: "400 600", style: "normal" }],
});

const plexMono = localFont({
  variable: "--font-plex-mono",
  display: "swap",
  src: [
    { path: "./fonts/IBMPlexMono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/IBMPlexMono-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/IBMPlexMono-600.woff2", weight: "600", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: {
    default: "OBOLO",
    template: "%s · OBOLO",
  },
  description: "Warehouse stock and valuation.",
  appleWebApp: {
    capable: true,
    title: "OBOLO",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e4e6e1" },
    { media: "(prefers-color-scheme: dark)", color: "#101315" },
  ],
};

// Runs before first paint so the themed background is correct on load rather
// than flashing light. Kept inline and dependency-free for that reason.
const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem("obolo-theme");var d=s?s==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.add(d?"dark":"light");}catch(e){document.documentElement.classList.add("light");}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable} h-full`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full">
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
