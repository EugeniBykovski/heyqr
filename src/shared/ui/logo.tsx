import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

/*
 * Hey QR identity 4.0.
 * Mark: a QR finder drawn as one hairline squircle ring (radius 8.3, speech-tail corner radius 2) with a violet core,
 * on a 32-unit grid. Ring stroke 2.6 units; 3.2 below 20 px; 3.6 (core radius 3) at 16 px.
 * Wordmark: "Hey" in DM Sans 600 with tight tracking; "QR" at 58 % size, tracking +8 %, in an outlined tag.
 * Clear space = core width on all sides. Below 14 px use the mark alone.
 */

const RING_PATH = "M9.6 1.3H22.4A8.3 8.3 0 0 1 30.7 9.6V22.4A8.3 8.3 0 0 1 22.4 30.7H3.3A2 2 0 0 1 1.3 28.7V9.6A8.3 8.3 0 0 1 9.6 1.3Z";

/** Ring stroke and core radius by rendered size, so the mark still reads as QR at 16 px. */
function markGeometry(px: number) {
  if (px <= 16) return { stroke: 3.6, coreRadius: 3 };
  if (px < 20) return { stroke: 3.2, coreRadius: 3.6 };
  return { stroke: 2.6, coreRadius: 3.6 };
}

const markTone = {
  /** Ink ring, violet core: on paper and white. */
  default: { ring: "stroke-logo-ring", core: "fill-logo-core" },
  /** White ring, violet core: on ink. */
  inverse: { ring: "stroke-inverse-foreground", core: "fill-logo-core" },
  /** All white: on the violet action colour. */
  "on-accent": { ring: "stroke-inverse-foreground", core: "fill-inverse-foreground" },
  /** All ink: one-colour print and grey surfaces. */
  mono: { ring: "stroke-logo-ring", core: "fill-logo-ring" },
} as const;

export type LogoTone = keyof typeof markTone;

export type LogoMarkProps = {
  /** Rendered size in px; sets the stroke weight for small sizes. Defaults to the header size (28). */
  size?: number;
  tone?: LogoTone;
  /** Accessible name. Omit when the mark is decorative or sits next to a visible name. */
  label?: string;
  className?: string;
};

export function LogoMark({ size = 28, tone = "default", label, className }: LogoMarkProps) {
  const { stroke, coreRadius } = markGeometry(size);
  const colors = markTone[tone];
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      data-slot="logo-mark"
      className={cn("block shrink-0", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <path d={RING_PATH} className={cn("fill-none", colors.ring)} strokeWidth={stroke} strokeLinejoin="round" />
      <rect x="10" y="10" width="12" height="12" rx={coreRadius} className={colors.core} />
    </svg>
  );
}

const lockup = cva("inline-flex shrink-0 items-center", {
  variants: {
    size: {
      /** Minimum lockup, 72 px wide. */
      sm: "gap-1.5",
      /** Header: mark 28 px, wordmark 19 px. */
      md: "gap-2.25",
      /** Horizontal primary: mark 56 px, wordmark 44 px. */
      lg: "gap-4",
    },
  },
  defaultVariants: { size: "md" },
});

const word = cva("inline-flex items-center leading-none font-semibold whitespace-nowrap", {
  variants: {
    size: {
      sm: "gap-1 text-[0.875rem] tracking-[-0.03em]",
      md: "gap-1.5 text-[1.1875rem] tracking-[-0.035em]",
      lg: "gap-2.5 text-[2.75rem] tracking-[-0.04em]",
    },
    tone: {
      default: "text-logo-word",
      inverse: "text-inverse-foreground",
    },
  },
  defaultVariants: { size: "md", tone: "default" },
});

const tag = cva("inline-flex items-center leading-none font-semibold", {
  variants: {
    size: {
      sm: "h-3.5 rounded-xs border-[1.2px] px-0.75 text-[0.53125rem] tracking-[0.06em]",
      md: "h-4.5 rounded-[0.375rem] border-[1.5px] px-1.25 text-[0.6875rem] tracking-[0.08em]",
      lg: "h-9 rounded-[0.6875rem] border-[2.5px] px-2.25 text-[1.5rem] tracking-[0.07em]",
    },
    tone: {
      default: "border-logo-core text-logo-tag-text",
      inverse: "border-logo-inverse-tag-border text-logo-inverse-tag-text",
    },
  },
  defaultVariants: { size: "md", tone: "default" },
});

const markSize = { sm: 18, md: 28, lg: 56 } as const;

export type LogoProps = VariantProps<typeof lockup> & {
  /** "default" on paper and white, "inverse" on ink. */
  tone?: "default" | "inverse";
  /** Accessible name of the whole lockup. */
  label?: string;
  className?: string;
};

/** Full lockup: mark + "Hey" + outlined "QR" tag. Exposed to assistive tech as one image named "Hey QR". */
export function Logo({ size, tone = "default", label = "Hey QR", className }: LogoProps) {
  const s = size ?? "md";
  return (
    <span role="img" aria-label={label} data-slot="logo" className={cn(lockup({ size: s }), className)}>
      <LogoMark size={markSize[s]} tone={tone} />
      <span aria-hidden className={word({ size: s, tone })}>
        Hey
        <span className={tag({ size: s, tone })}>QR</span>
      </span>
    </span>
  );
}
