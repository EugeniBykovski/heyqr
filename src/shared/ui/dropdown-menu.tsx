"use client";

import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

/* Design "popover" (language picker): white, hairline border, 20 px radius, shadow-3, 12 px padding, pop-in 240 ms. */
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex max-h-(--radix-dropdown-menu-content-available-height) min-w-48 flex-col gap-1 overflow-y-auto rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-3 data-[state=open]:animate-pop",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/* Items: 48 px rows, 12 px radius; hover is the subtle fill, the selected item gets the selected fill and a violet-200 border. */
const item =
  "relative flex min-h-12 cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2.5 py-1.5 text-body outline-none select-none transition-colors duration-(--motion-fast) data-disabled:cursor-not-allowed data-disabled:opacity-40 data-highlighted:bg-subtle [&_svg]:size-4 [&_svg]:shrink-0";

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return <DropdownMenuPrimitive.Item className={cn(item, className)} {...props} />;
}
export function DropdownMenuRadioItem({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(item, "data-[state=checked]:border-accent-strong data-[state=checked]:bg-selected", className)}
      {...props}
    />
  );
}
export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn("px-2.5 py-1.5 text-micro text-muted-foreground uppercase", className)} {...props} />;
}
export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn("-mx-3 my-1 h-px bg-border", className)} {...props} />;
}
