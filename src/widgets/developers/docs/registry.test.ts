import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import messages from "../../../../messages/en.json";
import { pageCopy } from "./blocks";
import { EXAMPLES, TABBED } from "./examples";
import { DOCS_PAGES, docsHref, LEGACY_ANCHORS, neighbours, pageByPath, searchablePages, visiblePages } from "./registry";

const pages = messages.developers.docs.pages as Record<string, unknown>;

describe("docs pages (design 12.1–12.22)", () => {
  it("every page has its copy, and its anchors are exactly its section headings", () => {
    for (const p of DOCS_PAGES) {
      const copy = pageCopy(pages[p.id]);
      expect(
        copy.blocks.flatMap((b) => (b.k === "h2" ? [b.id] : [])),
        p.id,
      ).toEqual([...p.anchors]);
      for (const b of copy.blocks) {
        if (b.k === "code") expect(EXAMPLES[b.example], `${p.id}: ${b.example}`).toBeTruthy();
        if (b.k === "tabs") expect(TABBED[b.example], `${p.id}: ${b.example}`).toBeTruthy();
        if (b.k === "table") for (const r of b.rows) expect(r.cells, `${p.id}: ${b.label}`).toHaveLength(b.cols.length);
      }
    }
    expect(Object.keys(pages).sort()).toEqual(DOCS_PAGES.map((p) => p.id).sort());
  });

  it("search and production show public pages only; previews add the REST reference and the design previews", () => {
    expect(searchablePages().every((p) => p.visibility === "public")).toBe(true);
    expect(visiblePages(false).map((p) => p.id)).toEqual(searchablePages().map((p) => p.id));
    expect(visiblePages(true).length).toBe(DOCS_PAGES.length);
    expect(DOCS_PAGES.filter((p) => p.visibility === "designPreview").map((p) => p.id)).toEqual(["restBulk", "restScans"]);
  });

  it("design-preview pages say so before anything else; REST reference pages say they aren't public", () => {
    for (const p of DOCS_PAGES.filter((x) => x.visibility !== "public")) {
      const first = pageCopy(pages[p.id]).blocks[0];
      expect(first, p.id).toMatchObject({ k: "note", kind: "design" });
    }
  });

  it("Previous / Next follow the visible order and never lead to a hidden page", () => {
    const rest = pageByPath("rest");
    if (!rest) throw new Error("rest");
    // HEY-187: the live REST reference follows the REST overview everywhere; design previews only where allowed.
    expect(neighbours(rest, false)).toEqual({ previous: pageByPath("changelog"), next: pageByPath("rest/authentication") });
    expect(visiblePages(false).some((p) => p.visibility === "designPreview")).toBe(false);
    expect(
      visiblePages(true)
        .filter((p) => p.visibility === "designPreview")
        .map((p) => p.id),
    ).toEqual(["restBulk", "restScans"]);
  });

  it("old single-page anchors land on pages that exist", () => {
    for (const [anchor, href] of Object.entries(LEGACY_ANCHORS)) {
      const target = href.split("#")[0] ?? "";
      expect(
        DOCS_PAGES.some((p) => docsHref(p) === target && p.visibility === "public"),
        anchor,
      ).toBe(true);
    }
  });

  it("the SDK page's Quickstart is the package's verified example, word for word (HEY-173, HEY-187)", () => {
    const shipped = readFileSync(path.join(process.cwd(), "packages/sdk/examples/quickstart.ts"), "utf8").trimEnd();
    expect(EXAMPLES.sdkQuickstart.code).toBe(shipped);
    const sdk = pageCopy(pages.restSdk).blocks;
    expect(sdk.some((b) => b.k === "install" && b.package === "sdk")).toBe(true);
    expect(sdk.filter((b) => b.k === "code").map((b) => (b.k === "code" ? b.example : ""))).toContain("sdkQuickstart");
    expect(pageByPath("rest/sdk")?.visibility).toBe("public");
  });

  it("no English docs copy still says the SDK or the REST API is coming (HEY-187)", () => {
    const docs = JSON.stringify(messages.developers);
    for (const stale of ["Coming soon", "Not public yet", "Join the waitlist", "isn’t available yet", "is on the way", "that’s on the way"])
      expect(docs, stale).not.toContain(stale);
    expect(messages.developers.docs.status.unpublished).toBe(messages.developers.docs.install.unpublishedTitle);
  });
});
