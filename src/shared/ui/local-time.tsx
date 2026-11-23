"use client";

/**
 * A server timestamp in the viewer's own time zone and locale (e.g. "Nov 23, 2026, 7:32 PM"). Rendered in the browser,
 * so the server's text may differ before hydration.
 */
export function LocalTime({ iso, locale }: { iso: string; locale: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))}
    </time>
  );
}
