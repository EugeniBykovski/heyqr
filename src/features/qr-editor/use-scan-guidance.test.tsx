// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout, type EditorDesign } from "@/entities/qr";
import type { Decoder } from "./use-scan-check";
import { useScanGuidance } from "./use-scan-guidance";

/* HEY-68: fixes and explanations stay with the artwork they started from; an applied fix is verified on its own render. */
const VALUE = "https://anareyes.studio/portfolio";
const logoCard = (logoSize: number, extra: Partial<EditorDesign> = {}): EditorDesign => ({
  ...DEFAULT_DESIGN,
  content: { type: "website", url: VALUE },
  logo: { kind: "icon", icon: "coffee" },
  logoSize,
  ...extra,
});

function deferredDecoder() {
  const pending: { svg: string; resolve: (v: string | null) => void }[] = [];
  const decoder = vi.fn<Decoder>((svg) => new Promise((resolve) => pending.push({ svg, resolve })));
  return { decoder, pending };
}

// One layout per design object, as the editor memoises it (a re-render alone is not new artwork).
const layouts = new WeakMap<EditorDesign, ReturnType<typeof designToLayout>>();
const layoutOf = (d: EditorDesign) => layouts.get(d) ?? layouts.set(d, designToLayout(d)).get(d) ?? designToLayout(d);

function mount(decoder: Decoder, first: EditorDesign) {
  const change = vi.fn();
  const hook = renderHook(
    ({ design }) => useScanGuidance({ latest: { layout: layoutOf(design), value: VALUE }, design, change, decoder }),
    { initialProps: { design: first } },
  );
  // A new artwork, as the editor makes on every edit, Undo / Redo or layout switch.
  const show = (design: EditorDesign) => hook.rerender({ design });
  return { hook, change, show };
}

describe("scan guidance (HEY-68)", () => {
  it("Reduce logo size applies a decoded size as one step, then checks the new artwork", async () => {
    const { decoder, pending } = deferredDecoder();
    const a = logoCard(0.46, { caption: "keep me", fg: "#1F4E8C" });
    const { hook, change, show } = mount(decoder, a);
    act(() => void hook.result.current.reduceLogo());
    expect(hook.result.current.logoSearch).toEqual({ kind: "searching" });
    await act(async () => pending[0]?.resolve(null)); // 45 % doesn't scan
    await act(async () => pending[1]?.resolve(VALUE)); // 44 % does
    expect(change).toHaveBeenCalledTimes(1);
    expect(change).toHaveBeenCalledWith({ logoSize: 0.44 }, { step: true }); // only the size; one undoable step
    show({ ...a, logoSize: 0.44 });
    expect(decoder).toHaveBeenCalledTimes(3); // the fresh render is checked before anything says it scans
    expect(hook.result.current.decode).toEqual({ kind: "checking" });
    await act(async () => pending[2]?.resolve(VALUE));
    expect(hook.result.current.decode).toEqual({ kind: "ok", decoded: VALUE });
  });

  it("a search that started on another artwork never applies a size", async () => {
    const { decoder, pending } = deferredDecoder();
    const a = logoCard(0.46);
    const { hook, change, show } = mount(decoder, a);
    act(() => void hook.result.current.reduceLogo());
    show(logoCard(0.46, { name: "Layout B", fg: "#1F4E8C" })); // switch layouts while 45 % decodes
    expect(hook.result.current.logoSearch).toBeNull();
    await act(async () => pending[0]?.resolve(VALUE));
    expect(change).not.toHaveBeenCalled();
    expect(decoder).toHaveBeenCalledTimes(1);
  });

  it("when no smaller size scans, the design stays and the search says so for this artwork only", async () => {
    const decoder = vi.fn<Decoder>(async () => null);
    const a = logoCard(0.12);
    const { hook, change, show } = mount(decoder, a);
    await act(async () => hook.result.current.reduceLogo());
    expect(hook.result.current.logoSearch).toEqual({ kind: "none", tried: 2 });
    expect(change).not.toHaveBeenCalled();
    show({ ...a, fg: "#1F4E8C" });
    expect(hook.result.current.logoSearch).toBeNull();
  });

  it("causes found for an earlier artwork never show on the current one", async () => {
    const { decoder, pending } = deferredDecoder();
    const a = logoCard(0.46);
    const { hook, show } = mount(decoder, a);
    act(() => hook.result.current.check());
    await act(async () => pending[0]?.resolve(null)); // A didn't scan; its causes are being confirmed
    expect(hook.result.current.decode).toEqual({ kind: "unreadable", decoded: null, causes: "finding" });
    show({ ...a, logoSize: 0.3 });
    await act(async () => pending[1]?.resolve(VALUE)); // A without its logo scans: "logo", but for A only
    expect(hook.result.current.decode).toBeNull();
  });
});
