// @vitest-environment jsdom
import { brandHeader, centerTextLabel, composeLayout, fitCaption, layoutGeometry } from "@heyqr/qr-core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DESIGN, defaultFrameTextColor, designToLayout, type EditorDesign } from "@/entities/qr";
import messages from "../../../messages/en.json";
import { DesignSettings, type DesignGroup } from "./design-settings";

/* HEY-60: the Logo (1.11) and Caption (1.16) panels and the text / logo fit behind them. */
afterEach(cleanup);

let latest: EditorDesign = DEFAULT_DESIGN;
function Harness({ initial, group: first }: { initial: EditorDesign; group: DesignGroup }) {
  const [design, setDesign] = useState(initial);
  const [group, setGroup] = useState<DesignGroup>(first);
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <DesignSettings
        group={group}
        onGroupChange={setGroup}
        design={design}
        value="https://littlefern.cafe/menu"
        onChange={(p) => {
          latest = { ...design, ...p };
          setDesign(latest);
        }}
      />
    </NextIntlClientProvider>
  );
}
const open = (initial: EditorDesign, group: DesignGroup) => {
  latest = initial;
  return render(<Harness initial={initial} group={group} />);
};
const svgLogo = (w: number, h: number) =>
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`,
  ).toString("base64");
const card: EditorDesign = {
  ...DEFAULT_DESIGN,
  preset: "horizontal",
  caption: "Little Fern Coffee",
  size: { unit: "mm", qr: 35, width: 43.3, height: 52.9 },
};

describe("Logo panel (1.11)", () => {
  it("shows exactly the 38 icons, no 'no logo' tile; Remove logo, backing and position work", () => {
    open({ ...card, logo: { kind: "icon", icon: "briefcase" } }, "logo");
    expect(within(screen.getByRole("group", { name: "Center" })).getAllByRole("button")).toHaveLength(38);
    fireEvent.click(within(screen.getByRole("group", { name: "Backing" })).getByRole("button", { name: "Square" }));
    expect(latest.logoPlate).toBe("square");
    // "Top of card" needs an uploaded image on a card; an icon stays in the center.
    expect(within(screen.getByRole("group", { name: "Position" })).getByRole("button", { name: "Top of card" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(latest.logo).toEqual({ kind: "none" });
  });

  it("an uploaded image on a card can go on top of the card; Branded mode hides the icon library", () => {
    const view = open({ ...card, logo: { kind: "image", href: svgLogo(400, 100) } }, "logo");
    fireEvent.click(within(screen.getByRole("group", { name: "Position" })).getByRole("button", { name: "Top of card" }));
    expect(latest.logoPosition).toBe("top");
    view.unmount();
    open({ ...card, designMode: "branded", logo: { kind: "none" } }, "logo");
    expect(screen.queryByRole("group", { name: "Logo source" })).toBeNull();
    expect(screen.getByRole("button", { name: "Upload an image first" })).toBeInTheDocument();
  });
});

describe("Caption panel (1.16)", () => {
  it("Weight, Align and Position are segmented controls; Caption color opens Colors on the caption", () => {
    open({ ...card, preset: "caption" }, "caption");
    fireEvent.click(within(screen.getByRole("group", { name: "Weight" })).getByRole("button", { name: "Medium" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Align" })).getByRole("button", { name: "Right" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Position" })).getByRole("button", { name: "In the code" }));
    expect([latest.captionWeight, latest.captionAlign, latest.captionPosition]).toEqual([500, "right", "inside"]);
    // "Little Fern Coffee" doesn't fit inside the code: the panel says what is shown.
    expect(screen.getByRole("status").textContent).toContain("“Little Fern…”");
    fireEvent.click(screen.getByRole("button", { name: /Caption color/ }));
    const targets = screen.getByRole("group", { name: "Color targets" });
    expect(within(targets).getByRole("button", { pressed: true }).textContent).toContain("Caption");
  });
});

describe("Position labels and frame text in the code (HEY-194, design 1.16)", () => {
  const positions = () =>
    within(screen.getByRole("group", { name: "Position" }))
      .getAllByRole("button")
      .map((b) => b.textContent);

  it("QR + caption reads Below / Above / In the code; the horizontal card Right of / Left of the code", () => {
    const view = open({ ...card, preset: "caption" }, "caption");
    expect(positions()).toEqual(["Below code", "Above code", "In the code"]);
    view.unmount();
    open(card, "caption");
    expect(positions()).toEqual(["Right of code", "Left of code", "In the code"]);
  });

  it("a frame's text goes on the frame or in the code, and the typed text survives frame and position changes", () => {
    open({ ...card, preset: "frame", frameStyle: "bar", caption: "Little Fern Coffee" }, "frame");
    expect(positions()).toEqual(["On the frame", "In the code"]);
    expect(within(screen.getByRole("group", { name: "Position" })).getByRole("button", { name: "On the frame" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(screen.getByRole("group", { name: "Position" })).getByRole("button", { name: "In the code" }));
    expect(latest.frameTextPosition).toBe("inside");
    // Too long for the plate: the panel says what the code shows.
    expect(screen.getByRole("status").textContent).toContain("“Little Fern…”");
    fireEvent.click(screen.getByRole("button", { name: "Ticket" }));
    expect([latest.frameStyle, latest.caption, latest.frameTextPosition]).toEqual(["ticket", "Little Fern Coffee", "inside"]);
    fireEvent.click(within(screen.getByRole("group", { name: "Position" })).getByRole("button", { name: "On the frame" }));
    expect([latest.frameTextPosition, latest.caption]).toEqual(["frame", "Little Fern Coffee"]);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("text and logo fit (HEY-60)", () => {
  it("a caption inside the code is cut at a word with an ellipsis, never mid-word", () => {
    expect(centerTextLabel("Menu")).toEqual({ label: "Menu", shortened: false });
    expect(centerTextLabel("Little Fern Coffee")).toEqual({ label: "Little Fern…", shortened: true });
    expect(centerTextLabel("Supercalifragilistic")).toEqual({ label: "Supercalifrag…", shortened: true });
    const svg = composeLayout(
      designToLayout({ ...card, preset: "caption", captionPosition: "inside" }),
      "https://littlefern.cafe/menu",
    ).svg;
    expect(svg).toContain(">Little Fern…<");
    expect(svg).not.toContain("Little Fern Co<");
  });

  it("a short caption keeps to one line beside the business card's code (design); a long one wraps inside its box", () => {
    const fit = (caption: string) => {
      const layout = designToLayout({ ...card, caption });
      const g = layoutGeometry(layout);
      const box = g.caption ?? [0, 0, 0, 0];
      return { ...fitCaption({ text: caption, font: layout.caption.font, weight: layout.caption.weight }, 4.939, box[2], box[3]), box };
    };
    const short = fit("View portfolio\nanareyes.studio");
    expect(short.lines.map((l) => l.text)).toEqual(["View portfolio", "anareyes.studio"]);
    expect(short.fs).toBeGreaterThanOrEqual(4.939 * 0.75);
    const long = fit("Little Fern Coffee");
    expect(long.lines.length).toBeGreaterThan(1);
    expect(long.fs).toBeLessThanOrEqual(4.939);
  });

  it("wide and tall logos above the card keep their aspect ratio inside the header band", () => {
    for (const [w, h] of [
      [400, 100],
      [100, 400],
    ]) {
      const layout = designToLayout({
        ...card,
        logo: { kind: "image", href: svgLogo(w, h) },
        logoPosition: "top",
        brandName: "Little Fern Coffee",
      });
      const g = layoutGeometry(layout);
      const header = brandHeader(layout, g);
      const top = g.top ?? [0, 0, 0, 0];
      if (!header) throw new Error("no header");
      const [x, y, lw, lh] = header.logo;
      expect(lw / lh).toBeCloseTo(w / h, 2);
      expect(x).toBeGreaterThanOrEqual(top[0] - 1e-6);
      expect(y).toBeGreaterThanOrEqual(top[1] - 1e-6);
      expect(x + lw).toBeLessThanOrEqual(top[0] + top[2] + 1e-6);
      expect(y + lh).toBeLessThanOrEqual(top[1] + top[3] + 1e-6);
      // The code keeps its place and size (quiet zone included): the header never pushes into it.
      expect(g.qr[2]).toBe(35);
    }
  });

  it("frame labels off the frame band (Corners, Phone) default to the frame color, never white on white", () => {
    for (const frameStyle of ["corners", "phone"] as const) {
      const d = { ...DEFAULT_DESIGN, preset: "frame" as const, frameStyle, caption: "Little Fern Coffee" };
      expect(defaultFrameTextColor(d)).toBe(DEFAULT_DESIGN.fg);
      expect(designToLayout(d).colors.caption).toBe(DEFAULT_DESIGN.fg);
    }
    expect(designToLayout({ ...DEFAULT_DESIGN, preset: "frame", frameStyle: "bar", caption: "x" }).colors.caption).toBe(DEFAULT_DESIGN.bg);
  });
});

describe("Layout group (HEY-61)", () => {
  it("a horizontal card's own canvas is not the vertical card's: the tile shows its own size, switching drops it", () => {
    open({ ...card, cardSize: { width: 90, height: 50 } }, "layout");
    expect(screen.getByRole("button", { name: /Vertical card/ }).textContent).toContain("47 × 72.6 mm");
    expect(screen.getByRole("button", { name: /Horizontal card/ }).textContent).toContain("90 × 50 mm");
    fireEvent.click(screen.getByRole("button", { name: /Vertical card/ }));
    expect([latest.preset, latest.cardSize]).toEqual(["vertical", undefined]);
  });

  it("a quick style applies its look in one change and leaves the caption, logo and size as they are", () => {
    open({ ...card, logo: { kind: "icon", icon: "coffee" }, cardSize: { width: 90, height: 50 } }, "layout");
    fireEvent.click(screen.getByRole("button", { name: "Apply Gem style" }));
    expect(latest).toMatchObject({ pattern: "diamond", eyeFrame: "leaf", eyeBall: "diamond", fg: "#4B2EE0", bg: "#F5F3FF" });
    expect([latest.caption, latest.logo, latest.cardSize]).toEqual([
      "Little Fern Coffee",
      { kind: "icon", icon: "coffee" },
      { width: 90, height: 50 },
    ]);
    expect(screen.getByRole("group", { name: "Quick styles" }).querySelectorAll("button")).toHaveLength(6);
  });
});
