"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/shared/lib/auth-client";
import { Button } from "@/shared/ui/button";

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-5">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4C12.9 4 4 12.9 4 24s8.9 20 20 20s20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4C16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/**
 * Google is the only sign-in method. `callbackURL` brings the user back to where they were (e.g. the editor);
 * `errorCallbackURL` is where a canceled or failed Google sign-in returns (HEY-72: the sign-in page, not Better Auth's).
 */
export function GoogleSignInButton({
  callbackURL,
  errorCallbackURL,
  variant,
}: {
  callbackURL: string;
  errorCallbackURL?: string;
  /** Export's guest action is the primary button (design 3.1); the sign-in page uses the default. */
  variant?: "primary";
}) {
  const t = useTranslations("auth");
  const [pending, setPending] = useState(false);
  // Back from Google restores this page from the back/forward cache with the button still busy: make it usable again.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setPending(false);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  return (
    <Button
      variant={variant}
      size="lg"
      className="w-full"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const { error } = await authClient.signIn.social({ provider: "google", callbackURL, errorCallbackURL });
        if (error) {
          setPending(false);
          toast.error(t("failed"));
        }
      }}
    >
      <GoogleGlyph />
      {t("google")}
    </Button>
  );
}
