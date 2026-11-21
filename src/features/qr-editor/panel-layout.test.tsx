// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { QrContent } from "@heyqr/qr-core";
import { contentDisplayName } from "@/entities/qr";
import messages from "../../../messages/en.json";
import { ContentStep } from "./content-step";
import { editorStage } from "./editor-layout";

/* HEY-64: responsive panels — Content step copy (design 2.3), names from content, the phone preview with a keyboard. */
afterEach(cleanup);
const intl = (node: ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    {node}
  </NextIntlClientProvider>
);
const step = (content: QrContent, mode: "static" | "dynamic" = "static") =>
  render(
    intl(
      <ContentStep
        content={content}
        mode={mode}
        name=""
        errors={{}}
        showErrors={false}
        onContentChange={() => {}}
        onNameChange={() => {}}
        onBack={() => {}}
        onContinue={() => {}}
      />,
    ),
  );

describe("responsive panels (HEY-64)", () => {
  it("a code without a name is called after its content, like the design (host, first line, network…)", () => {
    expect(contentDisplayName({ type: "website", url: "https://www.littlefern.cafe/menu?table=4" })).toBe("littlefern.cafe");
    expect(contentDisplayName({ type: "website", url: "anareyes.studio/portfolio" })).toBe("anareyes.studio");
    expect(contentDisplayName({ type: "website", url: "  " })).toBeNull();
    expect(contentDisplayName({ type: "text", text: "Studio hours\nMon–Fri" })).toBe("Studio hours");
    expect(contentDisplayName({ type: "wifi", ssid: "Reyes Studio Guest", security: "WPA", password: "x" })).toBe("Reyes Studio Guest");
    expect(contentDisplayName({ type: "contact", firstName: "Ana", lastName: "Reyes" })).toBe("Ana Reyes");
    expect(contentDisplayName({ type: "event", title: "Spring show", start: "2026-12-05" })).toBe("Spring show");
  });

  it("Content: “Website address” with its hint per mode, the host in the preview toggle and the name placeholder", () => {
    const view = step({ type: "website", url: "littlefern.cafe/menu" });
    expect(screen.getByLabelText("Website address")).toHaveAccessibleDescription(/built into the code/);
    expect(screen.getByRole("button", { name: /After scanning/ }).textContent).toContain("littlefern.cafe");
    const name = screen.getByLabelText(/Name in My QR codes/);
    expect(name).toHaveAttribute("placeholder", "littlefern.cafe");
    expect(name).toHaveAccessibleDescription("Only you see this name.");
    view.unmount();
    step({ type: "website", url: "" }, "dynamic");
    expect(screen.getByLabelText("Website address")).toHaveAccessibleDescription(/permanent short link/);
    expect(screen.getByRole("button", { name: /After scanning/ }).textContent).toContain("See what people get on their phone");
  });

  it("below 1024 px the sticky preview lets go while a text field has focus, never for a slider", () => {
    const rule = editorStage.split(" ").find((c) => c.includes("group-has-"));
    expect(rule).toBe("max-lg:group-has-[input:not([type=range]):focus,textarea:focus,select:focus]/ed:static");
  });
});
