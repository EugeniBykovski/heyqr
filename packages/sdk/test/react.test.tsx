// @vitest-environment jsdom
import { decodeSvg } from "@heyqr/qr-core/verify";
import { HeyQrPreview, QR_EYE_BALLS, QR_EYE_FRAMES, QR_PATTERNS, type HeyQrPreviewError } from "@heyqr/sdk/react";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/* HEY-167: the embeddable preview, through its public import. Output is verified by decoding it with ZXing. */
afterEach(cleanup);
const svgOf = (container: HTMLElement) => container.querySelector("svg[data-heyqr-preview=ok]");
const decoded = async (container: HTMLElement) => {
  const svg = svgOf(container);
  if (!svg) return null;
  // A standalone document for the rasterizer (the element's own markup, with its viewBox).
  return decodeSvg(svg.outerHTML.replace(/style="[^"]*"/, ""));
};

describe("HeyQrPreview (HEY-167)", () => {
  it("renders the value as a scannable SVG with its accessible name and size", async () => {
    const { container } = render(<HeyQrPreview value="https://littlefern.cafe/menu" size={200} title="Menu QR" />);
    const svg = svgOf(container);
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Menu QR");
    expect((svg as SVGElement | null)?.style.width).toBe("200px");
    expect(await decoded(container)).toBe("https://littlefern.cafe/menu");
  });

  it("redraws when the value or a design option changes", async () => {
    const { container, rerender } = render(<HeyQrPreview value="https://littlefern.cafe/menu" />);
    const first = svgOf(container)?.innerHTML;
    rerender(<HeyQrPreview value="https://littlefern.cafe/today" />);
    expect(svgOf(container)?.innerHTML).not.toBe(first);
    expect(await decoded(container)).toBe("https://littlefern.cafe/today");
    rerender(<HeyQrPreview value="https://littlefern.cafe/today" color="#8C2F4B" pattern="dot" eyeFrame="rounded" eyeBall="circle" />);
    const styled = svgOf(container)?.innerHTML ?? "";
    expect(styled).toContain("#8C2F4B");
    expect(await decoded(container)).toBe("https://littlefern.cafe/today");
  });

  it("every supported shape renders and scans", async () => {
    for (const pattern of QR_PATTERNS) {
      const { container, unmount } = render(
        <HeyQrPreview value="HEY-167" pattern={pattern} eyeFrame={QR_EYE_FRAMES[0]} eyeBall={QR_EYE_BALLS[0]} />,
      );
      expect(await decoded(container), pattern).toBe("HEY-167");
      unmount();
    }
  }, 30_000);

  it("empty input shows the placeholder, no SVG and no error", () => {
    const onError = vi.fn();
    const { container, getByText } = render(<HeyQrPreview value="   " placeholder={<span>Type a link</span>} onError={onError} />);
    expect(svgOf(container)).toBeNull();
    expect(container.querySelector("[data-heyqr-preview=empty]")).not.toBeNull();
    expect(getByText("Type a link")).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });

  it("a value that can't be encoded shows the fallback and reports once; the host keeps running", () => {
    const onError = vi.fn<(e: HeyQrPreviewError) => void>();
    const tooLong = "x".repeat(5_000);
    const { container, rerender, getByText } = render(
      <HeyQrPreview value={tooLong} onError={onError} fallback={(e) => <span>{`Can't preview: ${e.code}`}</span>} />,
    );
    expect(svgOf(container)).toBeNull();
    expect(container.querySelector("[data-heyqr-preview=error]")?.getAttribute("data-error")).toBe("too_long");
    expect(getByText("Can't preview: too_long")).toBeTruthy();
    rerender(<HeyQrPreview value={tooLong} onError={onError} fallback={(e) => <span>{`Can't preview: ${e.code}`}</span>} />);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ code: "too_long" });
    // Back to a valid value: the preview recovers.
    rerender(<HeyQrPreview value="ok" onError={onError} />);
    expect(svgOf(container)).not.toBeNull();
  });

  it("unsupported options are refused before rendering; nothing a caller passes is written into the markup", () => {
    const onError = vi.fn();
    const injected = '#fff" onload="alert(1)';
    const { container, rerender } = render(<HeyQrPreview value="ok" color={injected} onError={onError} />);
    expect(container.querySelector("[data-heyqr-preview=error]")?.getAttribute("data-error")).toBe("invalid_option");
    expect(container.innerHTML).not.toContain("onload");
    rerender(<HeyQrPreview value="ok" pattern={"stars" as never} onError={onError} />);
    expect(container.querySelector("[data-heyqr-preview=error]")?.getAttribute("data-error")).toBe("invalid_option");
    expect(onError).toHaveBeenCalledTimes(2);
    // The value is encoded, never embedded as text.
    rerender(<HeyQrPreview value={"<script>alert(1)</script>"} />);
    expect(svgOf(container)?.innerHTML).not.toContain("<script");
  });

  it("renders on the server too (SSR) without a DOM", () => {
    const html = renderToString(<HeyQrPreview value="https://littlefern.cafe" size="10rem" />);
    expect(html).toMatch(/^<svg[^>]*role="img"[^>]*data-heyqr-preview="ok"/);
    expect(html).toContain("width:10rem");
  });
});
