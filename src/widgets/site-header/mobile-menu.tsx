"use client";

import { MenuIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { Button } from "@/shared/ui/button";

type Item = { href: string; label: string };

/**
 * Phones (< 600 px): a menu button in the header opens a panel under it with the primary action
 * first and the other destinations as full-width ghost buttons. Closes when a link is chosen and on Escape.
 */
export function MobileMenu({ menuLabel, primary, items }: { menuLabel: string; primary: Item; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="sm:hidden"
        aria-label={menuLabel}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <XIcon aria-hidden className="size-5!" /> : <MenuIcon aria-hidden className="size-5!" />}
      </Button>
      {open ? (
        <nav
          id="mobile-menu"
          aria-label={menuLabel}
          className="absolute inset-x-0 top-full grid animate-rise gap-1 border-t border-border bg-page px-3 pt-2 pb-4 shadow-2 sm:hidden"
        >
          <Button asChild variant="primary" className="w-full">
            <Link href={primary.href} onClick={() => setOpen(false)}>
              {primary.label}
            </Link>
          </Button>
          {items.map((i) => (
            <Button key={i.href} asChild variant="ghost" className="w-full justify-start">
              <Link href={i.href} aria-current={pathname === i.href ? "page" : undefined} onClick={() => setOpen(false)}>
                {i.label}
              </Link>
            </Button>
          ))}
        </nav>
      ) : null}
    </>
  );
}
