import { describe, expect, it } from "vitest";
import { fileNameFrom, preparedFileName } from "./file-name";

/* HEY-197: Downloaded names the file the browser saves: the server's name, never a guess from the code's name. */
describe("prepared file names", () => {
  it("private storage answers { name }; without it the file's own Content-Disposition names it", async () => {
    expect(await preparedFileName(Response.json({ ready: true, name: "menu-card-print-57.4x71.2mm.pdf" }), "x.pdf")).toBe(
      "menu-card-print-57.4x71.2mm.pdf",
    );
    const file = new Response("%PDF", {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="menu.pdf"; filename*=UTF-8''%D0%BC%D0%B5%D0%BD%D1%8E.pdf`,
      },
    });
    expect(await preparedFileName(file, "x.pdf")).toBe("меню.pdf");
    expect(await preparedFileName(Response.json({ ready: true }), "qr-code.png")).toBe("qr-code.png");
    expect(fileNameFrom(null, "qr-code.svg")).toBe("qr-code.svg");
  });
});
