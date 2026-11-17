"use client";

import type { ComponentProps } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/shared/lib/utils";

/** Design "navlink": 15 px / 500 pill; the current page is a raised white pill. */
export const navLinkClass = cn(
  "inline-flex min-h-10 items-center rounded-full px-3 py-2 text-[0.9375rem] font-medium text-secondary-foreground",
  "transition-[background-color,color,box-shadow] duration-(--motion-fast) hover:bg-subtle hover:text-foreground",
  "aria-[current=page]:bg-surface aria-[current=page]:text-foreground aria-[current=page]:shadow-1",
);

export function NavLink({ href, className, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const pathname = usePathname();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return <Link href={href} aria-current={current ? "page" : undefined} className={cn(navLinkClass, className)} {...props} />;
}
