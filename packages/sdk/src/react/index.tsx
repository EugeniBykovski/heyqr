import { isHexColor, QrCapacityError, renderQr } from "@heyqr/qr-core";
import { memo, useEffect, useMemo, type CSSProperties, type ReactNode } from "react";

/*
 * HEY-167 / QR-23.01: `@heyqr/sdk/react`, an embeddable QR preview. It renders locally with HeyQR's own renderer
 * (bundled into this entry; nothing is fetched, no API key or account is involved), and never imports the server
 * client. Props are checked before rendering: colours must be hex and shapes come from the renderer's own lists, so
 * nothing a caller passes is written into the SVG markup as text. The value is encoded into modules, never embedded.
 * Empty input shows `placeholder`; a value that can't be encoded or an unsupported option shows `fallback` and calls
 * `onError`. The host app never sees an exception.
 */

/** Data-module shapes the renderer supports. */
export const QR_PATTERNS = ["square", "rounded", "dot", "diamond", "leaf", "fluid", "vbars", "hbars"] as const;
/** Corner-frame shapes. */
export const QR_EYE_FRAMES = ["square", "rounded", "cushion", "circle", "leaf"] as const;
/** Corner-center shapes. */
export const QR_EYE_BALLS = ["square", "rounded", "circle", "diamond", "leaf"] as const;

export type QrPattern = (typeof QR_PATTERNS)[number];
export type QrEyeFrame = (typeof QR_EYE_FRAMES)[number];
export type QrEyeBall = (typeof QR_EYE_BALLS)[number];

/** Why a preview couldn't be drawn. */
export type HeyQrPreviewError = {
  /** too_long: the value doesn't fit in a QR code · invalid_option: an unsupported shape or colour · render_failed: anything else. */
  code: "too_long" | "invalid_option" | "render_failed";
  message: string;
};

export type HeyQrPreviewProps = {
  /** What the code encodes (e.g. a URL). Empty or whitespace shows `placeholder`. */
  value: string;
  /** Data-module shape (default "square"). */
  pattern?: QrPattern;
  /** Corner-frame shape (default "square"). */
  eyeFrame?: QrEyeFrame;
  /** Corner-center shape (default "square"). */
  eyeBall?: QrEyeBall;
  /** Module colour, hex (default "#111111"). */
  color?: string;
  /** Background, hex (default "#FFFFFF"). */
  background?: string;
  /** Corner-frame colour, hex (default: `color`). */
  eyeColor?: string;
  /** Corner-center colour, hex (default: `color`). */
  eyeCenterColor?: string;
  /** Width and height: pixels or any CSS length (default 256). */
  size?: number | string;
  /** Accessible name (default "QR code"). */
  title?: string;
  className?: string;
  style?: CSSProperties;
  /** Shown while `value` is empty (default: an empty box of the same size). */
  placeholder?: ReactNode;
  /** Shown when the code can't be drawn (default: an empty box). */
  fallback?: ReactNode | ((error: HeyQrPreviewError) => ReactNode);
  /** Called once per new error (after render), e.g. to show a message next to the input. */
  onError?: (error: HeyQrPreviewError) => void;
};

type Drawn = { kind: "empty" } | { kind: "error"; error: HeyQrPreviewError } | { kind: "ok"; viewBox: number; inner: string };

const colour = (name: string, value: string): HeyQrPreviewError | null =>
  isHexColor(value) ? null : { code: "invalid_option", message: `${name} must be a hex colour such as #111111` };

function draw(props: HeyQrPreviewProps): Drawn {
  const value = typeof props.value === "string" ? props.value : "";
  if (!value.trim()) return { kind: "empty" };
  const pattern = props.pattern ?? "square";
  const eyeFrame = props.eyeFrame ?? "square";
  const eyeBall = props.eyeBall ?? "square";
  const fg = props.color ?? "#111111";
  const bg = props.background ?? "#FFFFFF";
  const eye = props.eyeColor ?? fg;
  const eyeIn = props.eyeCenterColor ?? fg;
  if (!(QR_PATTERNS as readonly string[]).includes(pattern))
    return { kind: "error", error: { code: "invalid_option", message: `Unsupported pattern "${String(pattern)}"` } };
  if (!(QR_EYE_FRAMES as readonly string[]).includes(eyeFrame))
    return { kind: "error", error: { code: "invalid_option", message: `Unsupported eyeFrame "${String(eyeFrame)}"` } };
  if (!(QR_EYE_BALLS as readonly string[]).includes(eyeBall))
    return { kind: "error", error: { code: "invalid_option", message: `Unsupported eyeBall "${String(eyeBall)}"` } };
  const bad = colour("color", fg) ?? colour("background", bg) ?? colour("eyeColor", eye) ?? colour("eyeCenterColor", eyeIn);
  if (bad) return { kind: "error", error: bad };
  try {
    const r = renderQr(value, { pattern, eyeFrame, eyeBall, colors: { fg, bg, eye, eyeIn } });
    return { kind: "ok", viewBox: r.viewBox, inner: r.inner };
  } catch (error) {
    if (error instanceof QrCapacityError)
      return { kind: "error", error: { code: "too_long", message: "The value is too long for a QR code" } };
    return { kind: "error", error: { code: "render_failed", message: "The QR code couldn't be drawn" } };
  }
}

const cssSize = (size: number | string | undefined) => (size === undefined ? "256px" : typeof size === "number" ? `${size}px` : size);

/** A live QR preview: redraws when `value` or a design option changes. Browser- and server-render-safe. */
export const HeyQrPreview = memo(function HeyQrPreview(props: HeyQrPreviewProps) {
  const { value, pattern, eyeFrame, eyeBall, color, background, eyeColor, eyeCenterColor, onError } = props;
  const drawn = useMemo(
    () => draw({ value, pattern, eyeFrame, eyeBall, color, background, eyeColor, eyeCenterColor } as HeyQrPreviewProps),
    [value, pattern, eyeFrame, eyeBall, color, background, eyeColor, eyeCenterColor],
  );
  const error = drawn.kind === "error" ? drawn.error : null;
  useEffect(() => {
    if (error) onError?.(error);
    // Once per distinct error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error?.code, error?.message]);

  const size = cssSize(props.size);
  const label = props.title ?? "QR code";
  const box: CSSProperties = { width: size, height: size, display: "inline-block", ...props.style };
  if (drawn.kind === "ok")
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={label}
        viewBox={`0 0 ${drawn.viewBox} ${drawn.viewBox}`}
        shapeRendering="geometricPrecision"
        className={props.className}
        style={box}
        data-heyqr-preview="ok"
        dangerouslySetInnerHTML={{ __html: drawn.inner }}
      />
    );
  if (drawn.kind === "empty")
    return (
      <div role="img" aria-label={`${label} (empty)`} className={props.className} style={box} data-heyqr-preview="empty">
        {props.placeholder ?? null}
      </div>
    );
  const content = typeof props.fallback === "function" ? props.fallback(drawn.error) : (props.fallback ?? null);
  return (
    <div
      role="img"
      aria-label={`${label} (unavailable: ${drawn.error.message})`}
      className={props.className}
      style={box}
      data-heyqr-preview="error"
      data-error={drawn.error.code}
    >
      {content}
    </div>
  );
});
