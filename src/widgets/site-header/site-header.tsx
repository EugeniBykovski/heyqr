import { CreditCardIcon, LayoutGridIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SignOutItem } from "@/features/auth";
import { LanguageSwitch } from "@/features/language-switch";
import { Link } from "@/i18n/navigation";
import { getSession } from "@/server/auth";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Logo } from "@/shared/ui/logo";

export async function SiteHeader() {
  const t = await getTranslations("nav");
  const session = await getSession();
  const user = session?.user;
  const initials = user?.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-page/85 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-header max-w-page items-center gap-3 px-3 sm:gap-4 sm:px-6">
        <Link href="/" aria-label={t("home")} className="-ml-0.5 flex min-h-11 items-center rounded-sm p-1.5">
          <Logo />
        </Link>
        <nav aria-label="Main" className="ml-2 hidden items-center gap-1 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link href="/create">{t("create")}</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/pricing">{t("pricing")}</Link>
          </Button>
          {user ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">{t("myCodes")}</Link>
            </Button>
          ) : null}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitch />
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t("account")}
                className="grid size-9 cursor-pointer place-items-center rounded-full bg-violet-100 text-caption font-bold text-violet-800"
              >
                {initials}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="normal-case">{user.email}</DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard">
                    <LayoutGridIcon aria-hidden />
                    {t("myCodes")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/billing">
                    <CreditCardIcon aria-hidden />
                    {t("billing")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <SignOutItem />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild size="sm">
              <Link href="/sign-in">{t("signIn")}</Link>
            </Button>
          )}
          <Button asChild variant="primary" size="sm" className="hidden sm:inline-flex">
            <Link href="/create">{t("create")}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
