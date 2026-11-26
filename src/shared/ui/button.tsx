import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircleIcon } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/*
 * Design "Button" (heyqr.css .btn, Components · Button): full pill, 600 weight, 44 px (36 sm / 52 lg).
 * Buttons never move on hover: feedback is colour plus a soft ring that pulses out to 10 px (no pulse on ghost and
 * link, none with reduced motion). Pressed: a tiny scale-down in place (98.5 %), not when disabled.
 * Disabled: 40 % opacity (45 % for solid danger). Focus: 2 px violet outline, 2 px offset (globals.css :focus-visible).
 * Transitions: background colour on motion-fast with the design ease; border, transform and shadow on motion-fast.
 *
 * HEY-191 progress (design `.is-loading`): `loading` keeps the button at full strength and focusable, shows the
 * spinner, marks it busy (aria-busy, aria-disabled) with a progress cursor, and swallows clicks, so a pending action
 * can't run twice; `loadingText` replaces the label while it runs ("Preparing…", "Saving…").
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border leading-[1.1] font-semibold whitespace-nowrap no-underline select-none",
    "[transition:background-color_var(--motion-fast)_var(--motion-ease),border-color_var(--motion-fast),transform_var(--motion-fast),box-shadow_var(--motion-fast)]",
    "active:scale-[.985] active:animate-none motion-reduce:hover:animate-none",
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100",
    "not-data-loading:aria-disabled:cursor-not-allowed not-data-loading:aria-disabled:opacity-40 aria-disabled:active:scale-100",
    "data-loading:cursor-progress data-loading:hover:animate-none",
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
        /** Design btn--danger: red label on the neutral button; hover fills with the soft red. */
        danger:
          "border-border bg-surface text-danger shadow-control hover:border-border-hover hover:bg-danger-soft not-disabled:hover:animate-pulse-neutral",
        /** Destructive confirm: solid red (design btn--danger-solid). */
        "danger-solid": "border-transparent bg-danger text-inverse-foreground shadow-danger hover:bg-danger-hover disabled:opacity-45",
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

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** A pending action: spinner, aria-busy, clicks ignored, focus kept (design `.is-loading`). */
    loading?: boolean;
    /** The label while `loading` ("Saving…"); the children stay otherwise. */
    loadingText?: ReactNode;
  };

/** The progress spinner (design `.spin`): 0.9 s a turn, 2.4 s with reduced motion. */
export function ButtonSpinner({ className }: { className?: string }) {
  return <LoaderCircleIcon aria-hidden data-slot="spinner" className={cn("animate-spin-btn", className)} />;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  loadingText,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const busy = loading || undefined;
  const guard = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      // Also stops a form's implicit submit, which reaches the default button as a click.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };
  return (
    <Comp
      {...props}
      data-slot="button"
      data-loading={busy}
      aria-busy={busy ?? props["aria-busy"]}
      aria-disabled={busy ?? props["aria-disabled"]}
      className={cn(buttonVariants({ variant, size }), className)}
      onClick={guard}
    >
      {asChild ? (
        children
      ) : loading ? (
        <>
          <ButtonSpinner />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { buttonVariants };
