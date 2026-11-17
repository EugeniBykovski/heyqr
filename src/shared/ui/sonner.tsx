"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/* Design "Toast": ink pill card, white 14 px text, violet-300 icon, 16 px radius, shadow-3; 28 px from the bottom on desktop. */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      offset={28}
      mobileOffset={92}
      toastOptions={{
        classNames: {
          toast:
            "!gap-2.5 !rounded-lg !border-0 !bg-inverse !py-3 !pr-3 !pl-4 !font-sans !text-[0.875rem] !leading-[1.4] !text-inverse-foreground !shadow-3",
          description: "!text-inverse-muted",
          icon: "!text-inverse-accent",
          actionButton: "!rounded-sm !bg-transparent !font-semibold !text-inverse-foreground",
          cancelButton: "!rounded-sm !bg-transparent !text-inverse-muted",
          closeButton: "!border-0 !bg-transparent !text-inverse-foreground",
        },
      }}
      {...props}
    />
  );
}
