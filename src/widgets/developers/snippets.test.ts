// @vitest-environment jsdom
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeSvg } from "@heyqr/qr-core/verify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { LOGO_SNIPPET, PNG_SNIPPET, SCAN_SNIPPET, SVG_SNIPPET } from "./snippets";

/*
 * /developers shows these snippets verbatim. Each one runs here against the real @heyqr/qr-core exports (written to
 * a file and imported, exactly as a reader would paste it), and what it makes is decoded with ZXing.
 */
const dir = mkdtempSync(join(tmpdir(), "heyqr-snippets-"));
// Inside the repo so the package resolves like it does for a consumer of the workspace.
const local = join(process.cwd(), "node_modules", ".cache", `snippets-${process.pid}`);
mkdirSync(local, { recursive: true });
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(local, { recursive: true, force: true });
});
const run = async (name: string, code: string) => {
  const file = join(local, name);
  writeFileSync(file, code);
  return import(/* @vite-ignore */ file);
};

describe("developers page snippets", () => {
  it("Render an SVG: inserts a standalone <svg> that decodes to the website", async () => {
    document.body.innerHTML = '<div id="qr"></div>';
    await run("render-svg.ts", SVG_SNIPPET);
    const svg = document.querySelector("#qr svg")?.outerHTML ?? "";
    expect(svg).toMatch(/^<svg/);
    expect(await decodeSvg(svg)).toBe("https://anareyes.studio/portfolio");
  });

  it("Save a PNG: writes wifi-qr.png with the Wi-Fi payload", async () => {
    const cwd = process.cwd();
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    process.chdir(dir);
    try {
      await run("save-png.mts", PNG_SNIPPET);
      const png = readFileSync(join(dir, "wifi-qr.png"));
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      const { decodeImage } = await import("@heyqr/qr-core/verify");
      expect(await decodeImage(new Uint8Array(png))).toBe("WIFI:T:WPA;S:Reyes Studio Guest;P:linen-orbit-42;;");
    } finally {
      process.chdir(cwd);
      vi.restoreAllMocks();
    }
  }, 30_000);

  it("Check that it scans: the low-contrast style reports issues with fixes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await run("scan-check.ts", SCAN_SNIPPET);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toBe("contrast");
    warn.mockRestore();
  });

  it("Logo style: a valid QrStyle that still scans", async () => {
    const mod = await run("logo-style.ts", `${LOGO_SNIPPET}\nexport { style };`);
    const { renderQrSvg } = await import("@heyqr/qr-core");
    expect(await decodeSvg(renderQrSvg("https://reyes.studio", mod.style))).toBe("https://reyes.studio");
  });
});
