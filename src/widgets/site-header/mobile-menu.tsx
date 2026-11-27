"use client";

import { MenuIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, usePathname } from "@/i18n/navigation";
import { Button } from "@/shared/ui/button";

type Item = { href: string; label: string };

/**
 * Phones (< 600 px): a menu button in the header opens a panel under it with the primary action
 * first and the other destinations as full-width ghost buttons.
 *
 * HEY-187: while it's open, a dimmed, lightly blurred backdrop covers the page under the header. Tapping it closes the
 * menu, and so do the close button and Escape; each returns focus to the menu button. The backdrop takes the whole tap
 * (it closes on `click`, not on pointer down), so nothing underneath is activated. It is portalled to <body> because
 * the header's backdrop-filter would otherwise make it the containing block of a fixed element.
 */
export function MobileMenu({ menuLabel, primary, items }: { menuLabel: string; primary: Item; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const trigger = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    // The page behind the backdrop doesn't scroll while the menu is open.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="icon"
        className="sm:hidden"
        aria-label={menuLabel}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? <XIcon aria-hidden className="size-5!" /> : <MenuIcon aria-hidden className="size-5!" />}
      </Button>
      {open
        ? createPortal(
            <div
              aria-hidden
              data-slot="mobile-menu-backdrop"
              onClick={close}
              className="fixed inset-0 z-20 animate-fade bg-overlay/60 backdrop-blur-[3px] motion-reduce:animate-none sm:hidden [@media(prefers-reduced-transparency:reduce)]:bg-overlay [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none"
            />,
            document.body,
          )
        : null}
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
