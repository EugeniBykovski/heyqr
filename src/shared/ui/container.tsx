import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

/*
 * Design "wrap": page content capped at 1240 px (1440 px from 1920), gutters 16 / 24 / 32 px at 0 / 600 / 1024.
 * "narrow" caps forms and reading pages at 900 px (960 px from 1920).
 */
const sizes = {
  page: "max-w-page 2xl:max-w-[90rem]",
  narrow: "max-w-[56.25rem] 2xl:max-w-[60rem]",
} as const;

export function Container({ size = "page", className, ...props }: ComponentProps<"div"> & { size?: keyof typeof sizes }) {
  return <div data-slot="container" className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", sizes[size], className)} {...props} />;
}
