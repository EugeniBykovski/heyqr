import {
  composeLayout,
  encodePayload,
  layoutCapacity,
  maxPayloadBytes,
  payloadBytes,
  QrCapacityError,
  type QrContent,
} from "@heyqr/qr-core";
import { decodeSvg } from "@heyqr/qr-core/verify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "./design";

/*
 * HEY-24: capacity is decided by the encoder's own limits on the final serialized payload (UTF-8, Wi-Fi escaping,
 * vCard folding), with the layout's error correction: M normally (666 bytes at version 20), H with a center logo (382).
 */
const plain = designToLayout(DEFAULT_DESIGN);
const withLogo = designToLayout({ ...DEFAULT_DESIGN, logo: { kind: "icon", icon: "coffee" } });

/**
 * Finds form input whose serialized payload is exactly `target` bytes: `k` repeats of a "growing" unit (multibyte or
 * escaped, so the payload is larger than the form value) plus `pad` ASCII letters. Searched, not computed, so it
 * relies on the real serializer (folding included).
 */
function contentOfSize(make: (k: number, pad: number) => QrContent, target: number) {
  for (let k = 0; k < 400; k++)
    for (let pad = 0; pad < 120; pad++) {
      const content = make(k, pad);
      const bytes = payloadBytes(encodePayload(content));
      if (bytes === target) return content;
      if (bytes > target) break;
    }
  throw new Error(`no input serializes to exactly ${target} bytes`);
}

const a = (n: number) => "a".repeat(n);
const TYPES: [string, (k: number, pad: number) => QrContent, string][] = [
  // Multibyte path segment: each "ж" is 2 UTF-8 bytes.
  ["Website", (k, pad) => ({ type: "website", url: `example.com/${"ж".repeat(k)}${a(pad)}` }), "ж"],
  // 3-byte "✓" and 4-byte emoji: far fewer characters than bytes.
  ["Text", (k, pad) => ({ type: "text", text: `${"✓🙂".repeat(k)}${a(pad)}` }), "✓🙂"],
  // Every ";" in the network name is escaped to "\;": the payload grows by 2 bytes per typed character.
  ["Wi-Fi", (k, pad) => ({ type: "wifi", ssid: `${";".repeat(k)}${a(pad)}`, security: "WPA", password: "synthetic-pass-1" }), ";"],
  // Commas are escaped and the long Cyrillic title is folded every 75 octets (CRLF + space): payload > form value.
  ["Contact", (k, pad) => ({ type: "contact", firstName: "Test", title: `${"ж,".repeat(k)}${a(pad)}` }), "ж,"],
];

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  for (const m of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("QR capacity (HEY-24)", () => {
  it("uses the encoder's limits: 666 bytes at M, 382 at H (center logo)", () => {
    expect(maxPayloadBytes("M")).toBe(666);
    expect(maxPayloadBytes("H")).toBe(382);
    expect(layoutCapacity(plain, "x").maxBytes).toBe(666);
    expect(layoutCapacity(withLogo, "x")).toMatchObject({ maxBytes: 382, ecl: "H", centerCovered: true });
  });

  for (const [layoutName, layout] of [
    ["default design (M)", plain],
    ["center logo (H)", withLogo],
  ] as const)
    for (const [type, make, unit] of TYPES) {
      const max = layoutCapacity(layout, "").maxBytes;

      it(`${type} · ${layoutName}: just below and at the limit encode and decode exactly`, async () => {
        for (const target of [max - 1, max]) {
          const content = contentOfSize(make, target);
          const payload = encodePayload(content);
          expect(payloadBytes(payload)).toBe(target);
          // The code holds more bytes than characters were typed (escaping, folding or multibyte characters).
          const typed = Object.entries(content)
            .filter(([k]) => k !== "type")
            .map(([, v]) => String(v))
            .join("");
          expect(payloadBytes(payload)).toBeGreaterThan([...typed].length);
          expect(payload).toContain(unit === ";" ? "\\;" : unit === "ж," ? "ж\\," : unit);
          const capacity = layoutCapacity(layout, payload);
          expect(capacity).toMatchObject({ ok: true, bytes: target, maxBytes: max });
          const { svg } = composeLayout(layout, payload);
          expect(await decodeSvg(svg, 1400)).toBe(payload);
        }
      }, 30_000);

      it(`${type} · ${layoutName}: one byte over fails cleanly, without truncation or logging the content`, () => {
        const content = contentOfSize(make, max + 1);
        const payload = encodePayload(content);
        expect(layoutCapacity(layout, payload)).toMatchObject({ ok: false, bytes: max + 1, maxBytes: max });
        let thrown: unknown;
        try {
          composeLayout(layout, payload);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(QrCapacityError);
        const e = thrown as QrCapacityError;
        expect([e.byteLength, e.maxBytes]).toEqual([max + 1, max]);
        // Sizes only: neither the message nor anything logged contains the content (or the Wi-Fi password).
        expect(e.message).not.toContain(payload.slice(0, 40));
        expect(e.message).not.toContain("synthetic-pass-1");
        expect(logged.join("\n")).not.toContain("synthetic-pass-1");
        expect(logged).toEqual([]);
        // About 1.5 s on a 12-core laptop; it timed out at the 5 s default on CI runners (c5f692e, 823e2ee, 24bc40f, 75f6f18).
      }, 30_000);
    }

  it("a dynamic code encodes its short link, so long destinations never hit the limit", () => {
    const destination = `https://example.com/${"ж".repeat(2000)}`;
    expect(layoutCapacity(plain, destination).ok).toBe(false);
    expect(layoutCapacity(withLogo, "https://hqr.to/m4Kp7").ok).toBe(true);
  });
});
