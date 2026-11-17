"use client";

import { LogOutIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/shared/lib/auth-client";
import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";

export function SignOutItem() {
  const t = useTranslations("nav");
  const router = useRouter();
  return (
    <DropdownMenuItem
      onSelect={async () => {
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
