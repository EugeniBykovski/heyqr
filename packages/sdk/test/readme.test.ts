import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/* HEY-169: the README's Quickstart shows examples/quickstart.ts verbatim, so the documented code is the tested code. */
const dir = new URL("../", import.meta.url);
const readme = readFileSync(new URL("README.md", dir), "utf8");

describe("README Quickstart (HEY-169)", () => {
  it("shows examples/quickstart.ts verbatim", () => {
    const section = readme.slice(readme.indexOf("## Quickstart"), readme.indexOf("\n## ", readme.indexOf("## Quickstart") + 3));
    const block = /\*\*5\. Save `quickstart\.ts`\.\*\*[\s\S]*?```ts\n([\s\S]*?)\n```/.exec(section)?.[1];
    expect(block).toBe(readFileSync(new URL("examples/quickstart.ts", dir), "utf8").trimEnd());
  });

  it("documents the supported Node.js version, both install commands, the variables and plain-Node commands", () => {
    const section = readme.slice(readme.indexOf("## Quickstart"), readme.indexOf("## Entry points and runtimes"));
    for (const text of [
      "Node.js **18 or later**",
      "Dashboard → API keys",
      // HEY-172: published on npm; the tarball stays documented for unreleased monorepo builds.
      "npm install @heyqr/sdk",
      "npm install /tmp/heyqr-sdk-<version>.tgz",
      "HEYQR_API_KEY",
      "HEYQR_BASE_URL",
      "node dist/quickstart.js",
    ])
      expect(section, text).toContain(text);
    // Placeholders only: no real-looking key.
    expect(section).not.toMatch(/hqk_(?!X{12}_)[A-Za-z0-9]{12}_/);
    // The release is public, so nothing in the Quickstart still calls npm "not available yet".
    expect(section).not.toMatch(/not available yet|Pre-release \(now\)/);
  });
});

/* HEY-170: the purchase walkthrough shows examples/purchase-and-export.ts verbatim and documents the whole flow. */
describe("README purchase and re-export (HEY-170)", () => {
  const start = readme.indexOf("## Buy and download a Static code's files");
  const section = readme.slice(start, readme.indexOf("\n## ", start + 3));

  it("shows examples/purchase-and-export.ts verbatim", () => {
    const block = /\*\*2\. Save `purchase-and-export\.ts`\.\*\*[\s\S]*?```ts\n([\s\S]*?)\n```/.exec(section)?.[1];
    expect(block).toBe(readFileSync(new URL("examples/purchase-and-export.ts", dir), "utf8").trimEnd());
  });

  it("covers the 402, the owner's Checkout, the retry with the same ids and the re-download, without secrets", () => {
    for (const text of [
      "402 payment_required",
      "signed in to HeyQR as the code's owner",
      "complete Checkout",
      "same `HEYQR_QR_ID` and `HEYQR_LAYOUT_ID`",
      "HEYQR_WAIT_SECONDS",
      "never creates\n  an order, a charge or a credit deduction",
      "node dist/purchase-and-export.js",
      "--module nodenext --moduleResolution nodenext --strict",
    ])
      expect(section, text).toContain(text);
    expect(section).not.toMatch(/hqk_(?!X{12}_)[A-Za-z0-9]{12}_/);
    // No signed storage links or real ids in the documented output.
    expect(section).not.toMatch(/X-Amz-|Signature=|r2\.cloudflarestorage|qr=[A-Za-z0-9_-]{10,}/);
  });

  it("the example uses only the public entry, reads its settings from the environment and never prints the key", () => {
    const source = readFileSync(new URL("examples/purchase-and-export.ts", dir), "utf8");
    expect([...source.matchAll(/from "(@heyqr\/[^"]+)"/g)].map((m) => m[1])).toEqual(["@heyqr/sdk"]);
    for (const name of ["HEYQR_API_KEY", "HEYQR_BASE_URL", "HEYQR_QR_ID", "HEYQR_LAYOUT_ID"])
      expect(source).toContain(`process.env.${name}`);
    expect(source).toContain("isPaymentRequired(error)");
    expect(source).not.toMatch(/console\.\w+\([^)]*apiKey/);
  });
});
