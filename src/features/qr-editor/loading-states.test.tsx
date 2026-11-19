// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "@/entities/qr";
import { useDelayedFlag } from "@/shared/lib/use-delayed-flag";
import messages from "../../../messages/en.json";
import { ContentPreview } from "./content-preview";
import { ContentStep } from "./content-step";
import { DesignCanvas, REBUILD_PILL_DELAY_MS, useShownRender } from "./design-canvas";

/** Every value the canvas actually drew, in order (QrPreview is the expensive part the deferral protects). */
const drawn: string[] = [];
vi.mock("@/entities/qr", async (orig) => {
  const mod = await orig<typeof import("@/entities/qr")>();
  return {
    ...mod,
    QrPreview: (props: Parameters<typeof mod.QrPreview>[0]) => {
      drawn.push(props.value);
      return <mod.QrPreview {...props} />;
    },
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  drawn.length = 0;
});

const intl = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
    {ui}
  </NextIntlClientProvider>
);
const layout = designToLayout(DEFAULT_DESIGN);

describe("indicators wait for slow work only (HEY-41)", () => {
  beforeEach(() => vi.useFakeTimers());

  it("a fast response (under the delay) never shows the indicator", () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedFlag(on, 200), { initialProps: { on: true } });
    act(() => vi.advanceTimersByTime(120));
    rerender({ on: false });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe(false);
  });

  it("a slow response shows it after the delay and hides it as soon as the response arrives", () => {
    const { result, rerender } = renderHook(({ on }) => useDelayedFlag(on, 200), { initialProps: { on: true } });
    act(() => vi.advanceTimersByTime(199));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
    rerender({ on: false });
    expect(result.current).toBe(false);
    rerender({ on: true }); // a new wait starts from zero again
    expect(result.current).toBe(false);
  });
});

describe("Design canvas rebuild (HEY-41)", () => {
  const canvas = (rebuilding: boolean, value = "https://a.example") =>
    intl(
      <DesignCanvas
        layout={layout}
        value={value}
        rebuilding={rebuilding}
        label="Preview"
        tooLongLabel="Too long"
        watermark="Preview"
        updatingLabel="Updating preview…"
      />,
    );

  it("keeps the last render on screen and shows the pill only for a slow rebuild, without taking layout space", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(canvas(false));
    const art = container.querySelector("[role=img]");
    rerender(canvas(true));
    act(() => vi.advanceTimersByTime(REBUILD_PILL_DELAY_MS - 50));
    expect(container.querySelector("[data-slot=rebuild-pill]")).toBeNull();
    expect(container.querySelector("[role=img]")).toBe(art); // last finished render stays
    act(() => vi.advanceTimersByTime(50));
    const pill = container.querySelector("[data-slot=rebuild-pill]");
    expect(pill?.className).toContain("absolute"); // overlays the art: no layout shift
    expect(screen.getByRole("status").textContent).toBe("Updating preview…");
    rerender(canvas(false));
    expect(container.querySelector("[data-slot=rebuild-pill]")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("settings changed in quick succession end on the latest render; an older one never replaces it", () => {
    function Harness({ value }: { value: string }) {
      const shown = useShownRender(layout, value);
      return (
        <DesignCanvas
          layout={shown.layout}
          value={shown.value}
          rebuilding={shown.rebuilding}
          label="Preview"
          tooLongLabel="Too long"
          watermark="Preview"
          updatingLabel="Updating preview…"
        />
      );
    }
    const { rerender, container } = render(intl(<Harness value="https://one.example" />));
    act(() => {
      rerender(intl(<Harness value="https://two.example" />));
      rerender(intl(<Harness value="https://three.example" />));
    });
    expect(drawn.at(-1)).toBe("https://three.example");
    // Once the latest render has been drawn, nothing older is drawn after it.
    expect(drawn.slice(drawn.indexOf("https://three.example"))).toEqual(
      drawn.slice(drawn.indexOf("https://three.example")).map(() => "https://three.example"),
    );
    expect(container.querySelector("[aria-busy]")).toBeNull();
    const expected = render(
      intl(
        <DesignCanvas
          layout={layout}
          value="https://three.example"
          rebuilding={false}
          label="x"
          tooLongLabel="x"
          watermark="x"
          updatingLabel="x"
        />,
      ),
    );
    expect(container.querySelector("svg")?.outerHTML).toBe(expected.container.querySelector("svg")?.outerHTML);
  });
});

describe("After scanning preview (HEY-41)", () => {
  const preview = (content: Parameters<typeof ContentPreview>[0]["content"], loading = false) =>
    render(intl(<ContentPreview content={content} mode="static" loading={loading} />));
  const phoneClass = (c: HTMLElement) => c.querySelector("figure > div")?.className;

  it("has a distinct empty state for Website, Text, Wi-Fi and contact", () => {
    const shapes = (["website", "text", "wifi", "contact"] as const).map((type) => {
      const content =
        type === "website"
          ? { type, url: "" }
          : type === "text"
            ? { type, text: "" }
            : type === "wifi"
              ? { type, ssid: "", password: "", security: "WPA" as const, hidden: false }
              : { type, firstName: "", lastName: "", phone: "", email: "", company: "", title: "", website: "" };
      const { container } = preview(content);
      const sig = [...container.querySelectorAll("[data-slot=placeholder]")].map((e) => e.className).join("|");
      const text = container.querySelector("figure")?.textContent ?? "";
      cleanup();
      return { sig, text };
    });
    expect(new Set(shapes.map((s) => s.sig)).size).toBe(4);
    expect(shapes[0]?.text).toContain("Your web page");
    expect(shapes[1]?.text).toContain("Scanned text");
    expect(shapes[2]?.text).toContain("Join Wi-Fi network");
    expect(shapes[3]?.text).toContain("Add to contacts");
  });

  it("Website: the page stays neutral with or without input and shows the domain only once the address is valid", () => {
    const silhouette = (c: HTMLElement) => c.querySelectorAll("[data-slot=placeholder]").length;
    const empty = preview({ type: "website", url: "" });
    const emptyCount = silhouette(empty.container);
    cleanup();
    const invalid = preview({ type: "website", url: "not a url" });
    expect(invalid.container.textContent).not.toContain("not a url");
    expect(silhouette(invalid.container)).toBe(emptyCount);
    cleanup();
    const valid = preview({ type: "website", url: "https://www.littlefern.cafe/menu" });
    expect(valid.container.textContent).toContain("www.littlefern.cafe/menu");
    expect(valid.container.textContent).toContain("littlefern.cafe");
    // Address bar and header swap their shapes for the domain; the page below keeps the same neutral blocks.
    expect(silhouette(valid.container)).toBe(emptyCount - 3);
  });

  it("loading: shapes shimmer inside the phone only, the phone keeps its size, and one status is announced", () => {
    const idle = preview({ type: "website", url: "https://littlefern.cafe" });
    const idleClass = phoneClass(idle.container);
    cleanup();
    const { container } = preview({ type: "website", url: "https://littlefern.cafe" }, true);
    expect(phoneClass(container)).toBe(idleClass);
    expect(container.querySelector("figure")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelectorAll("[data-slot=skeleton]").length).toBeGreaterThan(5);
    expect(container.textContent).not.toContain("littlefern.cafe");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});

describe("Content step on phones (HEY-41)", () => {
  const step = () =>
    render(
      intl(
        <ContentStep
          content={{ type: "website", url: "" }}
          mode="static"
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

  it("the preview toggle is a Tab stop that Enter and Space operate, and focus stays on it", () => {
    step();
    const toggle = screen.getByRole("button", { name: /After scanning/ });
    expect(toggle.tagName).toBe("BUTTON"); // native button: in the Tab order, Enter and Space activate it
    expect(toggle.tabIndex).toBe(0);
    const region = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(region?.hidden).toBe(true);
    toggle.focus();
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.click(toggle); // what the browser dispatches for Enter / Space on a button
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(region?.hidden).toBe(false);
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("the form is editable while nothing is loading: no busy state, every field enabled", () => {
    step();
    expect(document.querySelector("[aria-busy]")).toBeNull();
    for (const input of document.querySelectorAll("input")) expect(input.disabled).toBe(false);
  });
});
