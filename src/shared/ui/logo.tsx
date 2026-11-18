import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/shared/lib/utils";

/*
 * Hey QR identity 5.0.
 * Mark: a QR finder drawn as one hairline squircle ring (radius 8.3, speech-tail corner radius 2) with a violet core,
 * on a 32-unit grid. Ring stroke 2.6 units; 3.2 below 20 px; 3.6 (core radius 3) at 16 px.
 * Wordmark: "Hey" in DM Sans 600 with tight tracking; "QR" is the reply, a solid violet bubble cut from the mark's squircle:
 * height 0.95 × "Hey", gap 0.2 ×, corners 32 % of its height with a 9 % bottom-left tail, "QR" 700 at 52 %, tracking +5 %.
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

const word = cva("inline-flex items-center gap-[0.2em] leading-none font-semibold whitespace-nowrap", {
  variants: {
    size: {
      sm: "text-[0.875rem] tracking-[-0.03em]",
      md: "text-[1.1875rem] tracking-[-0.035em]",
      lg: "text-[2.75rem] tracking-[-0.04em]",
    },
    tone: {
      default: "text-logo-word",
      inverse: "text-inverse-foreground",
    },
  },
  defaultVariants: { size: "md", tone: "default" },
});

/** The QR bubble, sized in em of its own 52 % font size so one rule draws it at every lockup size. */
const tag = cva(
  "relative -top-[0.04em] inline-flex h-[1.82em] min-w-[2.1em] items-center justify-center rounded-[0.58em_0.58em_0.58em_0.16em] px-[0.46em] text-[0.52em] leading-none font-bold tracking-[0.05em] text-logo-tag-text",
  {
    variants: {
      tone: {
        default: "bg-logo-tag",
        inverse: "bg-logo-inverse-tag",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

const markSize = { sm: 18, md: 28, lg: 56 } as const;

export type LogoProps = VariantProps<typeof lockup> & {
  /** "default" on paper and white, "inverse" on ink. */
  tone?: "default" | "inverse";
  /** Accessible name of the whole lockup. */
  label?: string;
  className?: string;
};

/** Full lockup: mark + "Hey" + the violet "QR" bubble. Exposed to assistive tech as one image named "Hey QR". */
export function Logo({ size, tone = "default", label = "Hey QR", className }: LogoProps) {
  const s = size ?? "md";
  return (
    <span role="img" aria-label={label} data-slot="logo" className={cn(lockup({ size: s }), className)}>
      <LogoMark size={markSize[s]} tone={tone} />
      <span aria-hidden className={word({ size: s, tone })}>
        Hey
        <span className={tag({ tone })}>QR</span>
      </span>
    </span>
  );
}
