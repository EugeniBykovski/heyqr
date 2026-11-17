import { CheckIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

/*
 * Design "swatch": a 36 px colour dot. Selected = 2 px surface gap + 2 px violet ring + check mark (never colour only).
 * `color` is a customer colour for the QR itself, so it is passed as a value, not a design token.
 */
export function Swatch({
  color,
  selected,
  checkTone = "light",
  className,
  style,
  ...props
}: Omit<ComponentProps<"button">, "color"> & { color: string; selected: boolean; checkTone?: "light" | "dark" }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-slot="swatch"
      style={{ ...style, backgroundColor: color }}
      className={cn(
        "relative grid size-swatch shrink-0 cursor-pointer place-items-center rounded-full border border-foreground/16 p-0",
        "transition-[transform,box-shadow] duration-(--motion-fast) ease-out hover:scale-107",
        "aria-pressed:shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-selected-border)]",
        className,
      )}
      {...props}
    >
      {selected ? (
        <CheckIcon
          aria-hidden
          strokeWidth={3}
          className={cn("size-3.5", checkTone === "light" ? "text-inverse-foreground" : "text-foreground")}
        />
      ) : null}
    </button>
  );
}
