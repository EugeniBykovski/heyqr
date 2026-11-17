// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders an accessible button with the primary pulse on hover", () => {
    render(<Button variant="primary">Download</Button>);
    const button = screen.getByRole("button", { name: "Download" });
    expect(button).toBeInTheDocument();
    expect(button.className).toContain("hover:animate-pulse-primary");
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
