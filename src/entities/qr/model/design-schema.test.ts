import { describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "./design";
import { createLayoutRecord, designSettingsOf, readDraftDesign, readLayoutRecord, serializeDraftDesign } from "./design-schema";

const draft: EditorDesign = {
  ...DEFAULT_DESIGN,
  name: "Café menu",
  content: { type: "website", url: "https://littlefern.cafe/menu" },
  fg: "#1F5C45",
  pattern: "dot",
  preset: "caption",
  caption: "See the menu",
};
const layout = designToLayout(draft);

describe("guest draft (readDraftDesign)", () => {
  it("writes and reads the current version", () => {
    const stored = JSON.parse(JSON.stringify(serializeDraftDesign(draft)));
    expect(stored.schemaVersion).toBe(1);
    expect(readDraftDesign(stored, DEFAULT_DESIGN)).toEqual({ ok: true, value: draft, from: "current" });
  });

  it("reads a legacy draft (no schemaVersion) and keeps its design settings", () => {
    const { name, content, fg, pattern, preset, caption } = draft;
    const result = readDraftDesign({ name, content, fg, pattern, preset, caption }, DEFAULT_DESIGN);
    expect(result).toMatchObject({
      ok: true,
      from: "legacy",
      value: { content, fg: "#1F5C45", pattern: "dot", preset: "caption", caption: "See the menu" },
    });
  });

  it("rejects malformed drafts instead of guessing", () => {
    for (const bad of [
      null,
      "text",
      [],
      { ...serializeDraftDesign(draft), fg: "green" },
      { ...serializeDraftDesign(draft), content: { type: "fax" } },
      { schemaVersion: "1" },
    ]) {
      expect(readDraftDesign(bad, DEFAULT_DESIGN)).toMatchObject({ ok: false, reason: "malformed" });
    }
  });

  it("restores the mode with the draft", () => {
    const dynamic = { ...draft, model: "dynamic" as const };
    expect(readDraftDesign(JSON.parse(JSON.stringify(serializeDraftDesign(dynamic))), DEFAULT_DESIGN)).toEqual({
      ok: true,
      value: dynamic,
      from: "current",
    });
  });

  it("keeps a draft with an unsupported mode but makes it static and flags it", () => {
    const wifi = {
      ...draft,
      model: "dynamic" as const,
      content: { type: "wifi" as const, ssid: "Little Fern Guest", security: "WPA" as const },
    };
    const result = readDraftDesign(serializeDraftDesign(wifi), DEFAULT_DESIGN);
    expect(result).toEqual({ ok: true, value: { ...wifi, model: "static" }, from: "current", adjusted: "mode" });
    // Pre-versioning drafts get the same treatment, with every other setting kept.
    const legacy: Record<string, unknown> = { ...serializeDraftDesign(wifi) };
    delete legacy.schemaVersion;
    expect(readDraftDesign(legacy, DEFAULT_DESIGN)).toMatchObject({
      ok: true,
      from: "legacy",
      adjusted: "mode",
      value: { model: "static", fg: "#1F5C45", caption: "See the menu" },
    });
  });

  it("reports drafts from a newer version as unsupported", () => {
    expect(readDraftDesign({ ...serializeDraftDesign(draft), schemaVersion: 2 }, DEFAULT_DESIGN)).toEqual({
      ok: false,
      reason: "unsupported",
      version: 2,
    });
  });
});

describe("saved variant (readLayoutRecord)", () => {
  it("creates and reads the current version with the editor settings", () => {
    const record = createLayoutRecord(layout, designSettingsOf(draft));
    expect(record).toMatchObject({ schemaVersion: 1, layout, editor: { fg: "#1F5C45", pattern: "dot", caption: "See the menu" } });
    expect(readLayoutRecord(JSON.parse(JSON.stringify(record)))).toEqual({ ok: true, value: record, from: "current" });
  });

  it("reads a legacy record ({ layout } only) without inventing editor settings", () => {
    expect(readLayoutRecord({ layout })).toEqual({ ok: true, value: { schemaVersion: 1, layout }, from: "legacy" });
  });

  it("keeps optional layout fields it doesn't check", () => {
    const result = readLayoutRecord({
      schemaVersion: 1,
      layout: { ...layout, brandName: "Little Fern", topLogoHref: "https://cdn.example/logo.svg" },
    });
    expect(result.ok && result.value.layout).toMatchObject({ brandName: "Little Fern", topLogoHref: "https://cdn.example/logo.svg" });
  });

  it("rejects malformed records and refuses to write them", () => {
    expect(readLayoutRecord({ schemaVersion: 1 })).toMatchObject({ ok: false, reason: "malformed" });
    expect(readLayoutRecord({ schemaVersion: 1, layout: { ...layout, unit: "in" } })).toMatchObject({ ok: false, reason: "malformed" });
    expect(readLayoutRecord({ schemaVersion: 1, layout, editor: { fg: "red" } })).toMatchObject({ ok: false, reason: "malformed" });
    expect(createLayoutRecord({ preset: "qr" })).toBeNull();
  });

  it("reports records from a newer version as unsupported", () => {
    expect(readLayoutRecord({ schemaVersion: 3, layout })).toEqual({ ok: false, reason: "unsupported", version: 3 });
  });
});
