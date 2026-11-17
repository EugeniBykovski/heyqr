import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

/** Design: buttons pulse softly on hover (violet for primary), lift 1px, and press down on click. */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border text-label whitespace-nowrap transition-[background-color,border-color,transform,box-shadow] duration-150 ease-out select-none active:translate-y-px active:scale-[.985] active:animate-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "border-transparent bg-primary bg-linear-to-b from-white/18 to-transparent to-60% text-primary-foreground shadow-primary hover:-translate-y-px hover:animate-pulse-primary hover:bg-primary-hover active:bg-primary-pressed",
        secondary: "border-border bg-surface text-foreground shadow-1 hover:animate-pulse-neutral hover:border-ink-300 hover:bg-subtle",
        accent: "border-accent-strong bg-accent text-accent-foreground hover:animate-pulse-neutral hover:bg-violet-100",
        ghost: "border-transparent bg-transparent hover:bg-subtle",
        link: "h-auto border-transparent px-1 underline underline-offset-3",
        danger: "border-border bg-surface text-danger hover:bg-danger-soft",
      },
      size: {
        sm: "h-9 px-3.5",
        md: "h-11 px-4.5 text-body",
        lg: "h-13 px-6.5 text-body-lg font-semibold",
        icon: "size-11",
        "icon-sm": "size-9",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
