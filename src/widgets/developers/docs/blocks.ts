import type { ExampleId, TabbedId } from "./examples";

/*
 * The block model of a docs page (design 12.x). The words come from messages/en.json
 * (developers.docs.pages.<id>.blocks); `example` / tabs ids point at ./examples.ts. Text may hold `code spans`.
 */
export type TableRow = { cells: string[]; required?: boolean };
export type Block =
  | { k: "p"; t: string }
  | { k: "h2"; id: string; t: string }
  | { k: "h3"; t: string }
  | { k: "note"; kind: "info" | "warn" | "preview" | "design"; t: string }
  | { k: "list"; items: string[] }
  | { k: "steps"; items: { title: string; t: string }[] }
  | { k: "code"; example: ExampleId }
  | { k: "tabs"; example: TabbedId; label: string }
  | { k: "table"; label: string; cols: string[]; rows: TableRow[]; keyCol?: boolean; reqCol?: boolean }
  | { k: "chips"; t: string; items: string[] }
  | { k: "cards"; items: { page: string; title: string; t: string; icon: string }[] }
  | { k: "faq"; items: { q: string; a: string }[] }
  | { k: "endpoint"; method: string; url: string }
  | { k: "install"; package: "qrCore" | "sdk" }
  | { k: "products" }
  | { k: "restSoon" };

export type PageCopy = { title: string; nav?: string; lead: string; blocks: Block[] };

const KINDS = new Set([
  "p",
  "h2",
  "h3",
  "note",
  "list",
  "steps",
  "code",
  "tabs",
  "table",
  "chips",
  "cards",
  "faq",
  "endpoint",
  "install",
  "products",
  "restSoon",
]);

/** The page's copy from the messages, checked for shape (a malformed message fails loudly in tests and dev). */
export function pageCopy(raw: unknown): PageCopy {
  const c = raw as Partial<PageCopy> | null;
  if (!c || typeof c.title !== "string" || typeof c.lead !== "string" || !Array.isArray(c.blocks))
    throw new Error("docs page copy is missing title, lead or blocks");
  for (const b of c.blocks)
    if (!b || typeof b !== "object" || !KINDS.has((b as { k?: string }).k ?? ""))
      throw new Error(`unknown docs block ${JSON.stringify(b)}`);
  return c as PageCopy;
}

/** Plain text of a block's words (search and the "On this page" labels). Code spans lose their backticks. */
export const plain = (text: string) => text.replace(/`([^`]+)`/g, "$1");
