import { describe, expect, it } from "vitest";
import { privacy } from "./en/privacy";
import { terms } from "./en/terms";
import { placeholders } from "./types";

/* HEY-193: the draft legal texts: anchorable sections, and unconfirmed facts always marked as placeholders. */
describe("legal texts (HEY-193)", () => {
  it("splits [[placeholders]] from plain text", () => {
    expect(placeholders("Write to [[support email]] today.")).toEqual([
      { text: "Write to ", placeholder: false },
      { text: "support email", placeholder: true },
      { text: " today.", placeholder: false },
    ]);
  });

  for (const doc of [terms, privacy])
    it(`${doc.id}: unique section anchors, an effective date, and open facts left as placeholders`, () => {
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/);
      expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // HEY-188: both documents take effect on the confirmed date.
      expect(doc.effective).toBe("2026-11-27");
      const text = JSON.stringify(doc);
      // Who runs HeyQR and how to reach it are not known yet: they must stay visible placeholders.
      expect(text).toMatch(/\[\[legal name and registered address/);
      expect(text).not.toMatch(/@heyqr\.me|support@/);
      // Unbalanced markers would print raw brackets.
      expect((text.match(/\[\[/g) ?? []).length).toBe((text.match(/\]\]/g) ?? []).length);
    });
});
