/**
 * app/layout.tsx
 * =============================================================================
 * Wurzel-Layout: umschließt jede Seite der App.
 * Hier stehen Seitentitel, Sprache und die Schriftarten (Geist).
 * =============================================================================
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// Schriften werden beim Build von Google geladen und selbst ausgeliefert.
// `variable` legt eine CSS-Variable an, die globals.css benutzt.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Titel und Beschreibung im Browser-Tab. */
export const metadata: Metadata = {
  title: "AI Platform 2026",
  description: "Chat mit mehreren KI-Modellen und Bildgenerierung",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="de"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
