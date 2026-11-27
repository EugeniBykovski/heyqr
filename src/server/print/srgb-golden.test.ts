import { createHash } from "node:crypto";
import { rasterizeSvg } from "@heyqr/qr-core/raster";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, DEFAULT_PRINT_SETTINGS, designToLayout, type EditorDesign } from "@/entities/qr";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { printPage, printPdf } = await import("./print");
const { samplePrint } = await import("./sample");

/*
 * HEY-188: the sRGB print PDF is byte-for-byte the file made before CMYK export existed. The hashes were recorded from
 * commit f414d37 (HEY-187) with the same clock, layouts and settings; any change to the sRGB path fails here.
 */
const png = `data:image/png;base64,${rasterizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><circle cx="40" cy="40" r="38" fill="#C8643B"/></svg>`, { width: 80 }).toString("base64")}`;
const svgLogo = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="#C8643B"/></svg>`).toString("base64")}`;
const card = (href: string): EditorDesign => ({
  ...DEFAULT_DESIGN,
  preset: "caption",
  caption: "Scan for the menu",
  fg: "#1F4D3A",
  bg: "#F7F1E6",
  logo: { kind: "image", href },
  logoSize: 0.24,
  size: { unit: "mm", qr: 40, width: 50, height: 62 },
});
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("sRGB print PDF is unchanged (HEY-188)", () => {
  it("is byte-identical to the HEY-187 file for a raster logo, an SVG logo and the brand-card sample", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-27T12:00:00.000Z"), toFake: ["Date"] });
    try {
      const out: string[] = [];
      for (const href of [png, svgLogo]) {
        const layout = designToLayout(card(href));
        const page = printPage(layout, "https://littlefern.coffee/menu", DEFAULT_PRINT_SETTINGS, { layoutId: "l1", revision: "r1" });
        out.push(sha(await printPdf(layout, page, DEFAULT_PRINT_SETTINGS.bleed)));
      }
      const sample = samplePrint("https://heyqr.me");
      out.push(sha(await printPdf(sample.layout, sample.page, sample.settings.bleed)));
      expect(out).toEqual([
        "e0ec87a32efc3c08f06e7fa82a4ad7e2efd2688d91a353c0349cdb554ddb00fe",
        "332de1aaae2aa00d4a0ff5893936e21808953535bdd1a5913ae59bc3aae6ca27",
        "a50e4cd3545c3795c8252335f126c57883cde8773ed89bfe47bc2608e15924f8",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
