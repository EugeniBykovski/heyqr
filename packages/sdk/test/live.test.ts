import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeyQrApiError, HeyQrClient, type CreateQrError, type CreateQrRequest } from "@heyqr/sdk";

/*
 * HEY-161: the SDK against a running HeyQR API. Skipped unless HEYQR_API_KEY and HEYQR_BASE_URL are set, e.g.
 *   HEYQR_API_KEY=hqk_… HEYQR_BASE_URL=http://localhost:3000 [HEYQR_REVOKED_API_KEY=hqk_…] pnpm exec vitest run packages/sdk/test/live.test.ts
 * It creates one Dynamic draft in the key's account. Keys never appear in assertions' messages.
 */
const apiKey = process.env.HEYQR_API_KEY;
const baseUrl = process.env.HEYQR_BASE_URL;
const revoked = process.env.HEYQR_REVOKED_API_KEY;
const sticker = JSON.parse(readFileSync(new URL("../examples/sticker-layout.json", import.meta.url), "utf8")) as {
  layout: object;
  editor: object;
};

describe.skipIf(!apiKey || !baseUrl)("HeyQR SDK against the live API (HEY-161)", () => {
  const heyqr = () => new HeyQrClient({ apiKey: apiKey ?? "", baseUrl: baseUrl ?? "" });
  const request: CreateQrRequest = {
    name: "SDK live check",
    mode: "dynamic",
    content: { type: "website", url: "littlefern.cafe" },
    destination: "littlefern.cafe/today",
    layouts: [
      { name: "Sticker", layout: sticker.layout, editor: sticker.editor },
      { name: "Poster", layout: sticker.layout },
    ],
  };

  it("create a Dynamic QR, read its layouts and its destination: ids and revisions as the contract says", async () => {
    const created = await heyqr().createQr(request);
    expect(created).toEqual({ id: expect.any(String), status: "draft", layouts: [{ id: expect.any(String) }, { id: expect.any(String) }] });
    for (const [i, { id }] of created.layouts.entries()) {
      const layout = await heyqr().getLayout(created.id, id);
      expect(layout).toEqual({
        id,
        qrCodeId: created.id,
        name: request.layouts[i]?.name,
        revision: expect.stringMatching(/^\d+$/),
        layout: expect.any(Object),
        editor: i === 0 ? expect.any(Object) : null,
      });
    }
    const destination = await heyqr().getDestination(created.id);
    expect(destination).toEqual({
      qrCodeId: created.id,
      destination: "https://littlefern.cafe/today",
      revision: 0,
      previousDestination: null,
      changedAt: null,
      shortLink: null,
    });
    console.info(`[live] created ${created.id} with layouts ${created.layouts.map((l) => l.id).join(", ")}`);
  });

  it("401 for an invalid (and a revoked) key; the key isn't in the error", async () => {
    for (const key of ["hqk_AAAAAAAAAAAA_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG", ...(revoked ? [revoked] : [])]) {
      const error = await new HeyQrClient({ apiKey: key, baseUrl: baseUrl ?? "" }).getDestination("anything").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HeyQrApiError);
      expect(error).toMatchObject({ status: 401, code: "unauthorized" });
      expect(`${String(error)} ${JSON.stringify(error)}`.includes(key)).toBe(false);
    }
  });

  it("404 for a code or layout that doesn't exist; 422 not_dynamic for a static code; 422 invalid_request with details", async () => {
    await expect(heyqr().getLayout("nonexistent00000000001", "nonexistent00000000002")).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
    await expect(heyqr().getDestination("nonexistent00000000001")).rejects.toMatchObject({ status: 404, code: "not_found" });
    // A static code can't have a destination: a validation error naming the field.
    const flat = (await heyqr()
      .createQr({ ...request, mode: "static" })
      .catch((e: unknown) => e)) as CreateQrError;
    expect([flat.status, flat.code]).toEqual([422, "invalid_request"]);
    expect(
      flat.response.status === 422 && flat.response.body.error.code === "invalid_request"
        ? flat.response.body.error.details.map((d) => d.path)
        : [],
    ).toEqual(["destination"]);
    const fixed = { ...request, mode: "static" as const, layouts: [{ name: "Card", layout: sticker.layout }] };
    delete (fixed as { destination?: string }).destination;
    const staticCode = await heyqr().createQr(fixed);
    await expect(heyqr().getDestination(staticCode.id)).rejects.toMatchObject({ status: 422, code: "not_dynamic" });
    const invalid = (await heyqr()
      .createQr({ ...request, content: { type: "website", url: "not a url" } })
      .catch((e: unknown) => e)) as CreateQrError;
    expect([invalid.status, invalid.code]).toEqual([422, "invalid_request"]);
    const r = invalid.response;
    expect(r.status === 422 && r.body.error.code === "invalid_request" ? r.body.error.details.map((d) => d.path) : []).toContain(
      "content.url",
    );
  });
});
