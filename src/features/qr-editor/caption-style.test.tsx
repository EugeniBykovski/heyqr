// @vitest-environment jsdom
import { composeLayout, layoutGeometry } from "@heyqr/qr-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLayoutRecord,
  DEFAULT_DESIGN,
  designFromSaved,
  designSettingsOf,
  designToLayout,
  readDraftDesign,
  serializeDraftDesign,
  type EditorDesign,
} from "@/entities/qr";
import { readPng } from "../../../packages/qr-core/test/png-reader";
import messages from "../../../messages/en.json";
import { FramePanel } from "./frame-panel";

vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: { S3_PUBLIC_URL: undefined, NEXT_PUBLIC_SHORT_LINK_BASE: "https://hey.qr" } }));
const { renderExport } = await import("@/server/qr/export");

afterEach(cleanup);

const VALUE = "https://littlefern.cafe/menu?table=4";
/** Two lines of clearly unequal length, Cyrillic and Latin. */
const CAPTION = "Сканируйте меню · Ёлка Йод\nCafé";
const design = (p: Partial<EditorDesign>): EditorDesign => ({ ...DEFAULT_DESIGN, preset: "caption", caption: CAPTION, ...p });
const lines = (svg: string) => [...svg.matchAll(/<tspan x="([^"]+)"[^>]*>([^<]*)<\/tspan>/g)].map((m) => Number(m[1]));
const anchor = (svg: string) => svg.match(/text-anchor="([^"]+)"/)?.[1];

describe("caption alignment geometry (HEY-46)", () => {
  it("every line anchors at the band's left edge, centre or right edge", () => {
    for (const [align, at, svgAnchor] of [
      ["left", (b: number[]) => b[0], "start"],
      ["center", (b: number[]) => (b[0] ?? 0) + (b[2] ?? 0) / 2, "middle"],
      ["right", (b: number[]) => (b[0] ?? 0) + (b[2] ?? 0), "end"],
    ] as const) {
      const layout = designToLayout(design({ captionAlign: align }));
      const band = layoutGeometry(layout).caption ?? [];
      const svg = composeLayout(layout, VALUE).svg;
      expect(anchor(svg)).toBe(svgAnchor);
      expect(lines(svg)).toEqual([at(band), at(band)].map((v) => Math.round((v ?? 0) * 1000) / 1000));
    }
  });

  it("alignment never moves the code or the caption band", () => {
    const [l, r] = (["left", "right"] as const).map((a) => layoutGeometry(designToLayout(design({ captionAlign: a }))));
    expect(l?.qr).toEqual(r?.qr);
    expect(l?.caption).toEqual(r?.caption);
  });

  it("the frame label stays centred and in the background colour, whatever the caption settings", () => {
    const layout = designToLayout(design({ preset: "frame", captionAlign: "left", captionColor: "#C8102E" }));
    expect(layout.caption.align).toBe("center");
    expect(layout.colors.caption).toBe(DEFAULT_DESIGN.bg);
  });
});

describe("caption colour (HEY-46)", () => {
  it("unset follows the module colour (every older layout); set, it colours only the caption", () => {
    expect(designToLayout(design({ fg: "#1F4D3A" })).colors.caption).toBe("#1F4D3A");
    const layout = designToLayout(design({ fg: "#1F4D3A", captionColor: "#C8102E" }));
    expect(layout.colors).toMatchObject({ fg: "#1F4D3A", eye: "#1F4D3A", eyeIn: "#1F4D3A", caption: "#C8102E" });
    expect(composeLayout(layout, VALUE).svg).toContain(`fill="#C8102E" text-anchor="middle"`);
  });

  it("an invalid colour can't be saved (stored settings use the HEX rule)", () => {
    expect(createLayoutRecord(designToLayout(design({})), { ...designSettingsOf(design({})), captionColor: "#12" })).toBeNull();
  });
});

describe("caption alignment and colour in the exported PNG (HEY-46)", () => {
  for (const align of ["left", "right"] as const)
    it(`${align}: both lines start (or end) at the same edge of the band, in the caption colour; the code still decodes`, async () => {
      const layout = designToLayout(design({ captionAlign: align, captionColor: "#C8102E", fg: "#0D0D12" }));
      const png = readPng(new Uint8Array((await renderExport(layout, VALUE, "png", { scale: 2 })).body));
      const g = layoutGeometry(layout);
      const band = (g.caption ?? []).map((v) => v * 2);
      const top = Math.ceil(band[1] ?? 0);
      // Red-dominant pixels are caption ink (the code is #0D0D12 on white): the caption colour, not the code's.
      const red = (x: number, y: number) => {
        const i = (y * png.width + x) * 4;
        // Covers the second line too, drawn at 72 % opacity (lighter red).
        const [r, g, b] = [png.data[i] ?? 0, png.data[i + 1] ?? 0, png.data[i + 2] ?? 0];
        return r - g > 70 && r - b > 60;
      };
      // Each text line's ink, taken between its own baseline-relative bounds (baselines and sizes from the SVG, ×2).
      const svg = composeLayout(layout, VALUE).svg;
      const rows = [...svg.matchAll(/<tspan x="[^"]+" y="([^"]+)" font-size="([^"]+)"/g)].map((m) => {
        const base = Number(m[1]) * 2;
        const fs = Number(m[2]) * 2;
        let x0 = Infinity;
        let x1 = -1;
        for (let y = Math.max(top, Math.floor(base - fs * 1.05)); y < Math.min(png.height, Math.ceil(base + fs * 0.28)); y++)
          for (let x = 0; x < png.width; x++)
            if (red(x, y)) {
              x0 = Math.min(x0, x);
              x1 = Math.max(x1, x);
            }
        return { x0, x1 };
      });
      const [first, second] = rows.filter((r) => r.x1 - r.x0 > 20);
      expect(first && second).toBeTruthy();
      const left = band[0] ?? 0;
      const right = left + (band[2] ?? 0);
      if (align === "left") {
        expect(Math.abs((first?.x0 ?? 0) - left)).toBeLessThan(6);
        expect(Math.abs((second?.x0 ?? 0) - left)).toBeLessThan(6);
        expect(second?.x1 ?? 0).toBeLessThan((first?.x1 ?? 0) - 100); // the short line ends well before the long one
      } else {
        expect(Math.abs((first?.x1 ?? 0) - right)).toBeLessThan(6);
        expect(Math.abs((second?.x1 ?? 0) - right)).toBeLessThan(6);
        expect(second?.x0 ?? 0).toBeGreaterThan((first?.x0 ?? 0) + 100);
      }
      expect(first?.x0 ?? 0).toBeGreaterThanOrEqual(left - 6); // nothing clipped or outside the band
      expect(first?.x1 ?? 0).toBeLessThanOrEqual(right + 6);
      const { decodeImage } = await import("@heyqr/qr-core/verify");
      expect(await decodeImage(new Uint8Array((await renderExport(layout, VALUE, "png", { scale: 2 })).body))).toBe(VALUE);
    });
});

describe("caption alignment and colour persist (HEY-46)", () => {
  it("survive the draft round trip and the saved layout, and reopen in Edit design", () => {
    const d = design({ captionAlign: "right", captionColor: "#1F4ED8" });
    const read = readDraftDesign(JSON.parse(JSON.stringify(serializeDraftDesign(d))), DEFAULT_DESIGN);
    expect(read.ok && [read.value.captionAlign, read.value.captionColor]).toEqual(["right", "#1F4ED8"]);
    const record = createLayoutRecord(designToLayout(d), designSettingsOf(d));
    if (!record) throw new Error("invalid");
    const reopened = designFromSaved({ name: "x", model: "static", content: { type: "website", url: VALUE } }, record);
    expect([reopened.captionAlign, reopened.captionColor]).toEqual(["right", "#1F4ED8"]);
  });

  it("older drafts without them keep centred captions in the module colour; records from the rendered layout recover them", () => {
    const read = readDraftDesign({ schemaVersion: 1, ...DEFAULT_DESIGN, preset: "caption", caption: "x" }, DEFAULT_DESIGN);
    expect(read.ok && [read.value.captionAlign, read.value.captionColor]).toEqual([undefined, undefined]);
    const legacy = createLayoutRecord(designToLayout(design({ captionAlign: "left", captionColor: "#8C2F4B" })));
    if (!legacy) throw new Error("invalid");
    const reopened = designFromSaved({ name: "x", model: "static", content: { type: "text", text: "x" } }, legacy);
    expect([reopened.captionAlign, reopened.captionColor]).toEqual(["left", "#8C2F4B"]);
  });
});

describe("Caption color field (HEY-46)", () => {
  function Harness() {
    const [d, setD] = useState<EditorDesign>(design({}));
    return (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <FramePanel design={d} onChange={(p) => setD((x) => ({ ...x, ...p }))} />
        <output data-testid="rendered">{designToLayout(d).colors.caption}</output>
        <output data-testid="align">{designToLayout(d).caption.align}</output>
      </NextIntlClientProvider>
    );
  }
  const rendered = () => screen.getByTestId("rendered").textContent;

  it("palette, valid HEX, partial and invalid HEX keep the last valid colour, then recover; alignment buttons apply", () => {
    render(<Harness />);
    expect(rendered()).toBe(DEFAULT_DESIGN.fg);
    fireEvent.click(screen.getByRole("button", { name: "Berry" }));
    const berry = rendered();
    expect(berry).not.toBe(DEFAULT_DESIGN.fg);
    const field = screen.getByLabelText("Caption color", { selector: "input:not([type=color])" });
    fireEvent.change(field, { target: { value: "#1F4ED8" } });
    expect(rendered()).toBe("#1F4ED8");
    fireEvent.change(field, { target: { value: "#1F4" } });
    expect(rendered()).toBe("#1F4ED8");
    fireEvent.blur(field);
    expect(screen.getByText(/HEX|colour|color/i, { selector: "p" })).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "#zz0000" } });
    expect(rendered()).toBe("#1F4ED8");
    fireEvent.change(field, { target: { value: "#c8102e" } });
    expect(rendered()).toBe("#C8102E");
    fireEvent.click(screen.getByRole("button", { name: "Match code" }));
    expect(rendered()).toBe(DEFAULT_DESIGN.fg);
    for (const [label, value] of [
      ["Left", "left"],
      ["Right", "right"],
      ["Center", "center"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(screen.getByTestId("align").textContent).toBe(value);
    }
  });
});
