// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

/*
 * HEY-180 (WCAG 2.4.7): a tab panel draws no focus ring (outline-none), so it must not be a Tab stop. Radix makes
 * panels focusable by default; every panel in the app opts out, and Tab goes from the tabs to the panel's controls.
 */
describe("tab panels are no invisible Tab stops (HEY-180)", () => {
  it("the shared TabsContent is not focusable by Tab", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">
          <button type="button">Inside</button>
        </TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole("tabpanel")).toHaveAttribute("tabindex", "-1");
  });

  it("every Radix Tabs.Content in the app sets tabIndex={-1}", () => {
    // jsdom gives import.meta.url an http scheme; tests run from the repository root.
    const src = path.join(process.cwd(), "src");
    const missing = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .flatMap((f) =>
        [...readFileSync(`${src}/${f}`, "utf8").matchAll(/<TabsPrimitive\.Content\b([^>]*)>/g)]
          .filter((m) => !/tabIndex=\{-1\}/.test(m[1] ?? ""))
          .map(() => f),
      );
    expect(missing).toEqual([]);
  });
});
