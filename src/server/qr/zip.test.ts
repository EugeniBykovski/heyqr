import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, zipFiles } from "./zip";

/* Design 4.3 "Download all": the archive opens with standard tools and holds the files unchanged. */
describe("zipFiles", () => {
  it("CRC-32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("marks names as UTF-8 (general purpose flag bit 11), so non-Latin layout names survive", () => {
    const zip = zipFiles([{ name: "меню.png", data: new Uint8Array([1]) }]);
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
    expect(zip.subarray(30, 30 + Buffer.byteLength("меню.png")).toString("utf8")).toBe("меню.png");
  });

  it("unzip reads every file back byte for byte", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "heyqr-zip-"));
    const a = new TextEncoder().encode("<svg/>");
    const b = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    writeFileSync(
      path.join(dir, "all.zip"),
      zipFiles([
        { name: "cafe-card.svg", data: a },
        { name: "poster.png", data: b },
      ]),
    );
    execFileSync("unzip", ["-q", "-o", path.join(dir, "all.zip"), "-d", path.join(dir, "out")]);
    expect(new Uint8Array(readFileSync(path.join(dir, "out", "cafe-card.svg")))).toEqual(a);
    expect(new Uint8Array(readFileSync(path.join(dir, "out", "poster.png")))).toEqual(b);
  });
});
