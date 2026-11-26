import { CreditCardIcon, KeyRoundIcon, LayoutGridIcon, TimerIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SignOutItem } from "@/features/auth";
import { LanguageSwitch } from "@/features/language-switch";
import { Link } from "@/i18n/navigation";
import { getSession } from "@/server/auth";
import { userTrial } from "@/server/billing/entitlements";
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
import { MobileMenu } from "./mobile-menu";
import { NavLink } from "./nav-links";

/*
 * Design "header": translucent paper with blur, hairline bottom border, 60 px high, wide container.
 * Phones: logo, language, Sign in or avatar, menu button. Wider: Pricing / Developers / My QR codes nav and the Create action.
 */
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
  // Design 9.x: once a trial has started, the account menu leads back to it (the server's trial state).
  const phase = user ? await userTrial(user.id) : null;
  const trialItem = phase && phase.state !== "none" && phase.state !== "upgraded";
  const items = [
    { href: "/pricing", label: t("pricing") },
    { href: "/developers", label: t("developers") },
    ...(user
      ? [
          { href: "/dashboard", label: t("myCodes") },
          ...(trialItem ? [{ href: "/dashboard/trial", label: t("trial") }] : []),
          { href: "/dashboard/billing", label: t("billing") },
          { href: "/dashboard/api-keys", label: t("apiKeys") },
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-page/86 backdrop-blur-[14px] backdrop-saturate-160">
      <div className="relative mx-auto flex h-header max-w-wide items-center gap-3 pr-4 pl-3 sm:gap-4 sm:pr-6 sm:pl-5">
        <Link href="/" aria-label={t("home")} className="-ml-0.5 flex min-h-11 items-center rounded-sm p-1.5">
          <Logo />
        </Link>
        <nav aria-label={t("main")} className="hidden items-center gap-0.5 sm:flex">
          <NavLink href="/pricing">{t("pricing")}</NavLink>
          {/* Design header: "API for developers" on desktop, "API" on tablets (the accessible name stays the full one). */}
          <NavLink href="/developers">
            <span aria-hidden className="lg:hidden">
              {t("developersShort")}
            </span>
            <span className="max-lg:sr-only">{t("developers")}</span>
          </NavLink>
          {user ? <NavLink href="/dashboard">{t("myCodes")}</NavLink> : null}
        </nav>
        <div className="ml-auto flex items-center gap-3 sm:gap-4 lg:gap-5">
          <LanguageSwitch />
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t("account", { name: user.name })}
                className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-accent-hover text-caption font-bold text-accent-foreground"
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
                {trialItem ? (
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/trial">
                      <TimerIcon aria-hidden />
                      {t("trial")}
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/billing">
                    <CreditCardIcon aria-hidden />
                    {t("billing")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/api-keys">
                    <KeyRoundIcon aria-hidden />
                    {t("apiKeys")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <SignOutItem />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button asChild variant="ghost" size="sm">
              <Link href="/sign-in">{t("signIn")}</Link>
            </Button>
          )}
          <Button asChild variant="primary" size="sm" className="hidden sm:inline-flex">
            <Link href="/create">{t("createCode")}</Link>
          </Button>
          <MobileMenu menuLabel={t("menu")} primary={{ href: "/create", label: t("createCode") }} items={items} />
        </div>
      </div>
    </header>
  );
}
