import { describe, expect, it } from "vitest";
import { contentErrors, urlProblem } from "./content-validation";

describe("content step validation", () => {
  it("checks website addresses like the design", () => {
    expect(urlProblem("")).toBe("urlEmpty");
    expect(urlProblem("my site.com")).toBe("urlSpaces");
    expect(urlProblem("notaurl")).toBe("urlInvalid");
    expect(urlProblem("littlefern.cafe/menu")).toBeNull();
    expect(urlProblem("https://littlefern.cafe/menu")).toBeNull();
  });

  it("returns errors in form order so the first one gets focus", () => {
    expect(Object.keys(contentErrors({ type: "wifi", ssid: "", security: "WPA", password: "" }))).toEqual(["ssid", "password"]);
    expect(contentErrors({ type: "wifi", ssid: "Guest", security: "WPA", password: "short" })).toEqual({ password: "passwordShort" });
    expect(contentErrors({ type: "wifi", ssid: "Guest", security: "nopass" })).toEqual({});
  });

  it("covers the other content types", () => {
    expect(contentErrors({ type: "contact" })).toEqual({ firstName: "contactName" });
    expect(contentErrors({ type: "contact", firstName: "Ana", email: "ana@" })).toEqual({ email: "email" });
    expect(contentErrors({ type: "email", to: "" })).toEqual({ to: "emailTo" });
    expect(contentErrors({ type: "phone", number: "12" })).toEqual({ number: "phoneNumber" });
    expect(contentErrors({ type: "event", title: "Show", start: "" })).toEqual({ start: "eventStart" });
    expect(contentErrors({ type: "text", text: "Hello" })).toEqual({});
  });
});
