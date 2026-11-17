import { Skeleton } from "@/shared/ui/skeleton";
import { libraryActions, libraryList, libraryRow } from "./layout";

/** Loading rows with the real cards' boxes: square thumbnail, title, two badges, two buttons. */
export function QrLibrarySkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <ul aria-busy="true" aria-label={label} className={libraryList}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className={libraryRow}>
          <Skeleton className="aspect-square w-full rounded-[0.625rem]" />
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-4.5 w-2/3 rounded-full" />
            <div className="flex gap-1.5">
              <Skeleton className="h-5.5 w-16 rounded-full" />
              <Skeleton className="h-5.5 w-14 rounded-full" />
            </div>
          </div>
          <div className={libraryActions}>
            <Skeleton className="h-9 w-23 rounded-full" />
            <Skeleton className="h-9 w-30 rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}
