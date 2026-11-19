import { CAPTION_FONTS, CAPTION_FONT_IDS } from "@heyqr/qr-core";

/** URL of a caption font file (public/caption-fonts, the files the export uses too). */
export const captionFontUrl = (file: string) => `/caption-fonts/${file}`;

/**
 * HEY-44: @font-face rules for every caption font face, generated from the one mapping (qr-core caption-fonts.ts),
 * so previews use exactly the files the PNG rasterizer and exported SVGs use. Files download only when a caption uses
 * them. font-display: block hides caption text while its face loads instead of drawing a stand-in font.
 */
export function CaptionFontFaces() {
  const css = CAPTION_FONT_IDS.flatMap((id) =>
    Object.entries(CAPTION_FONTS[id].faces).map(
      ([weight, file]) =>
        `@font-face{font-family:'${CAPTION_FONTS[id].family}';font-weight:${weight};font-style:normal;font-display:block;src:url(${captionFontUrl(file)}) format('truetype')}`,
    ),
  ).join("\n");
  return <style data-caption-fonts dangerouslySetInnerHTML={{ __html: css }} />;
}
