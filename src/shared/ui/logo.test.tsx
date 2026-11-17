// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Logo, LogoMark } from "./logo";

afterEach(cleanup);

describe("Logo", () => {
  it("exposes the lockup as one image named Hey QR", () => {
    render(<Logo />);
    const logo = screen.getByRole("img", { name: "Hey QR" });
    expect(logo).toBeInTheDocument();
    expect(logo.querySelector("[data-slot=logo-mark]")).toHaveAttribute("aria-hidden", "true");
  });

  it("accepts a custom accessible name", () => {
    render(<Logo label="Hey QR home" tone="inverse" size="lg" />);
    expect(screen.getByRole("img", { name: "Hey QR home" })).toBeInTheDocument();
  });

  it("draws the mark with the design geometry and thickens the ring at small sizes", () => {
    const { container, rerender } = render(<LogoMark />);
    const ring = () => container.querySelector("path");
    const core = () => container.querySelector("rect");
    expect(ring()).toHaveAttribute("stroke-width", "2.6");
    expect(core()).toHaveAttribute("rx", "3.6");
    expect(core()).toHaveClass("fill-logo-core");

    rerender(<LogoMark size={18} />);
    expect(ring()).toHaveAttribute("stroke-width", "3.2");

    rerender(<LogoMark size={16} />);
    expect(ring()).toHaveAttribute("stroke-width", "3.6");
    expect(core()).toHaveAttribute("rx", "3");
  });

  it("is decorative unless labelled", () => {
    const { container } = render(<LogoMark />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    render(<LogoMark label="Hey QR" />);
    expect(screen.getByRole("img", { name: "Hey QR" })).toBeInTheDocument();
  });
});
