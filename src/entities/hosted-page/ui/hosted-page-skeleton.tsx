import { Skeleton } from "@/shared/ui/skeleton";

/**
 * Design 11.0 / 10.8 "Loading": neutral shapes in a hosted page's layout, no owner content and no branding. The same
 * shapes on the public page while it loads and in the editor's phone preview while the draft loads.
 */
export function HostedPageSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3 px-3 py-1">
      <Skeleton className="h-30 rounded-[1.125rem]" />
      <Skeleton className="h-5 w-3/5 rounded-full" />
      <Skeleton className="h-3 w-4/5 rounded-full" />
      <Skeleton className="h-3 w-2/3 rounded-full" />
      <Skeleton className="mt-2 h-11 rounded-full" />
    </div>
  );
}
