"use client";

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

/** Design "segmented control": pill track, white raised selected option. */
export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-4", className)} {...props} />;
}
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("inline-flex w-full items-center gap-1 rounded-full bg-subtle p-1", className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex min-h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-label whitespace-nowrap text-secondary-foreground transition-[background-color,color,box-shadow] data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-1 [&_svg]:size-4",
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("animate-rise outline-none", className)} {...props} />;
}
