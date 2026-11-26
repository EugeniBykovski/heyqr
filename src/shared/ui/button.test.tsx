// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button, type ButtonProps } from "./button";

const variants: NonNullable<ButtonProps["variant"]>[] = ["primary", "secondary", "accent", "ghost", "link", "danger"];
const sizes: NonNullable<ButtonProps["size"]>[] = ["sm", "md", "lg"];

afterEach(cleanup);

describe("Button", () => {
  it.each(variants)("renders the %s variant as an accessible button", (variant) => {
    render(<Button variant={variant}>Export</Button>);
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it.each(sizes)("renders the %s size", (size) => {
    render(<Button size={size}>Export</Button>);
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });

  it("pulses on hover with the variant colour, but not ghost or link", () => {
    render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="accent">Accent</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Primary" }).className).toContain("hover:animate-pulse-primary");
    expect(screen.getByRole("button", { name: "Secondary" }).className).toContain("hover:animate-pulse-neutral");
    expect(screen.getByRole("button", { name: "Accent" }).className).toContain("hover:animate-pulse-accent");
    expect(screen.getByRole("button", { name: "Ghost" }).className).not.toContain("animate-pulse");
    expect(screen.getByRole("button", { name: "Link" }).className).not.toContain("animate-pulse");
  });

  it("never moves on hover; pressing only scales in place", () => {
    render(<Button variant="primary">Export</Button>);
    const className = screen.getByRole("button", { name: "Export" }).className;
    expect(className).not.toMatch(/translate-y/);
    expect(className).toContain("active:scale-[.985]");
  });

  it("keeps the design control heights", () => {
    render(
      <>
        <Button size="sm">Small</Button>
        <Button>Medium</Button>
        <Button size="lg">Large</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Small" })).toHaveClass("min-h-control-sm");
    expect(screen.getByRole("button", { name: "Medium" })).toHaveClass("min-h-control");
    expect(screen.getByRole("button", { name: "Large" })).toHaveClass("min-h-control-lg");
  });

  it("renders as its child for links", () => {
    render(
      <Button asChild>
        <a href="https://example.com/pricing">Pricing</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "https://example.com/pricing");
  });

  /* HEY-191: design `.is-loading` — busy, not dimmed, still focusable, and a pending action can't run twice. */
  it("loading: busy and aria-disabled, spinner and loading text, focus kept, clicks swallowed", () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" loading loadingText="Preparing…" onClick={onClick}>
        Export
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Preparing…" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.className).toContain("data-loading:cursor-progress");
    expect(button.className).toContain("not-data-loading:aria-disabled:opacity-40");
  });

  it("loading in a form: clicks don't submit while pending; the label and action come back after", () => {
    const submit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    function Form() {
      const [pending, setPending] = useState(true);
      return (
        <form onSubmit={submit}>
          <input aria-label="Name" />
          <Button type="submit" loading={pending} loadingText="Saving…">
            Save
          </Button>
          <button type="button" onClick={() => setPending(false)}>
            done
          </button>
        </form>
      );
    }
    render(<Form />);
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "done" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).not.toHaveAttribute("aria-busy");
    expect(save).not.toHaveAttribute("aria-disabled");
    expect(save.querySelector('[data-slot="spinner"]')).toBeNull();
    fireEvent.click(save);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("a disabled button stays disabled, dims, and doesn't scale when pressed", () => {
    render(<Button disabled>Export</Button>);
    const button = screen.getByRole("button", { name: "Export" });
    expect(button).toBeDisabled();
    expect(button.className).toContain("disabled:opacity-40");
    expect(button.className).toContain("disabled:active:scale-100");
  });

  it("danger fills soft red on hover; solid danger dims to 45 % when disabled (design heyqr.css)", () => {
    render(
      <>
        <Button variant="danger">Delete</Button>
        <Button variant="danger-solid">Delete for good</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("hover:bg-danger-soft");
    expect(screen.getByRole("button", { name: "Delete for good" }).className).toContain("disabled:opacity-45");
  });

  it("icon-only buttons carry their name in aria-label", () => {
    render(
      <Button size="icon" aria-label="Close">
        <svg aria-hidden />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toHaveClass("size-control");
  });
});
