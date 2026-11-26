"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

/*
 * Design "segmented control": subtle pill track with a hairline border, 3 px inset;
 * the selected option is a raised white segment (never colour alone). Phones use 16/12 px radii.
 */
export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-4", className)} {...props} />;
}
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("flex w-full min-w-0 flex-wrap gap-0.75 rounded-lg border border-border bg-subtle p-0.75 sm:rounded-full", className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex min-h-9 min-w-0 flex-auto cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-label whitespace-nowrap text-secondary-foreground sm:rounded-full",
        "transition-[background-color,color,box-shadow] duration-(--motion-fast) hover:text-foreground",
        "data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-segment",
        "disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  // HEY-180: panels aren't Tab stops (they draw no focus ring); Tab goes from the tabs to the panel's first control.
  return <TabsPrimitive.Content data-slot="tabs-content" tabIndex={-1} className={cn("animate-rise outline-none", className)} {...props} />;
}
