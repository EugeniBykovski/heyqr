"use client";

import { LogOutIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";

export function SignOutItem() {
  const t = useTranslations("nav");
  const router = useRouter();
  return (
    <DropdownMenuItem
      onSelect={async () => {
        // The auth client (~33 KB) loads on this click: the header is on every page, sign-out is rare.
        const { authClient } = await import("@/shared/lib/auth-client");
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      <LogOutIcon aria-hidden />
      {t("signOut")}
    </DropdownMenuItem>
  );
}
