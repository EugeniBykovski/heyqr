import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/shared/ui/button";

/** Design "lib-tools": title with a one-line summary, and the Create action on the right (wraps under on phones). */
export function LibraryHeader({ title, sub, createLabel }: { title: string; sub: ReactNode; createLabel: string }) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1">{title}</h1>
        <div className="text-secondary-foreground">{sub}</div>
      </div>
      <Button asChild variant="primary">
        <Link href="/create">
          <PlusIcon aria-hidden />
          {createLabel}
        </Link>
      </Button>
    </header>
  );
}
