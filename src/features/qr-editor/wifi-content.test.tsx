// @vitest-environment jsdom
import { encodePayload, type QrContent } from "@heyqr/qr-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../messages/en.json";
import { ContentForm } from "./content-form";
import { ContentPreview } from "./content-preview";
import { contentErrors } from "./content-validation";

afterEach(cleanup);

const PASSWORD = "synthetic-pass-1";
let latest: QrContent = { type: "wifi", ssid: "", security: "WPA", password: "" };

/** Content step + After scanning, wired the way the editor wires them: one content value feeds both. */
function Harness({ initial }: { initial: QrContent }) {
  const [content, setContent] = useState(initial);
  const change = (next: QrContent) => {
    latest = next;
    setContent(next);
  };
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <ContentForm content={content} onChange={change} errors={contentErrors(content)} />
      <ContentPreview content={content} mode="static" />
    </NextIntlClientProvider>
  );
}

function renderWifi(initial: QrContent) {
  latest = initial;
  return render(<Harness initial={initial} />);
}

describe("Wi-Fi content and After scanning (HEY-22)", () => {
  it("masks the password, offers Show, and never puts it in the preview", () => {
    renderWifi({ type: "wifi", ssid: "  Studio  Guest ", security: "WPA", password: PASSWORD });
    const field = screen.getByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(field).toHaveAttribute("type", "text");
    const preview = screen.getByRole("figure");
    expect(preview.textContent).not.toContain(PASSWORD);
    expect(preview.textContent).toContain("WPA/WPA2/WPA3");
    expect(preview.textContent).toContain("••••••••");
    // The network name is shown exactly, spaces included.
    expect(preview.querySelector("b")?.textContent).toBe("  Studio  Guest ");
  });

  it("switching to No password hides the field, drops the password row and leaves P: out of the payload", () => {
    renderWifi({ type: "wifi", ssid: "Lobby", security: "WPA", password: PASSWORD });
    fireEvent.click(screen.getByRole("button", { name: "No password" }));
    expect(screen.queryByLabelText("Password")).toBeNull();
    const preview = screen.getByRole("figure");
    expect(preview.textContent).toContain("Open network");
    expect(preview.textContent).not.toContain("••••••••");
    expect(contentErrors(latest)).toEqual({});
    expect(encodePayload(latest)).toBe("WIFI:T:nopass;S:Lobby;;");
  });

  it("requires the password for WPA and WEP, and keeps the hidden-network setting", () => {
    renderWifi({ type: "wifi", ssid: "Back room", security: "WPA", password: "" });
    expect(contentErrors(latest)).toEqual({ password: "password" });
    fireEvent.click(screen.getByRole("button", { name: "WEP" }));
    expect(contentErrors(latest)).toEqual({ password: "password" });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "abcde" } });
    fireEvent.click(screen.getByLabelText("This network is hidden"));
    expect(contentErrors(latest)).toEqual({});
    expect(encodePayload(latest)).toBe("WIFI:T:WEP;S:Back room;P:abcde;H:true;;");
  });
});
