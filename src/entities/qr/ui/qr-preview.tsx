import { composeLayout, type Layout } from "@heyqr/qr-core";
import { cn } from "@/shared/lib/utils";

/**
 * Renders a layout as inline SVG. Used for on-screen previews only; downloadable files
 * come from /api/export after the server checks payment.
 */
export function QrPreview({ layout, value, label, className }: { layout: Layout; value: string; label: string; className?: string }) {
  const { svg, scan } = composeLayout(layout, value);
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
