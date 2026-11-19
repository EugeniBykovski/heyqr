import { composeLayout, layoutGeometry, type Layout } from "@heyqr/qr-core";
import { decodeImage, decodeSvg } from "@heyqr/qr-core/verify";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

/*
 * HEY-50: one uploaded logo across the design's four layouts (QR only, QR + caption, Vertical card, Horizontal card),
 * plus the editor's Frame. The editor offers QR only, caption and Frame; the two cards exist in the shared renderer and
 * are built here from the same design. In every layout the logo sits at the centre of the code on its plate, the scan
 * check passes, and the code decodes to the same payload.
 */
const VALUE = "https://littlefern.cafe/menu?table=4";
// A real 8 × 8 PNG (a dark square), so the renderer and the decoder see an actual image.
const LOGO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNgYGD4z0AEYBxVSF8FAEhQAQEUWW9DAAAAAElFTkSuQmCC";
const design: EditorDesign = { ...DEFAULT_DESIGN, caption: "Little Fern Café", logo: { kind: "image", href: LOGO }, logoSize: 0.22 };
const caption = designToLayout({ ...design, preset: "caption", size: { unit: "px", qr: 600, width: 900, height: 760 } });
const LAYOUTS: [string, Layout][] = [
  ["QR only", designToLayout({ ...design, preset: "qr" })],
  ["QR + caption", designToLayout({ ...design, preset: "caption" })],
  ["Vertical card", { ...caption, preset: "vertical", width: 700, height: 980, qrSize: 600 }],
  ["Horizontal card", { ...caption, preset: "horizontal", width: 1200, height: 640, qrSize: 560 }],
  ["Frame (editor)", designToLayout({ ...design, preset: "frame", frameStyle: "bar" })],
];

describe("an uploaded logo in every layout (HEY-50)", () => {
  for (const [name, layout] of LAYOUTS)
    it(`${name}: logo centred in the code, scan check passes, same payload`, async () => {
      const { svg, scan } = composeLayout(layout, VALUE);
      expect(scan.ok).toBe(true);
      // The code is the nested <svg> placed by the layout; the logo <image> is centred in its viewBox.
      const code = svg.match(/<svg x="([^"]+)" y="([^"]+)" width="([^"]+)" height="[^"]+" viewBox="0 0 ([\d.]+) [\d.]+">/);
      const img = svg.match(/<image href="data:image\/png;base64,[^"]+" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/);
      expect(code && img).toBeTruthy();
      const view = Number(code?.[4]);
      const [ix, iy, iw, ih] = [1, 2, 3, 4].map((i) => Number(img?.[i]));
      expect((ix ?? 0) + (iw ?? 0) / 2).toBeCloseTo(view / 2, 3);
      expect((iy ?? 0) + (ih ?? 0) / 2).toBeCloseTo(view / 2, 3);
      const g = layoutGeometry(layout);
      expect([Number(code?.[1]), Number(code?.[2]), Number(code?.[3])].map((v) => Math.round(v * 1000) / 1000)).toEqual(
        g.qr.map((v) => Math.round(v * 1000) / 1000),
      );
      expect(await decodeSvg(svg, 900)).toBe(VALUE);
      const png = (await renderExport(layout, VALUE, "png", { scale: 1 })).body;
      expect(await decodeImage(new Uint8Array(png))).toBe(VALUE);
    });
});
