"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";

/** The home page renders its own full footer (HomeFooter); every other page keeps the compact one. */
export function HideOnHome({ children }: { children: ReactNode }) {
  return usePathname() === "/" ? null : children;
}
