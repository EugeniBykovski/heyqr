"use client";

import { ChevronLeftIcon, ChevronRightIcon, ImageIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Product gallery (design 11.14): the cover first, then the other photos. Previous/Next buttons and the dots move
 * between them; with one photo there are no controls. Without photos, a neutral placeholder.
 */
export function ProductGallery({
  images,
  name,
  labels,
}: {
  images: string[];
  name: string;
  /** `photos[i]` labels photo i ("Photo 2 of 3"); strings only, so a server page can pass them. */
  labels: { region: string; photos: string[]; prev: string; next: string };
}) {
  const [index, setIndex] = useState(0);
  const count = images.length;
  const current = Math.min(index, Math.max(0, count - 1));
  if (!count)
    return (
      <div className="grid aspect-square place-items-center rounded-2xl bg-subtle text-icon-muted">
        <ImageIcon aria-hidden className="size-1/3" strokeWidth={1.4} />
      </div>
    );
  const go = (to: number) => setIndex((to + count) % count);
  return (
    <section aria-roledescription="carousel" aria-label={labels.region} className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element -- owner uploads served by HeyQR, sized by the page */}
      <img
        src={images[current]}
        alt={count > 1 ? `${name} · ${labels.photos[current] ?? ""}` : name}
        className="aspect-square w-full rounded-2xl bg-subtle object-cover"
      />
      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label={labels.prev}
            onClick={() => go(current - 1)}
            className="absolute top-1/2 left-2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-surface/90 shadow-1"
          >
            <ChevronLeftIcon aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            aria-label={labels.next}
            onClick={() => go(current + 1)}
            className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-surface/90 shadow-1"
          >
            <ChevronRightIcon aria-hidden className="size-5" />
          </button>
          <div className="absolute inset-x-0 bottom-2.5 flex justify-center gap-1">
            {images.map((src, i) => (
              <button
                key={`${i}-${src.slice(-12)}`}
                type="button"
                aria-label={labels.photos[i]}
                aria-current={i === current || undefined}
                onClick={() => go(i)}
                className="grid size-6 cursor-pointer place-items-center"
              >
                <span className={cn("block h-1.5 rounded-full bg-surface/60", i === current ? "w-4 bg-surface" : "w-1.5")} />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
