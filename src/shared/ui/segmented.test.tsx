// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segmented } from "./segmented";

afterEach(cleanup);

describe("Segmented", () => {
  it("marks the selected option with aria-pressed and reports changes", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Code type"
        value="static"
        options={[
          { value: "static", label: "Static" },
          { value: "dynamic", label: "Dynamic" },
        ]}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("group", { name: "Code type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Static" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Dynamic" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Dynamic" }));
    expect(onChange).toHaveBeenCalledWith("dynamic");
  });
});
