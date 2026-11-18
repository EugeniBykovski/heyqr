import { Skeleton } from "@/shared/ui/skeleton";

/*
 * Route loading states (design "Skeleton": same boxes as the loaded page, shimmer off with reduced motion).
 * Each one announces itself once through a polite status message and is otherwise hidden from assistive tech.
 */

function Status({ label }: { label: string }) {
  return (
    <p role="status" className="sr-only">
      {label}
    </p>
  );
}

const card = "flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:p-6";

/** QR details (4.3 / 4.4): back link, name, layout cards on the left, short link / scans / destination on the right. */
export function QrDetailsSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <Status label={label} />
      <Skeleton className="h-9 w-36 rounded-full" />
      <Skeleton className="h-9 w-2/3 max-w-120 rounded-full" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-32 rounded-full" />
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className={card}>
                <Skeleton className="aspect-square w-full rounded-lg bg-skeleton-accent" />
                <Skeleton className="h-4 w-1/2 rounded-full" />
                <div className="flex gap-2">
                  <Skeleton className="h-9 w-20 rounded-full" />
                  <Skeleton className="h-9 w-20 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className={card}>
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-8 w-3/4 rounded-md" />
          </div>
          <div className={card}>
            <Skeleton className="h-5 w-40 rounded-full" />
            <Skeleton className="h-32 w-full rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Plan & billing (4.9): title, plan card, purchases list. */
export function BillingSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <Status label={label} />
      <Skeleton className="h-9 w-56 rounded-full" />
      <div className={card}>
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-4 w-2/3 rounded-full" />
        <Skeleton className="h-11 w-44 rounded-full" />
      </div>
      <div className={card}>
        <Skeleton className="h-5 w-32 rounded-full" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between gap-4 border-t border-border pt-4 first-of-type:border-t-0">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-1/2 rounded-full" />
              <Skeleton className="h-3 w-1/4 rounded-full" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Export (3.x): the code preview card and the purchase / download card. */
export function ExportSkeleton({ label }: { label: string }) {
  return (
    <section aria-busy="true" className="mx-auto grid max-w-5xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-2 md:items-start">
      <Status label={label} />
      <div className={card}>
        <Skeleton className="aspect-square w-full rounded-lg bg-skeleton-accent" />
      </div>
      <div className={card}>
        <Skeleton className="h-9 w-2/3 rounded-full" />
        <Skeleton className="h-4 w-full rounded-full" />
        <Skeleton className="h-4 w-4/5 rounded-full" />
        <Skeleton className="h-12 w-full rounded-full" />
        <Skeleton className="h-12 w-full rounded-full" />
      </div>
    </section>
  );
}

/** Any other page (pricing, sign-in, legal): heading, lead and a row of cards. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-10 pb-16 sm:px-6 lg:px-8 lg:pt-16">
      <Status label={label} />
      <div className="flex max-w-measure flex-col gap-3">
        <Skeleton className="h-3 w-24 rounded-full" />
        <Skeleton className="h-10 w-3/4 rounded-full" />
        <Skeleton className="h-4 w-full rounded-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className={card}>
            <Skeleton className="h-5 w-1/3 rounded-full" />
            <Skeleton className="h-9 w-1/4 rounded-md" />
            <Skeleton className="h-3 w-full rounded-full" />
            <Skeleton className="h-3 w-5/6 rounded-full" />
            <Skeleton className="h-12 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
