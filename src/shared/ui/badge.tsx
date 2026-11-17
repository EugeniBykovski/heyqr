import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

/** Design "Badge": 24 px pill, 12 px / 600, hairline border. Status chips use the soft status fills. */
const badgeVariants = cva(
  "inline-flex h-6 w-fit items-center gap-1 rounded-full border px-2.25 text-[0.75rem] leading-none font-semibold whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "border-border bg-subtle text-secondary-foreground",
        /** Design "badge--dynamic". */
        accent: "border-accent-strong bg-accent text-accent-foreground",
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        danger: "border-transparent bg-danger-soft text-danger",
        info: "border-transparent bg-info-soft text-info",
        dark: "border-transparent bg-inverse text-inverse-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
