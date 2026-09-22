import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import PwaRegistrar from "@/app/components/PwaRegistrar";
import "./globals.css";

/**
 * Phase 6 brand typography: Plus Jakarta Sans — a warm geometric sans whose
 * 600/700/800 weights carry headings with tight ("geometric") tracking, while
 * 400/500 serve body and UI text. Self-hosted via next/font for zero layout shift.
 */
const jakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "JesusUnited — Guest-First Ministry Toolkit",
  description:
    "A daily audio reflection, a church gathering map, and automated Sunday pulpit kits — built guest-first.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "JesusUnited",
  },
};

/**
 * PWA viewport: Palette C deep royal lapis chrome around the browser UI.
 * `viewport-fit: cover` keeps standalone-app content clear of notches.
 */
export const viewport: Viewport = {
  themeColor: "#0A1118",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jakartaSans.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col bg-canvas font-sans text-espresso">
        {children}
        {/* Registers /sw.js after load + idle — never blocks first paint. */}
        <PwaRegistrar />
      </body>
    </html>
  );
}
