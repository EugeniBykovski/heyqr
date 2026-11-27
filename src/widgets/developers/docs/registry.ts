/*
 * Design 12.1–12.22 "API for developers": every docs page, in reading order (sidebar, search, Previous / Next).
 * The words live in messages/en.json under developers.docs.pages.<id>; code examples in ./examples.ts.
 *
 * Release gates (verified, not assumed):
 * - Packages: PACKAGE_RELEASE. @simplex-packages/heyqr-sdk 0.1.0 is on npm (`latest`, HEY-172/HEY-173); @heyqr/qr-core
 *   isn't published (npm answers 404; its manifest is `private`).
 * - REST API: REST_RELEASE. The v1 routes exist in this build, but no public deployment of them is verified, so the
 *   public site keeps design 12.18 "Coming soon" with the waitlist. Its reference pages render only where previews
 *   are allowed (not production) and never appear in search.
 */
export type DocsGroup = "start" | "guides" | "ref" | "help" | "rest";
export type DocsEnv = "both" | "browser" | "node";
/**
 * - public: always shown and searchable;
 * - restPreview: a REST page documenting what this build implements, shown only while previews are allowed;
 * - designPreview: a planned capability with the design's proposed values, shown only while previews are allowed.
 */
export type DocsVisibility = "public" | "restPreview" | "designPreview";

export type DocsPage = {
  id: string;
  /** Path below /developers ("" for the overview). */
  path: string;
  group: DocsGroup;
  /** Section anchors of the page, in order (the "On this page" list and search headings). */
  anchors: readonly string[];
  /** A page-level runtime chip, e.g. 12.9 "Node.js only". */
  env?: DocsEnv;
  visibility: DocsVisibility;
};

export const DOCS_GROUPS: readonly DocsGroup[] = ["start", "guides", "ref", "help", "rest"];

export const DOCS_PAGES: readonly DocsPage[] = [
  { id: "overview", path: "", group: "start", anchors: ["what", "entries", "next"], visibility: "public" },
  { id: "install", path: "install", group: "start", anchors: ["add", "reqs", "wasm"], visibility: "public" },
  { id: "quickstart", path: "quick-start", group: "start", anchors: ["browser", "node"], visibility: "public" },
  { id: "content", path: "content", group: "guides", anchors: ["types", "examples", "contact", "events", "urls"], visibility: "public" },
  { id: "style", path: "style", group: "guides", anchors: ["shapes", "colors", "center", "art"], visibility: "public" },
  { id: "logo", path: "logo", group: "guides", anchors: ["fields", "example", "fit"], visibility: "public" },
  { id: "layouts", path: "layouts", group: "guides", anchors: ["presets", "compose", "fonts"], visibility: "public" },
  { id: "png", path: "png", group: "guides", env: "node", anchors: ["basic", "options", "print"], visibility: "public" },
  { id: "scan", path: "scan", group: "guides", anchors: ["report", "node", "browser"], visibility: "public" },
  { id: "api", path: "api", group: "ref", anchors: ["content", "render", "layout", "encode", "color", "node"], visibility: "public" },
  { id: "types", path: "types", group: "ref", anchors: ["style", "report", "content"], visibility: "public" },
  { id: "limits", path: "limits", group: "ref", anchors: ["limits", "capacity", "null"], visibility: "public" },
  { id: "faq", path: "faq", group: "help", anchors: [], visibility: "public" },
  { id: "changelog", path: "changelog", group: "help", anchors: ["v010"], visibility: "public" },
  { id: "rest", path: "rest", group: "rest", anchors: [], visibility: "public" },
  { id: "restAuth", path: "rest/authentication", group: "rest", anchors: ["keys", "header", "limits"], visibility: "restPreview" },
  { id: "restCreate", path: "rest/create", group: "rest", anchors: ["body", "request", "responses"], visibility: "restPreview" },
  { id: "restBulk", path: "rest/bulk", group: "rest", anchors: ["body", "responses"], visibility: "designPreview" },
  {
    id: "restDestination",
    path: "rest/destination",
    group: "rest",
    anchors: ["read", "body", "request", "responses"],
    visibility: "restPreview",
  },
  { id: "restScans", path: "rest/scans", group: "rest", anchors: ["responses"], visibility: "designPreview" },
  { id: "restErrors", path: "rest/errors", group: "rest", anchors: ["shape", "errors", "limits"], visibility: "restPreview" },
  { id: "restSdk", path: "rest/sdk", group: "rest", anchors: ["install", "server", "methods", "errors"], visibility: "restPreview" },
];

/** Whether a page may be shown here. Previews only where previews are allowed; never in production. */
export const isVisible = (page: DocsPage, previews: boolean) => page.visibility === "public" || previews;

/** The pages of the sidebar and Previous / Next, in order. */
export const visiblePages = (previews: boolean) => DOCS_PAGES.filter((p) => isVisible(p, previews));

/** Pages search may return: public ones only, in every environment (release-gated pages are never searchable). */
export const searchablePages = () => DOCS_PAGES.filter((p) => p.visibility === "public");

export const pageByPath = (path: string) => DOCS_PAGES.find((p) => p.path === path);

export const docsHref = (page: DocsPage) => (page.path ? `/developers/${page.path}` : "/developers");

/** Previous and next visible pages. */
export function neighbours(page: DocsPage, previews: boolean) {
  const list = visiblePages(previews);
  const i = list.findIndex((p) => p.id === page.id);
  return { previous: i > 0 ? list[i - 1] : undefined, next: i >= 0 && i < list.length - 1 ? list[i + 1] : undefined };
}

/**
 * The anchors of the single-page /developers (HEY-160, design 12.1 before this pass) and where they live now, so old
 * links keep landing on the right section.
 */
export const LEGACY_ANCHORS: Record<string, string> = {
  "dv-pkg": "/developers",
  "dv-install": "/developers/install",
  "dv-svg": "/developers/quick-start#browser",
  "dv-png": "/developers/png",
  "dv-opts": "/developers/style",
  "dv-scan": "/developers/scan",
  "dv-rest": "/developers/rest",
  "dv-rest-auth": "/developers/rest",
  "dv-rest-endpoints": "/developers/rest",
  "dv-rest-sdk": "/developers/rest",
  "dv-rest-errors": "/developers/rest",
  "dv-rest-revisions": "/developers/rest",
  "dv-rest-idempotency": "/developers/rest",
  "dv-rest-export": "/developers/rest",
};
