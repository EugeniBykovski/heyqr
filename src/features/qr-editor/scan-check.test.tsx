// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DESIGN, designToLayout } from "@/entities/qr";
import { useScanCheck, type Decoder } from "./use-scan-check";

/* HEY-67: the scan check's results belong to the artwork they checked; late results never land on newer artwork. */
const VALUE = "https://anareyes.studio/portfolio";
// Fresh layout objects per test: finished decodes are shared per artwork (layout object), across the module.
const layouts = () => ({
  layoutA: designToLayout({ ...DEFAULT_DESIGN, caption: "A", preset: "caption" }),
  layoutB: designToLayout({ ...DEFAULT_DESIGN, caption: "B", preset: "caption", fg: "#1F4E8C" }),
});

/** A decoder whose answers the test releases one by one. */
function deferredDecoder() {
  const pending: { resolve: (v: string | null) => void; reject: (e: Error) => void }[] = [];
  const decoder = vi.fn<Decoder>(
    () =>
      new Promise<string | null>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { decoder, pending };
}

const mount = (decoder: Decoder, layout: ReturnType<typeof designToLayout>, value = VALUE) =>
  renderHook(({ l, v }) => useScanCheck(l, v, decoder), { initialProps: { l: layout, v: value } });

describe("scan check (HEY-67)", () => {
  it("passes only when the decoded text equals the payload; a different text or none is unreadable", async () => {
    const { layoutA, layoutB } = layouts();
    const { decoder, pending } = deferredDecoder();
    const hook = mount(decoder, layoutA);
    act(() => hook.result.current.check());
    expect(hook.result.current.decode).toEqual({ kind: "checking" });
    await act(async () => pending[0]?.resolve(VALUE));
    expect(hook.result.current.decode).toEqual({ kind: "ok", decoded: VALUE });

    const second = deferredDecoder();
    const other = mount(second.decoder, layoutB);
    expect(other.result.current.decode).toBeNull();
    act(() => other.result.current.check());
    await act(async () => second.pending[0]?.resolve("https://somewhere.else"));
    expect(other.result.current.decode).toEqual({ kind: "unreadable", decoded: "https://somewhere.else" });
  });

  it("a slow result for layout A never shows after an edit or a switch to B; B's own check does", async () => {
    const { layoutA, layoutB } = layouts();
    const { decoder, pending } = deferredDecoder();
    const hook = mount(decoder, layoutA);
    act(() => hook.result.current.check());
    hook.rerender({ l: layoutB, v: VALUE }); // edit, Undo/Redo or layout switch: new artwork
    expect(hook.result.current.decode).toBeNull();
    await act(async () => pending[0]?.resolve(VALUE)); // A's late answer
    expect(hook.result.current.decode).toBeNull();
    act(() => hook.result.current.check());
    await act(async () => pending[1]?.resolve(null));
    expect(hook.result.current.decode).toEqual({ kind: "unreadable", decoded: null });
    // Going back to A's artwork doesn't revive its old result either: it needs its own check.
    hook.rerender({ l: layoutA, v: VALUE });
    expect(hook.result.current.decode).toBeNull();
  });

  it("checks of the same artwork share one decode; a failed one can be retried", async () => {
    const layout = designToLayout({ ...DEFAULT_DESIGN, caption: "Shared", preset: "caption" });
    const { decoder, pending } = deferredDecoder();
    const hook = mount(decoder, layout);
    act(() => hook.result.current.check());
    act(() => hook.result.current.check());
    expect(decoder).toHaveBeenCalledTimes(1);
    await act(async () => pending[0]?.reject(new Error("reader unavailable")));
    expect(hook.result.current.decode).toEqual({ kind: "error" });
    act(() => hook.result.current.check());
    expect(decoder).toHaveBeenCalledTimes(2);
    await act(async () => pending[1]?.resolve(VALUE));
    expect(hook.result.current.decode).toEqual({ kind: "ok", decoded: VALUE });
  });
});
