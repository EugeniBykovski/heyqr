# Caption fonts

These fonts are used for QR captions only (HEY-44). The HeyQR interface uses DM Sans through `next/font`.

The editor preview, the PNG rasterizer and exported SVGs use these exact files. The mapping from saved font IDs to
files is `packages/qr-core/src/caption-fonts.ts`. All fonts are licensed under the SIL Open Font License 1.1; the
license for each family is the `OFL-*.txt` file next to it.

| Font ID (design)                | Shipped family   | Files                                      | Source                                              | Changes                                                          |
| ------------------------------- | ---------------- | ------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------- |
| `dm` (DM Sans)                  | HeyQR Onest      | `HeyQROnest-{Regular,Medium,Bold}.ttf`     | google/fonts `ofl/onest/Onest[wght].ttf`            | Static 400/500/700 instances, renamed, subset (see below)        |
| `fraunces` (Fraunces)           | HeyQR Literata   | `HeyQRLiterata-{Regular,Medium,Bold}.ttf`  | google/fonts `ofl/literata/Literata[opsz,wght].ttf` | Static 400/500/700 at optical size 24, renamed, subset           |
| `grotesk` (Space Grotesk)       | HeyQR Golos Text | `HeyQRGolosText-{Regular,Medium,Bold}.ttf` | google/fonts `ofl/golostext/GolosText[wght].ttf`    | Static 400/500/700, renamed, subset                              |
| `instrument` (Instrument Serif) | Prata            | `Prata-Regular.ttf`                        | google/fonts `ofl/prata/Prata-Regular.ttf`          | None (unmodified)                                                |
| `caveat` (Caveat)               | HeyQR Caveat     | `HeyQRCaveat-{Regular,Medium,Bold}.ttf`    | google/fonts `ofl/caveat/Caveat[wght].ttf`          | Static 400/500/700, renamed, subset                              |
| `mono` (IBM Plex Mono)          | IBM Plex Mono    | `IBMPlexMono-{Regular,Medium,Bold}.ttf`    | google/fonts `ofl/ibmplexmono/`                     | None (unmodified; Reserved Font Name "Plex")                     |
| older layouts without a font ID | DM Sans          | `DMSans-{Regular,Bold}.ttf`                | google/fonts `ofl/dmsans/DMSans[opsz,wght].ttf`     | Static 400/700 at optical size 14, renamed to "DM Sans" (HEY-43) |

## Why some design fonts were substituted

DM Sans, Fraunces, Space Grotesk and Instrument Serif have no Cyrillic in their official files. Each was replaced
with the closest OFL family that has Cyrillic (including Ё Й І ї ў Є Ґ), combining marks, and no Reserved Font Name.
Fonts with a Reserved Font Name were avoided, because a modified copy may not keep that name:

- Lora and Playfair Display have one.
- IBM Plex Mono ("Plex") has one too, but its official static files are shipped unmodified.

Manrope was also rejected: it has no combining marks.

## Why static instances

resvg, the PNG rasterizer, ignores variable-font axes and always draws a variable font's default instance. So every
weight ships as its own static file.

## Subsetting

The modified fonts keep these ranges, with all OpenType layout features:

- Latin, Latin Extended (including Vietnamese)
- Cyrillic and Cyrillic Extended
- Combining diacritical marks
- General punctuation, currency, letterlike symbols and arrows

## Using these fonts

Renamed families ("HeyQR …") keep the original copyright and the OFL. Under the OFL they may be bundled, embedded
and redistributed with software and documents.
