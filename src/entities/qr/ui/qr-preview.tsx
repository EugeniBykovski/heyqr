import { composeLayout, layoutCapacity, type Layout } from "@heyqr/qr-core";
import { TextCursorInputIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * Renders a layout as inline SVG. Used for on-screen previews only; downloadable files
 * come from /api/export after the server checks payment.
 * Content that doesn't fit a QR code renders an empty "too long" frame instead of throwing; the surrounding screen
 * says what to do (HEY-24).
 */
export function QrPreview({
  layout,
  value,
  label,
  tooLongLabel,
  className,
  transparent = false,
}: {
  layout: Layout;
  value: string;
  label: string;
  /** Accessible name when the content doesn't fit; defaults to `label`. */
  tooLongLabel?: string;
  className?: string;
  /** Draw without the background (design "Transparent background"), as the transparent export does. */
  transparent?: boolean;
}) {
  if (!layoutCapacity(layout, value).ok)
    return (
      <div
        role="img"
        aria-label={tooLongLabel ?? label}
        data-scan-ok={false}
        data-too-long
        className={cn(
          "grid aspect-square place-items-center rounded-md border-2 border-dashed border-danger bg-danger-soft text-danger",
          className,
        )}
      >
        <TextCursorInputIcon aria-hidden className="size-1/4 max-h-12 max-w-12" strokeWidth={1.6} />
      </div>
    );
  const { svg, scan } = composeLayout(layout, value, { transparent });
  const sized = svg.replace(/\swidth="[^"]*"\s+height="[^"]*"/, ' width="100%" height="100%"');
  return (
    <div
      role="img"
      aria-label={label}
      data-scan-ok={scan.ok}
      className={cn("grid place-items-center [&>svg]:block [&>svg]:h-auto [&>svg]:max-h-full [&>svg]:w-full", className)}
      dangerouslySetInnerHTML={{ __html: sized }}
    />
  );
}
