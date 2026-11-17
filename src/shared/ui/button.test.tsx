// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
