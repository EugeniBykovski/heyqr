"use client";

import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useRef, type ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/*
 * Design "Dialog & mobile sheet": 440 px card, 28 px radius, shadow-3, 24 px padding, 88 px from the top,
 * over a 42 % ink scrim with a 2 px blur. Below 600 px it becomes a bottom sheet with a grab handle and safe-area padding.
 */
export function DialogContent({
  className,
  children,
  closeLabel,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string }) {
  // HEY-63: Radix returns focus only to a DialogTrigger. Dialogs opened from code (a confirmation after a button, a
  // layout switch) would drop focus on the page body when they close; they return it to what had focus when they opened.
  const returnTo = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-fade" />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col gap-4 overflow-y-auto rounded-t-2xl bg-surface p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-3 data-[state=open]:animate-pop",
          "before:-mt-2.5 before:h-1 before:w-10 before:self-center before:rounded-xs before:bg-border-hover before:content-['']",
          "sm:inset-x-auto sm:top-22 sm:bottom-auto sm:left-1/2 sm:max-h-[calc(100dvh-7.5rem)] sm:w-[min(100%-2rem,27.5rem)] sm:-translate-x-1/2 sm:rounded-2xl sm:pb-6 sm:before:hidden",
          className,
        )}
        onOpenAutoFocus={(e) => {
          returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          onOpenAutoFocus?.(e);
        }}
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e);
          const back = returnTo.current;
          returnTo.current = null;
          if (e.defaultPrevented || !back || back === document.body || !back.isConnected) return;
          e.preventDefault();
          back.focus();
        }}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="absolute top-4 right-4 grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground transition-colors duration-(--motion-fast) hover:bg-subtle hover:text-foreground"
          aria-label={closeLabel}
        >
          <XIcon className="size-4" aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("pr-10 text-h2", className)} {...props} />;
}
export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-body text-secondary-foreground", className)} {...props} />;
}
