import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/** The public page column: phone width, centred; wider for the Apps page on a computer (design 11.0). */
export function HostedShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className={cn("mx-auto flex min-h-dvh w-full flex-col py-4 sm:py-8", wide ? "max-w-[50rem] px-4" : "max-w-[30rem] px-1 sm:px-4")}>
      <div className="flex flex-1 flex-col rounded-[1.25rem] bg-surface py-3 sm:border sm:border-border sm:shadow-2">{children}</div>
    </main>
  );
}
