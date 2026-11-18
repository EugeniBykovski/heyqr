import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

/*
 * Design "Button": full pill, 600 weight, 44 px (36 sm / 52 lg).
 * Buttons never move on hover: feedback is colour plus a soft ring that pulses out to 10 px
 * (violet for primary and accent). Pressed: a tiny scale-down in place (98.5 %).
 * Disabled: 40 % opacity. Focus: 2 px violet outline, 2 px offset.
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border leading-[1.1] font-semibold whitespace-nowrap no-underline select-none",
    "transition-[background-color,border-color,transform,box-shadow] duration-(--motion-fast) ease-out",
    "active:scale-[.985] active:animate-none",
    "disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: [
          "border-transparent bg-primary text-primary-foreground shadow-primary",
          "hover:bg-primary-hover not-disabled:hover:animate-pulse-primary",
          "active:bg-primary-pressed",
        ],
        secondary:
          "border-border bg-surface text-foreground shadow-control hover:border-border-hover hover:bg-subtle not-disabled:hover:animate-pulse-neutral",
        accent:
          "border-accent-strong bg-accent text-accent-foreground shadow-control hover:border-accent-strong-hover hover:bg-accent-hover not-disabled:hover:animate-pulse-accent",
        ghost: "border-transparent bg-transparent text-foreground hover:bg-subtle",
        link: "border-transparent bg-transparent text-foreground underline underline-offset-3",
        danger:
          "border-border bg-surface text-danger shadow-control hover:border-border-hover hover:bg-subtle not-disabled:hover:animate-pulse-neutral",
        /** Destructive confirm: solid red (design btn--danger-solid). */
        "danger-solid": "border-transparent bg-danger text-inverse-foreground shadow-danger hover:bg-danger-hover",
        /** Quiet destructive icon action on cards (design btn--ghost btn--danger). */
        "ghost-danger": "border-transparent bg-transparent text-danger hover:bg-danger-soft",
      },
      size: {
        sm: "min-h-control-sm px-3.5 text-[0.875rem]",
        md: "min-h-control px-4.5 text-[0.9375rem]",
        lg: "min-h-control-lg px-6.5 text-[1rem]",
        icon: "size-control text-[0.9375rem]",
        "icon-sm": "size-control-sm text-[0.875rem]",
      },
    },
    compoundVariants: [{ variant: "link", class: "min-h-8 px-1" }],
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
