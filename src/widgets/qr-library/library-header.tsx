import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Button } from "@/shared/ui/button";

/** Design "lib-tools": title with a one-line summary, then Select (when there are codes) and Create (wrap under on phones). */
export function LibraryHeader({
  title,
  sub,
  createLabel,
  actions,
}: {
  title: string;
  sub: ReactNode;
  createLabel: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1">{title}</h1>
        <div className="text-secondary-foreground">{sub}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        {actions}
        <Button asChild variant="primary">
          <Link href="/create">
            <PlusIcon aria-hidden />
            {createLabel}
          </Link>
        </Button>
      </div>
    </header>
  );
}
