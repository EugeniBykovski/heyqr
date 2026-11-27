import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type * as Sdk from "@simplex-packages/heyqr-sdk";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import { DEFAULT_DESIGN, designSettingsOf, designToLayout } from "@/entities/qr";
import { createQrRequestSchema, readCreateRequest, type Problem } from "./create-qr";
import type { ApiDestination } from "./destination";
import { updateDestinationRequestSchema } from "./destination";
import { exportQuerySchema } from "./export";
import type { ApiLayout } from "./layouts";
import { updateLayoutRequestSchema } from "./layouts";

/*
 * HEY-160 / QR-22.01: the public SDK types (@simplex-packages/heyqr-sdk) against what the routes actually accept and return.
 * Type-level checks compare them with the server's own types and Zod schemas; runtime checks send SDK-typed samples
 * through the server's real request validation. Response bodies from the real route handlers are compared in the
 * PostgreSQL suite (db.integration.test.ts, "SDK contract").
 */
describe("SDK contract: types (HEY-160)", () => {
  it("requests match the route schemas field for field", () => {
    expectTypeOf<Sdk.QrContent>().toEqualTypeOf<z.output<typeof createQrRequestSchema>["content"]>();
    expectTypeOf<Sdk.CreateQrRequest["mode"]>().toEqualTypeOf<z.output<typeof createQrRequestSchema>["mode"]>();
    expectTypeOf<Sdk.CreateQrRequest>().toExtend<Omit<z.input<typeof createQrRequestSchema>, never>>();
    expectTypeOf<keyof Sdk.CreateQrRequest>().toEqualTypeOf<keyof z.input<typeof createQrRequestSchema>>();
    expectTypeOf<keyof Sdk.CreateQrLayout>().toEqualTypeOf<keyof z.input<typeof createQrRequestSchema>["layouts"][number]>();
    expectTypeOf<Sdk.UpdateDestinationRequest>().toEqualTypeOf<z.output<typeof updateDestinationRequestSchema>>();
    expectTypeOf<Sdk.UpdateLayoutRequest>().toExtend<z.input<typeof updateLayoutRequestSchema>>();
    expectTypeOf<Sdk.ExportQuery>().toEqualTypeOf<z.output<typeof exportQuerySchema>>();
    expectTypeOf<Sdk.ValidationProblem>().toEqualTypeOf<Problem>();
  });

  it("responses match the server's response types; the two revisions stay distinct", () => {
    expectTypeOf<Sdk.Destination>().toEqualTypeOf<ApiDestination>();
    expectTypeOf<Omit<Sdk.Layout, "layout" | "editor">>().toEqualTypeOf<Omit<ApiLayout, "layout" | "editor">>();
    expectTypeOf<keyof Sdk.Layout>().toEqualTypeOf<keyof ApiLayout>();
    expectTypeOf<Sdk.LayoutRevision>().toEqualTypeOf<ApiLayout["revision"]>();
    expectTypeOf<Sdk.DestinationRevision>().toEqualTypeOf<ApiDestination["revision"]>();
    expectTypeOf<Sdk.LayoutRevision>().not.toEqualTypeOf<Sdk.DestinationRevision>();
  });
});

const design = { ...DEFAULT_DESIGN, fg: "#1F3A5F" };
const layout = designToLayout(design);
const editor = designSettingsOf(design);

describe("SDK contract: SDK-typed samples through the server's request validation (HEY-160)", () => {
  const samples: Sdk.CreateQrRequest[] = [
    {
      name: "Menu",
      mode: "static",
      content: { type: "website", url: "littlefern.cafe/menu" },
      layouts: [{ name: "Sticker", layout, editor }],
    },
    {
      name: "Live",
      mode: "dynamic",
      content: { type: "website", url: "littlefern.cafe" },
      destination: "littlefern.cafe/today",
      layouts: [{ name: "Poster", layout }],
    },
    { name: "Note", mode: "static", content: { type: "text", text: "Open 8–4" }, layouts: [{ name: "A", layout }] },
    {
      name: "Wi-Fi",
      mode: "static",
      content: { type: "wifi", ssid: "Cafe", security: "WPA", password: "espresso42", hidden: false },
      layouts: [{ name: "A", layout }],
    },
    { name: "Open", mode: "static", content: { type: "wifi", ssid: "Cafe", security: "nopass" }, layouts: [{ name: "A", layout }] },
    {
      name: "Card",
      mode: "static",
      content: {
        type: "contact",
        firstName: "Ana",
        lastName: "Baker",
        company: "Little Fern",
        phone: "+1 415 555 0142",
        email: "ana@littlefern.cafe",
        website: "littlefern.cafe",
      },
      layouts: [{ name: "A", layout }],
    },
    {
      name: "Mail",
      mode: "static",
      content: { type: "email", to: "hello@littlefern.cafe", subject: "Booking" },
      layouts: [{ name: "A", layout }],
    },
    { name: "Call", mode: "static", content: { type: "phone", number: "+1 415 555 0142" }, layouts: [{ name: "A", layout }] },
    {
      name: "Text",
      mode: "static",
      content: { type: "sms", number: "+1 415 555 0142", message: "Table for 2" },
      layouts: [{ name: "A", layout }],
    },
    {
      name: "Find us",
      mode: "static",
      content: { type: "location", name: "Little Fern", address: "1 Fern St" },
      layouts: [{ name: "A", layout }],
    },
    {
      name: "Launch",
      mode: "static",
      content: { type: "event", title: "Launch", start: "2026-12-01T18:00", end: "2026-12-01T21:00", place: "Little Fern" },
      layouts: [{ name: "A", layout }],
    },
  ];

  it("every SDK-typed create request is accepted, one per content type", () => {
    const types = new Set<string>();
    for (const sample of samples) {
      expect(readCreateRequest(JSON.parse(JSON.stringify(sample))), sample.name).toMatchObject({ ok: true });
      types.add(sample.content.type);
    }
    expect([...types].sort()).toEqual(["contact", "email", "event", "location", "phone", "sms", "text", "website", "wifi"]);
  });

  it("SDK-typed updates and export queries are accepted", () => {
    const current: Sdk.Layout = { id: "l", qrCodeId: "q", name: "Sticker", revision: "1764061234567890", layout: {}, editor: null };
    const updates: Sdk.UpdateLayoutRequest[] = [
      { revision: current.revision, name: "Sticker v2" },
      { revision: current.revision, layout, editor },
      { revision: current.revision, editor },
    ];
    for (const u of updates) expect(updateLayoutRequestSchema.safeParse(JSON.parse(JSON.stringify(u))).success).toBe(true);
    const dest: Sdk.UpdateDestinationRequest = { destination: "https://littlefern.cafe/today", revision: 3 };
    expect(updateDestinationRequestSchema.safeParse(dest).success).toBe(true);
    const queries: Sdk.ExportQuery[] = [
      { format: "png" },
      { format: "png", dpi: 600, transparent: "1" },
      { format: "png", scale: 4 },
      { format: "svg" },
      { format: "pdf" },
    ];
    for (const query of queries) {
      const wire = Object.fromEntries(new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])));
      expect(exportQuerySchema.safeParse(wire).success, JSON.stringify(query)).toBe(true);
    }
  });

  it("what the SDK refuses at compile time, the server refuses too", () => {
    const base = samples[0] as Sdk.CreateQrRequest;
    for (const bad of [
      { ...base, userId: "x" },
      { ...base, qrCodeId: "x" },
      { ...base, mode: "live" },
      { ...base, content: { type: "website" } },
    ])
      expect(readCreateRequest(bad).ok).toBe(false);
    expect(updateLayoutRequestSchema.safeParse({ revision: 3, name: "x" }).success).toBe(false); // a destination revision
    expect(updateLayoutRequestSchema.safeParse({ revision: "3" }).success).toBe(false); // nothing to update
    expect(updateDestinationRequestSchema.safeParse({ destination: "https://x.test", revision: "1764061234567890" }).success).toBe(false);
    expect(exportQuerySchema.safeParse({ format: "gif" }).success).toBe(false);
  });
});

describe("SDK package boundary (HEY-160)", () => {
  const dir = fileURLToPath(new URL("../../../../packages/sdk/", import.meta.url));
  it("exports one entry point and imports nothing outside itself (no Next.js, database, server, qr-core or platform modules)", () => {
    const pkg = JSON.parse(readFileSync(`${dir}package.json`, "utf8")) as { exports: Record<string, unknown>; dependencies?: object };
    expect(Object.keys(pkg.exports)).toEqual([".", "./react"]); // HEY-167: the server entry and the React entry
    expect(pkg.dependencies).toBeUndefined();
    // The server SDK's own modules (src/react is a separate entry, checked below).
    for (const file of readdirSync(`${dir}src`).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(`${dir}src/${file}`, "utf8");
      const specifiers = [...source.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?[\w*{}\s,$]+?\s+from\s+"([^"]+)"/gm)].map((m) => m[1]);
      expect(
        specifiers.every((s) => s?.startsWith("./")),
        `${file}: ${specifiers.join(", ")}`,
      ).toBe(true);
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      // HEY-161 / HEY-168: runtime code only in the client, its shared runtime and the browser entry; the rest is types.
      if (!["client.ts", "shared.ts", "browser.ts"].includes(file))
        expect(code, file).not.toMatch(/^\s*export\s+(const|function|class|let|var|enum)\b/m);
      // No platform modules or globals beyond fetch: the client runs on Node 18+, Deno, Bun and workers.
      expect(code, file).not.toMatch(/\b(process|require|Buffer|window|__dirname)\b|from\s+"node:/);
    }
  });
});
describe("SDK browser entry boundary (HEY-168)", () => {
  const dir = fileURLToPath(new URL("../../../../packages/sdk/", import.meta.url));
  it('the browser build of "." loads only shared.ts (no client); shared.ts has no runtime imports', () => {
    const pkg = JSON.parse(readFileSync(`${dir}package.json`, "utf8")) as {
      exports: Record<string, Record<string, string>>;
      publishConfig: { exports: Record<string, Record<string, string>> };
    };
    for (const exp of [pkg.exports, pkg.publishConfig.exports]) {
      expect(exp["."]?.browser).toBe("./dist/browser.js");
      expect(exp["."]?.types).toBe("./dist/index.d.ts");
      // Bundlers pick the first matching condition: browser must come before import/default.
      const order = Object.keys(exp["."] ?? {});
      expect(order.indexOf("browser")).toBeLessThan(order.indexOf("import"));
    }
    expect(JSON.stringify(pkg.publishConfig.exports)).not.toContain("@heyqr/source");
    const specifiers = (file: string) =>
      [...readFileSync(`${dir}src/${file}`, "utf8").matchAll(/^\s*(?:import|export)\s+(?:type\s+)?[\w*{}\s,$]+?\s+from\s+"([^"]+)"/gm)].map(
        (m) => [m[0].includes(" type ") || /^\s*import type/.test(m[0]), m[1]] as const,
      );
    expect(specifiers("browser.ts").map(([, s]) => s)).toEqual(["./shared.js", "./shared.js"]);
    expect(specifiers("shared.ts").every(([isType]) => isType)).toBe(true);
  });
});

describe("SDK React entry boundary (HEY-167)", () => {
  const dir = fileURLToPath(new URL("../../../../packages/sdk/", import.meta.url));
  it("@simplex-packages/heyqr-sdk/react imports only React and the renderer, never the server client; React is an optional peer", () => {
    const pkg = JSON.parse(readFileSync(`${dir}package.json`, "utf8")) as {
      exports: Record<string, unknown>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      dependencies?: object;
    };
    expect(Object.keys(pkg.exports)).toEqual([".", "./react"]);
    expect(pkg.peerDependencies).toEqual({ react: ">=18" });
    expect(pkg.peerDependenciesMeta?.react?.optional).toBe(true);
    expect(pkg.dependencies).toBeUndefined();
    for (const file of readdirSync(`${dir}src/react`)) {
      const source = readFileSync(`${dir}src/react/${file}`, "utf8");
      const specifiers = [...source.matchAll(/^\s*(?:import|export)\s+(?:type\s+)?[\w*{}\s,$]+?\s+from\s+"([^"]+)"/gm)].map((m) => m[1]);
      expect(
        specifiers.every((s) => s === "react" || s === "@heyqr/qr-core" || s?.startsWith("./")),
        `${file}: ${specifiers.join(", ")}`,
      ).toBe(true);
    }
    // And the server modules never import React.
    for (const file of readdirSync(`${dir}src`).filter((f) => f.endsWith(".ts")))
      expect(readFileSync(`${dir}src/${file}`, "utf8"), file).not.toMatch(/from\s+"react/);
  });
});
