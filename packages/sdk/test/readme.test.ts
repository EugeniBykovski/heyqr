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
      "npm install /tmp/heyqr-sdk-0.1.0.tgz",
      "**After publication (not available yet):**",
      "npm install @heyqr/sdk",
      "HEYQR_API_KEY",
      "HEYQR_BASE_URL",
      "node dist/quickstart.js",
    ])
      expect(section, text).toContain(text);
    // Placeholders only: no real-looking key.
    expect(section).not.toMatch(/hqk_(?!X{12}_)[A-Za-z0-9]{12}_/);
    // The version in the tarball name is the package's.
    const { version } = JSON.parse(readFileSync(new URL("package.json", dir), "utf8")) as { version: string };
    expect(section).toContain(`heyqr-sdk-${version}.tgz`);
  });
});
