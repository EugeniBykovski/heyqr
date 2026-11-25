import type { Metadata, Viewport } from "next";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { env } from "@/env";
import { RTL_LOCALES } from "@/i18n/locales";
import { applyVisitorLocale } from "./locale";
import "../globals.css";

const dmSans = DM_Sans({ subsets: ["latin", "latin-ext"], axes: ["opsz"], variable: "--font-dm-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const viewport: Viewport = { themeColor: "#F7F7F8", width: "device-width", initialScale: 1 };

// Owners' pages are reachable by their printed code; they aren't meant for search engines.
export const metadata: Metadata = { metadataBase: new URL(env.NEXT_PUBLIC_APP_URL), robots: { index: false, follow: false } };

/**
 * Design 11.0: the shared mobile-first layout of every public hosted page. Its own root layout: no site header or
 * footer, just the owner's page in a phone-width column on a quiet background.
 */
export default async function HostedRootLayout({ children }: { children: ReactNode }) {
  const locale = await applyVisitorLocale();
  // Only what the page's client parts use (the report form): the rest renders on the server.
  const all = await getMessages({ locale });
  const messages = { hosted: all.hosted };
  return (
    <html lang={locale} dir={RTL_LOCALES.includes(locale) ? "rtl" : "ltr"} className={`${dmSans.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-page text-foreground">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
