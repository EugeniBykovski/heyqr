/**
 * HEY-193: the Terms of Service and Privacy Policy as structured English source, kept out of messages/*.json so they are
 * never machine-translated. Every statement describes what the product does today (see docs/legal/REVIEW.md for the
 * evidence and the open items). `[[…]]` marks a fact the owner or counsel still has to supply: it renders as a visible
 * placeholder, never as text that reads like a decision.
 */
export type LegalBlock = string | { list: readonly string[] };

export type LegalSection = { id: string; title: string; blocks: readonly LegalBlock[] };

export type LegalDocument = {
  id: "terms" | "privacy";
  title: string;
  /** The date this draft was last changed (ISO). The effective date is set when it is approved. */
  updated: string;
  intro: string;
  sections: readonly LegalSection[];
};

/** Splits text into plain runs and `[[placeholder]]` runs, in order. */
export function placeholders(text: string): { text: string; placeholder: boolean }[] {
  return text
    .split(/(\[\[[^\]]+\]\])/g)
    .filter(Boolean)
    .map((part) => (part.startsWith("[[") ? { text: part.slice(2, -2), placeholder: true } : { text: part, placeholder: false }));
}
