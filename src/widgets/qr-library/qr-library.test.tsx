// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { QrCard } from "./qr-card";
import { QrLibraryManager } from "./qr-library-manager";
import { QrLibrarySkeleton } from "./qr-library-skeleton";

vi.mock("@/server/actions/qr", () => ({ deleteQrs: vi.fn(), renameQr: vi.fn(), restoreQrs: vi.fn() }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  Link: ({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props} />,
}));

afterEach(cleanup);

const base = {
  name: "Café menu",
  href: "/dashboard/qr/1",
  editHref: "/edit/1?layout=l1",
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
    // HEY-45: Edit design opens the Design editor for the code's first layout, not the details page.
    expect(screen.getByRole("link", { name: "Edit design" })).toHaveAttribute("href", "/edit/1?layout=l1");
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

describe("QrCard · inline rename (design 4.2)", () => {
  const rename = {
    action: "Rename",
    actionOne: "Rename Café menu",
    label: "Name of Café menu",
    save: "Save",
    cancel: "Cancel",
    empty: "Give the code a name.",
  };
  const card = (onRename: (name: string) => Promise<boolean>) =>
    render(
      <ul>
        <QrCard {...base} labels={{ ...base.labels, rename }} status="active" statusLabel="Active" paid onRename={onRename} />
      </ul>,
    );

  it("edits the name in place: Enter saves the trimmed name, the new field closes and focus returns to Rename", async () => {
    const onRename = vi.fn(async () => true);
    card(onRename);
    fireEvent.click(screen.getByRole("button", { name: "Rename Café menu" }));
    const field = screen.getByRole("textbox", { name: "Name of Café menu" });
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Café menu");
    fireEvent.change(field, { target: { value: "  Café menu · table 4 " } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(onRename).toHaveBeenCalledWith("Café menu · table 4");
    expect(screen.queryByRole("textbox")).toBeNull();
    await act(async () => new Promise((r) => requestAnimationFrame(() => r(undefined))));
    expect(screen.getByRole("button", { name: "Rename Café menu" })).toHaveFocus();
  });

  it("Escape cancels without saving; an empty name explains instead of saving; a failed save keeps the text", async () => {
    const onRename = vi.fn(async () => false);
    card(onRename);
    fireEvent.click(screen.getByRole("button", { name: "Rename Café menu" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Rename Café menu" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give the code a name.");
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Brunch" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(onRename).toHaveBeenCalledWith("Brunch");
    expect(screen.getByRole("textbox")).toHaveValue("Brunch");
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

describe("QrCard · actions (HEY-79, design 4.2)", () => {
  it("are Delete, Rename, Edit design, then the main action, all for this code", () => {
    render(
      <ul>
        <QrCard
          {...base}
          status="draft"
          statusLabel="Draft"
          paid={false}
          onDelete={() => {}}
          onRename={async () => true}
          labels={{
            ...base.labels,
            delete: "Delete Café menu",
            rename: {
              action: "Rename",
              actionOne: "Rename Café menu",
              label: "New name",
              save: "Save",
              cancel: "Cancel",
              empty: "Enter a name",
            },
          }}
        />
      </ul>,
    );
    const actions = [...screen.getByRole("listitem").querySelectorAll("button, a")]
      .map((a) => a.getAttribute("aria-label") ?? a.textContent)
      .filter((n) => n !== "Open Café menu" && n !== "Café menu");
    expect(actions).toEqual(["Delete Café menu", "Rename Café menu", "Edit design", "Buy & download"]);
  });

  it("the loading row has the same four action slots", () => {
    render(<QrLibrarySkeleton label="Loading your QR codes" rows={1} />);
    expect(screen.getByRole("listitem").lastElementChild?.children).toHaveLength(4);
  });
});

describe("QrLibraryManager · filter with no matches (HEY-79)", () => {
  it("shows the no-match message instead of an empty list", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <QrLibraryManager
          title="My QR codes"
          sub={null}
          createLabel="Create QR code"
          filters={null}
          items={[]}
          total={2}
          noMatch={<p role="status">No dynamic QR codes</p>}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("No dynamic QR codes");
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  });
});
