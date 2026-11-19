// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkLogoDataUrl,
  createLayoutRecord,
  DEFAULT_DESIGN,
  designSettingsOf,
  designToLayout,
  LOGO_MAX_BYTES,
  sniffLogoFormat,
} from "@/entities/qr";
import messages from "../../../messages/en.json";
import { intakeLogo, STORED_MAX_SIDE, type LogoDecoder } from "./logo-intake";
import { LogoFeedback, LogoUploadTile, type LogoFeedbackState } from "./logo-upload";

afterEach(cleanup);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const bytes = (head: number[], size = 64) => {
  const b = new Uint8Array(size);
  b.set(head);
  return b;
};
const file = (data: Uint8Array | string, name: string, type = "") => new File([data as BlobPart], name, { type });
const SVG = `<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>`;

/** A decoder that succeeds with the given size, or fails like a damaged file. */
const decoder = (w = 400, h = 300, fail = false) => {
  const d = {
    raster: vi.fn(async () => {
      if (fail) throw new Error("decode failed");
      return {
        width: w,
        height: h,
        encode: vi.fn(async (ew: number, eh: number, mime: string) => `data:${mime};base64,${btoa(`${ew}x${eh}`)}`),
      };
    }),
    svg: vi.fn(async () => {
      if (fail) throw new Error("decode failed");
      return { width: 10, height: 10 };
    }),
  } satisfies LogoDecoder;
  return d;
};

describe("logo format is read from the bytes (HEY-50)", () => {
  it("recognises PNG, JPEG, WebP and SVG (with XML declaration, BOM, comments or doctype)", () => {
    expect(sniffLogoFormat(bytes(PNG))).toBe("png");
    expect(sniffLogoFormat(bytes(JPEG))).toBe("jpeg");
    expect(sniffLogoFormat(bytes(WEBP))).toBe("webp");
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffLogoFormat(enc(SVG))).toBe("svg");
    expect(sniffLogoFormat(enc(`﻿<!DOCTYPE svg><svg></svg>`))).toBe("svg");
  });

  it("refuses anything else: GIF, PDF, HTML, plain text, an empty file", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    for (const b of [enc("GIF89a...."), enc("%PDF-1.7"), enc("<html><svg></svg></html>"), enc("hello"), new Uint8Array(0)])
      expect(sniffLogoFormat(b)).toBeNull();
  });
});

describe("logo intake (HEY-50)", () => {
  it("accepts a file of exactly 10 MB and refuses one byte more without reading or decoding it", async () => {
    const atLimit = file(bytes(PNG, LOGO_MAX_BYTES), "logo.png", "image/png");
    const over = file(bytes(PNG, LOGO_MAX_BYTES + 1), "logo.png", "image/png");
    const d = decoder();
    expect((await intakeLogo(atLimit, d)).ok).toBe(true);
    d.raster.mockClear();
    const sliced = vi.spyOn(over, "slice");
    expect(await intakeLogo(over, d)).toEqual({ ok: false, reason: "tooLarge", bytes: LOGO_MAX_BYTES + 1 });
    expect(sliced).not.toHaveBeenCalled();
    expect(d.raster).not.toHaveBeenCalled();
    expect(LOGO_MAX_BYTES).toBe(10_485_760);
  });

  it("an empty file, a renamed text file and an unsupported format are refused by content", async () => {
    expect(await intakeLogo(file(new Uint8Array(0), "logo.png"), decoder())).toMatchObject({ ok: false, reason: "empty" });
    expect(await intakeLogo(file("just some text", "logo.png", "image/png"), decoder())).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
    expect(await intakeLogo(file(new TextEncoder().encode("GIF89a.........."), "logo.gif", "image/gif"), decoder())).toMatchObject({
      ok: false,
      reason: "unsupported",
    });
  });

  it("a damaged image of a supported format is refused as unreadable", async () => {
    expect(await intakeLogo(file(bytes(PNG), "logo.png"), decoder(0, 0, true))).toMatchObject({ ok: false, reason: "unreadable" });
    expect(await intakeLogo(file(SVG, "logo.svg"), decoder(0, 0, true))).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("each supported format is accepted; a JPEG with a .png name is taken as the JPEG it is", async () => {
    for (const [b, name, fmt] of [
      [bytes(PNG), "a.png", "png"],
      [bytes(JPEG), "a.png", "jpeg"],
      [bytes(WEBP), "a.webp", "webp"],
    ] as const) {
      const r = await intakeLogo(file(b, name), decoder());
      expect(r).toMatchObject({ ok: true, format: fmt });
      expect(r.ok && r.href.startsWith(`data:image/${fmt};base64,`)).toBe(true);
    }
    const svg = await intakeLogo(file(SVG, "logo.svg"), decoder());
    expect(svg).toMatchObject({ ok: true, format: "svg" });
    expect(svg.ok && atob(svg.href.split(",")[1] ?? "")).toBe(SVG); // kept as vector, byte for byte
  });

  it("a heavy file is re-encoded even when its pixel size is small, so a 10 MB file isn't stored as 10 MB", async () => {
    const d = decoder(256, 256);
    const heavy = await intakeLogo(file(bytes(PNG, LOGO_MAX_BYTES), "padded.png"), d);
    expect(heavy).toMatchObject({ ok: true, width: 256, height: 256 });
    expect(heavy.ok && heavy.href.length).toBeLessThan(1000);
    const light = await intakeLogo(file(bytes(PNG, 2000), "small.png"), d);
    expect(light.ok && light.href).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...bytes(PNG, 2000)))}`); // kept as is
  });

  it("large raster images are stored scaled to at most 1024 px; JPEG stays JPEG, others become PNG", async () => {
    const big = await intakeLogo(file(bytes(PNG), "big.png"), decoder(4000, 2000));
    expect(big).toMatchObject({ ok: true, width: STORED_MAX_SIDE, height: 512 });
    expect(big.ok && big.href.startsWith("data:image/png;")).toBe(true);
    const photo = await intakeLogo(file(bytes(JPEG), "photo.jpg"), decoder(3000, 3000));
    expect(photo.ok && photo.href.startsWith("data:image/jpeg;")).toBe(true);
  });
});

describe("the server applies the same rule to stored logos (HEY-50)", () => {
  const dataUrl = (mime: string, b: Uint8Array) => `data:${mime};base64,${btoa(String.fromCharCode(...b))}`;
  it("checks MIME against content, base64 form and size", () => {
    expect(checkLogoDataUrl(dataUrl("image/png", bytes(PNG)))).toMatchObject({ ok: true, format: "png" });
    expect(checkLogoDataUrl(dataUrl("image/png", bytes(JPEG)))).toMatchObject({ ok: false, reason: "unsupported" });
    expect(checkLogoDataUrl(dataUrl("image/gif", bytes(PNG)))).toMatchObject({ ok: false, reason: "unsupported" });
    expect(checkLogoDataUrl("data:image/png;base64,***")).toMatchObject({ ok: false, reason: "unsupported" });
    expect(checkLogoDataUrl(`data:image/png;base64,${"A".repeat(Math.ceil((LOGO_MAX_BYTES + 3) / 3) * 4)}`)).toMatchObject({
      ok: false,
      reason: "tooLarge",
    });
  });

  it("saving a design with an unacceptable logo is refused; an accepted one is saved", () => {
    const withLogo = (href: string) => {
      const d = { ...DEFAULT_DESIGN, logo: { kind: "image" as const, href } };
      return createLayoutRecord(designToLayout(d), designSettingsOf(d));
    };
    expect(withLogo(dataUrl("image/png", bytes(PNG)))).not.toBeNull();
    expect(withLogo(dataUrl("image/png", new TextEncoder().encode("not an image at all, just text")))).toBeNull();
    expect(withLogo("javascript:alert(1)")).toBeNull();
  });
});

describe("Logo upload tile (HEY-50)", () => {
  function Harness({ d }: { d: LogoDecoder }) {
    const [href, setHref] = useState<string | null>(null);
    const [feedback, setFeedback] = useState<LogoFeedbackState>(null);
    return (
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <LogoUploadTile selected={href !== null} label="Upload logo" onLogo={setHref} onFeedback={setFeedback} decoder={d} />
        <LogoFeedback feedback={feedback} />
        <output data-testid="logo">{href ?? "none"}</output>
      </NextIntlClientProvider>
    );
  }
  const input = () => screen.getByLabelText("Upload logo") as HTMLInputElement;
  const logo = () => screen.getByTestId("logo").textContent;
  const choose = async (f: File) => {
    await act(async () => {
      fireEvent.change(input(), { target: { files: [f] } });
    });
  };

  it("shows the formats and limit; a failed replacement keeps the last logo and says why; a valid retry replaces it", async () => {
    const d = decoder();
    render(<Harness d={d} />);
    expect(document.getElementById("logo-file-feedback")?.textContent).toContain("PNG, JPG, SVG or WebP, up to 10 MB");
    await choose(file(bytes(PNG), "first.png"));
    await waitFor(() => expect(logo()).toMatch(/^data:image\/png;base64,/));
    const first = logo();

    await choose(file(bytes(PNG, LOGO_MAX_BYTES + 1), "huge.png"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("over the 10 MB limit"));
    expect(screen.getByRole("alert").textContent).toContain("Your current logo is kept.");
    expect(logo()).toBe(first);

    await choose(file("text", "notes.png"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("isn’t a PNG, JPG, SVG or WebP image"));
    expect(logo()).toBe(first);
    expect(input().value).toBe(""); // reset, so the same file can be chosen again

    await choose(file(SVG, "second.svg"));
    await waitFor(() => expect(logo()).toMatch(/^data:image\/svg\+xml;base64,/));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("dropping a file uses the same checks", async () => {
    render(<Harness d={decoder()} />);
    const tile = document.querySelector("[data-slot=logo-upload]") as HTMLElement;
    await act(async () => {
      fireEvent.drop(tile, { dataTransfer: { files: [file("text", "dropped.png")] } });
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(logo()).toBe("none");
    await act(async () => {
      fireEvent.drop(tile, { dataTransfer: { files: [file(bytes(WEBP), "dropped.webp")] } });
    });
    await waitFor(() => expect(logo()).toMatch(/^data:image\/webp;base64,/));
  });
});
