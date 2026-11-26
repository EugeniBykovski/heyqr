import { Skeleton } from "@/shared/ui/skeleton";

/** The signed-in workspace while its codes and scans load: the same boxes as the loaded section (design 5.x, 6.1). */
export function StudioSkeleton({ label }: { label: string }) {
  return (
    <section
      aria-busy="true"
      aria-label={label}
      className="grid gap-8 py-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14 lg:py-18"
    >
      <p role="status" className="sr-only">
        {label}
      </p>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-3 w-28 rounded-full" />
        <Skeleton className="h-12 w-4/5 rounded-md" />
        <Skeleton className="h-4 w-full max-w-120 rounded-full" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-3.5 w-3/4 rounded-full" />
        ))}
        <div className="flex gap-3 pt-1">
          <Skeleton className="h-13 w-52 rounded-full" />
          <Skeleton className="h-13 w-36 rounded-full" />
        </div>
      </div>
      <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-subtle px-4 py-3 sm:px-5">
          <Skeleton className="h-8 w-44 rounded-full" />
          <Skeleton className="h-7 w-40 rounded-full" />
        </div>
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-12 rounded-md" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-2/3 rounded-full" />
                <Skeleton className="h-3 w-1/3 rounded-full" />
              </div>
              <Skeleton className="h-9 w-24 rounded-full" />
            </div>
          ))}
          <Skeleton className="h-44 w-full rounded-lg" />
        </div>
        <div className="border-t border-border px-4 py-3 sm:px-5">
          <Skeleton className="h-3 w-2/3 rounded-full" />
        </div>
      </div>
    </section>
  );
}
