"use client";

import { useEffect, useState } from "react";
import { reportPageFailure } from "@/shared/lib/monitoring/report-client";
import "./globals.css";

/**
 * HEY-175: the root layout itself failed (no translations or providers are available here, so the copy is English).
 * Reported once, with the route template only.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const [ref, setRef] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the reference is known only once the report is made
    setRef(reportPageFailure(error, "global"));
  }, [error]);
  return (
    <html lang="en">
      <body className="min-h-dvh bg-page text-foreground">
        <title>Something went wrong · Hey QR</title>
        <main role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
          <h1 className="text-h1">Something went wrong</h1>
          <p className="text-body text-secondary-foreground">HeyQR couldn’t load this page. Please try again.</p>
          <button
            type="button"
            onClick={() => retry()}
            className="min-h-11 cursor-pointer rounded-full bg-primary px-5 text-label text-primary-foreground"
          >
            Try again
          </button>
          {ref ? <p className="font-mono text-caption text-muted-foreground">Reference: {ref}</p> : null}
        </main>
      </body>
    </html>
  );
}
