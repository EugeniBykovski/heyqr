import type { ComponentProps } from "react";
import { cn } from "@/shared/lib/utils";
import { fieldControl } from "./input";

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(fieldControl, "min-h-30 resize-y leading-normal", className)} {...props} />;
}
