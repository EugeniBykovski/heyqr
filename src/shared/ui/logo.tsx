import { cn } from "@/shared/lib/utils";

/** Hey QR logo: hairline finder ring with a violet core, "Hey" wordmark and an outlined "QR" tag. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7 shrink-0", className)}>
      <path
        d="M9.6 1.3H22.4A8.3 8.3 0 0 1 30.7 9.6V22.4A8.3 8.3 0 0 1 22.4 30.7H3.3A2 2 0 0 1 1.3 28.7V9.6A8.3 8.3 0 0 1 9.6 1.3Z"
        className="fill-none stroke-foreground stroke-[2.6]"
        strokeLinejoin="round"
      />
      <rect x="10" y="10" width="12" height="12" rx="3.6" className="fill-primary" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="inline-flex items-center gap-1.5 text-h3 font-semibold tracking-tighter">
        Hey
        <span className="inline-flex h-4.5 items-center rounded-[6px] border-[1.5px] border-primary px-1.25 text-micro font-semibold tracking-widest text-violet-700">
          QR
        </span>
      </span>
    </span>
  );
}
