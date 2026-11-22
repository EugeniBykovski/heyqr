import { Skeleton, SkeletonText } from "@/shared/ui/skeleton";
import { libraryActions, libraryList, libraryRow } from "./layout";

/**
 * Loading rows with the real cards' boxes (HEY-79, design 5.4): square thumbnail, title, type / model / status badges
 * and the "Updated" note, then the row's actions in the same order and sizes: Delete, Rename (icon only on phones),
 * Edit design and the main action, pushed right on cards like an unpaid code's.
 */
export function QrLibrarySkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <ul aria-busy="true" aria-label={label} className={libraryList}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className={libraryRow}>
          <Skeleton className="aspect-square w-full rounded-[0.625rem]" />
          <div className="flex flex-col gap-1.5">
            <SkeletonText className="text-[1rem]" barClassName="w-2/3" />
            {/* Type, model and status badges, then the "Updated …" note, wrapping like the real row. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <SkeletonText className="w-32 text-caption" />
            </div>
          </div>
          <div className={libraryActions}>
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="h-9 w-11.5 rounded-full sm:w-27" />
            <Skeleton className="h-9 w-26 rounded-full" />
            <Skeleton className="ml-auto h-9 w-40 rounded-full lg:ml-0" />
          </div>
        </li>
      ))}
    </ul>
  );
}
