import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
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
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jakartaSans.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col bg-canvas font-sans text-espresso">
        {children}
      </body>
    </html>
  );
}
