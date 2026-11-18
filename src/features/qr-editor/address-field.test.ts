import { describe, expect, it } from "vitest";
import { bareUrl, fromAddressField, schemeOf } from "./address-field";
import { urlProblem } from "./content-validation";

describe("homepage address field (HEY-20)", () => {
  it("adds https:// to a typed domain and keeps trailing input editable", () => {
    expect(fromAddressField("littlefern.cafe/menu", "")).toBe("https://littlefern.cafe/menu");
    expect(fromAddressField("littlefern.cafe ", "")).toBe("https://littlefern.cafe ");
    expect(urlProblem("https://littlefern.cafe ")).toBeNull();
  });

  it("never doubles the scheme when a complete URL is pasted, even with spaces around it", () => {
    const stored = fromAddressField("  https://littlefern.cafe/menu?table=4#drinks  ", "https://");
    expect(stored).toBe("https://littlefern.cafe/menu?table=4#drinks  ");
    expect(bareUrl(stored)).toBe("littlefern.cafe/menu?table=4#drinks  ");
    expect(urlProblem(stored)).toBeNull();
  });

  it("keeps an explicit http:// and shows it in the prefix", () => {
    const stored = fromAddressField("http://legacy.example.com/path", "");
    expect(stored).toBe("http://legacy.example.com/path");
    expect(schemeOf(stored)).toBe("http://");
    expect(fromAddressField("legacy.example.com/other", stored)).toBe("http://legacy.example.com/other");
  });

  it("treats spaces only as missing input, not as an invalid address", () => {
    expect(fromAddressField("   ", "")).toBe("");
    expect(urlProblem(fromAddressField("   ", ""))).toBe("urlEmpty");
  });
});
