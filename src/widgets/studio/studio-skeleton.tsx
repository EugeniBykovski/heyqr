import { Skeleton } from "@/shared/ui/skeleton";

const panel = "flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-surface p-4.5 sm:p-5.5";

/** "Your studio" while its numbers load: the same boxes as the loaded section (design Skeleton specimen). */
export function StudioSkeleton({ label }: { label: string }) {
  return (
    <section aria-busy="true" aria-label={label} className="pt-2 pb-6">
      <p role="status" className="sr-only">
        {label}
      </p>
      <div className="flex flex-col gap-5 rounded-2xl border border-border bg-surface p-5 shadow-2 sm:gap-6 sm:p-7 lg:p-9">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex w-full max-w-160 flex-col gap-3">
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="h-9 w-3/4 rounded-full" />
            <Skeleton className="h-4 w-full max-w-120 rounded-full" />
          </div>
          <div className="flex gap-2.5">
            <Skeleton className="h-11 w-32 rounded-full" />
            <Skeleton className="h-11 w-44 rounded-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2.5 rounded-lg border border-border bg-page p-4 sm:p-5">
              <Skeleton className="h-3 w-20 rounded-full" />
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-3 w-3/4 rounded-full" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className={panel}>
            <Skeleton className="h-5 w-40 rounded-full" />
            <Skeleton className="h-36 w-full rounded-md" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
          <div className={panel}>
            <Skeleton className="h-5 w-32 rounded-full" />
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3">
                <Skeleton className="size-13 rounded-md" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-2/3 rounded-full" />
                  <Skeleton className="h-3 w-1/3 rounded-full" />
                </div>
                <Skeleton className="h-9 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
