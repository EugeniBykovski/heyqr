"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      toastOptions={{
        classNames: { toast: "!rounded-lg !border-border !bg-ink-950 !text-white !shadow-3 !font-sans", description: "!text-ink-300" },
      }}
      {...props}
    />
  );
}
