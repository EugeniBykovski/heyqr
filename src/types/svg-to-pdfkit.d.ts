declare module "svg-to-pdfkit" {
  /** A parsed SVG colour: RGB channels 0–255 (or, returned by colorCallback, CMYK percentages 0–100) and its opacity. */
  export type SvgColor = [number[], number];
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
      /** HEY-188: every colour as it is parsed (fills, strokes, gradient stops, text); undefined for none. */
      colorCallback?: (color: SvgColor | undefined, raw: string) => SvgColor | undefined;
    },
  ): void;
}
