// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { announceLocaleChange, useCarriedState } from "./locale-carry";

/* HEY-192: a language change remounts the page; unsaved state handed over just before it comes back once. */
function Field({ id, onSet }: { id: string; onSet?: (set: (v: string) => void) => void }) {
  const [value, setValue, carried] = useCarriedState(`field:${id}`, "initial");
  onSet?.(setValue);
  return <output aria-label={id}>{`${value}${carried ? " (carried)" : ""}`}</output>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCarriedState (HEY-192)", () => {
  it("hands the unsaved value to the remounted page, once", () => {
    let set: (v: string) => void = () => {};
    const first = render(<Field id="a" onSet={(s) => (set = s)} />);
    act(() => set("typed before the switch"));
    act(() => announceLocaleChange());
    first.unmount();
    render(<Field id="a" />);
    expect(screen.getByLabelText("a")).toHaveTextContent("typed before the switch (carried)");
    cleanup();
    render(<Field id="a" />);
    expect(screen.getByLabelText("a")).toHaveTextContent(/^initial$/);
  });

  it("is per key: another record never picks it up", () => {
    let set: (v: string) => void = () => {};
    const first = render(<Field id="one" onSet={(s) => (set = s)} />);
    act(() => set("edits of one"));
    act(() => announceLocaleChange());
    first.unmount();
    render(<Field id="two" />);
    expect(screen.getByLabelText("two")).toHaveTextContent(/^initial$/);
  });

  it("expires: a switch that never navigated doesn't bring old edits back later", () => {
    vi.useFakeTimers();
    let set: (v: string) => void = () => {};
    const first = render(<Field id="late" onSet={(s) => (set = s)} />);
    act(() => set("stale"));
    act(() => announceLocaleChange());
    first.unmount();
    vi.advanceTimersByTime(11_000);
    render(<Field id="late" />);
    expect(screen.getByLabelText("late")).toHaveTextContent(/^initial$/);
  });
});
