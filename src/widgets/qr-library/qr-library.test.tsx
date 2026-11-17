// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QrCard } from "./qr-card";
import { QrLibrarySkeleton } from "./qr-library-skeleton";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props} />,
}));

afterEach(cleanup);

const base = {
  name: "Café menu",
  href: "/dashboard/qr/1",
  exportHref: "/create/export?qr=1&layout=l1",
  value: "https://example.com",
  typeLabel: "Website",
  model: "dynamic" as const,
  modelLabel: "Dynamic",
  meta: "Updated Nov 17, 2026",
  labels: { open: "Open Café menu", edit: "Edit design", download: "Download", buy: "Buy & download" },
};

describe("QrCard", () => {
  it("shows the name, badges and a Download action for paid codes", () => {
    render(
      <ul>
        <QrCard {...base} status="active" statusLabel="Active" paid />
      </ul>,
    );
    expect(screen.getByRole("link", { name: "Café menu" })).toHaveAttribute("href", "/dashboard/qr/1");
    expect(screen.getByText("Dynamic")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit design" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/create/export?qr=1&layout=l1");
  });

  it("offers Buy & download for drafts", () => {
    render(
      <ul>
        <QrCard {...base} status="draft" statusLabel="Draft" paid={false} />
      </ul>,
    );
    expect(screen.getByRole("link", { name: "Buy & download" })).toBeInTheDocument();
  });
});

describe("QrLibrarySkeleton", () => {
  it("is a busy list with one row per expected code", () => {
    render(<QrLibrarySkeleton label="Loading your QR codes" rows={3} />);
    const list = screen.getByRole("list", { name: "Loading your QR codes" });
    expect(list).toHaveAttribute("aria-busy", "true");
    expect(list.querySelectorAll("li")).toHaveLength(3);
  });
});
