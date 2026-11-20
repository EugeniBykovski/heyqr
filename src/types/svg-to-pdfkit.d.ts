declare module "svg-to-pdfkit" {
  /** Draws an SVG document onto a PDFKit page as vector (paths, shapes, text with the given fonts, PNG/JPEG images). */
  export default function SVGtoPDF(
    doc: PDFKit.PDFDocument,
    svg: string,
    x?: number,
    y?: number,
    options?: {
      width?: number;
      height?: number;
      preserveAspectRatio?: string;
      assumePt?: boolean;
      fontCallback?: (family: string, bold: boolean, italic: boolean) => string;
    },
  ): void;
}
