import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Design `.progress`: an indeterminate 6 px bar, a 40% violet sweep every 1.3 s; with reduced motion a static 60%
 * fill. Decorative: the surrounding status text (role="status") says what is happening.
 */
export function Progress({ className, ...props }: ComponentProps<"div">) {
  return (
    <div data-slot="progress" aria-hidden className={cn("h-1.5 overflow-hidden rounded-full bg-skeleton", className)} {...props}>
      <span className="block h-full w-2/5 animate-indeterminate rounded-full bg-action-primary motion-reduce:w-3/5 motion-reduce:animate-none" />
    </div>
  );
}
