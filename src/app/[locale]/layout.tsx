import type { Metadata, Viewport } from "next";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getCurrency } from "@/server/currency";
import { CurrencyProvider } from "@/shared/lib/currency";
import { CaptionFontFaces } from "@/entities/qr";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { env } from "@/env";
import { textDirection, type Locale } from "@/i18n/locales";
import { routing } from "@/i18n/routing";
import { Providers } from "@/shared/lib/providers";
import { SiteFooter } from "@/widgets/site-footer";
import { SiteHeader } from "@/widgets/site-header";
import "../globals.css";

// Design: DM Sans variable (optical size 9–40, weights 400–700) and IBM Plex Mono 400/500/600.
const dmSans = DM_Sans({ subsets: ["latin", "latin-ext"], axes: ["opsz"], variable: "--font-dm-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono", display: "swap" });

export const viewport: Viewport = { themeColor: "#F7F7F8", width: "device-width", initialScale: 1 };

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "meta" });
  return {
    metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
    title: { default: t("title"), template: "%s · Hey QR" },
    description: t("description"),
    openGraph: { siteName: "Hey QR", type: "website", locale },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const [t, currency] = await Promise.all([getTranslations("nav"), getCurrency()]);

  return (
    <html lang={locale} dir={textDirection(locale)} className={`${dmSans.variable} ${plexMono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <CaptionFontFaces />
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          <Providers>
            <CurrencyProvider value={currency}>
              <SiteHeader />
              <main id="main" className="flex-1">
                {children}
              </main>
              <SiteFooter />
            </CurrencyProvider>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
