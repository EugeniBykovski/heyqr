# CMYK print export (HEY-188)

The Print Pack's print PDF can be made for a press: every colour is converted from sRGB to the selected ICC output
profile and that profile is embedded as the PDF's output intent. The editable SVG and the specifications sheet stay
sRGB; the sheet names the profile and lists each colour's CMYK values.

## Profiles

| Profile (Print Preview) | ICC file                                                | Status                                                  |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| sRGB · no conversion    | none                                                    | always available, unchanged (byte-identical to HEY-187) |
| Coated FOGRA39          | `Coated_Fogra39L_VIGC_300.icc`, bundled in `assets/icc` | available                                               |
| GRACoL 2013             | `GRACoL2013_CRPC6.icc`, bundled in `assets/icc`         | available                                               |
| Uncoated FOGRA29        | none bundled; provisioned per deployment (below)        | disabled until a licensed file is provisioned           |

| File                           | ICC header               | Description tag                | Copyright tag                                                             | MD5                                | SHA-256                                                            |
| ------------------------------ | ------------------------ | ------------------------------ | ------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `Coated_Fogra39L_VIGC_300.icc` | v2.1, `prtr`, CMYK → Lab | `Coated_Fogra39L_VIGC_300.icc` | `Copyright X-Rite, Inc.`                                                  | `5449c505618a9b6c38634b4708ae9e37` | `6df43849a84d2632e7900a125f657bd09364ed56775bc4740c1e39a5492d47e3` |
| `GRACoL2013_CRPC6.icc`         | v4.2, `prtr`, CMYK → Lab | `GRACoL2013_CRPC6.icc`         | `Copyright X-Rite, Inc. This profile is made available by IDEAlliance, …` | `1255e7936f615edf3c79e02ca76a995a` | `4ebbfad6bc9cfc033fdafdd8ac5df8159208932cb16d9a6596d349ae7ab50443` |

Both were downloaded from the ICC Profile Registry, the publishers' distribution channel
(`https://www.color.org/registry/profiles/<file>`), on 2026-11-27. The server refuses a bundled file whose SHA-256
differs (a changed or damaged file) with 503 `profile_unavailable`.

### Licences

- **Coated FOGRA39**, `Coated_Fogra39L_VIGC_300.icc`, provider VIGC
  ([registry page](https://www.color.org/registry/Coated_Fogra39L_VIGC_300.xalter)): "This profile is made available by
  VIGC, with permission of X-rite, and may be used, embedded, exchanged, and shared without restriction. It may not be
  altered or sold without written permission of VIGC". Production use: yes. Redistribution in the repository: yes
  ("shared without restriction"), unaltered and not sold. This is a FOGRA39 (ISO 12647-2:2004/Amd 1, coated) profile
  with a 300 % total ink limit; ECI's ISO Coated v2 for the same data has no published licence (below).
- **GRACoL 2013**, `GRACoL2013_CRPC6.icc`, provider Idealliance
  ([registry page](https://www.color.org/registry/GRACoL2013_CRPC6.xalter)): "This profile is made available by
  IDEAlliance, with permission of X-Rite, Inc., and may be used, embedded, exchanged, and shared without restriction. It
  may not be altered, or sold without written permission of IDEAlliance." The file's copyright tag adds "included in
  commercial software". Production use: yes. Redistribution in the repository: yes, unaltered and not sold.
- **Uncoated FOGRA29: not shipped.** No official FOGRA29 profile states terms that clearly allow this use:
  - ECI's `ISOuncoated.icc` (ECI_Offset_2004 archive from eci.org, description "ISO Uncoated", SHA-256
    `f4361ea9aed10f111fb30a5525991986d8acbedd8a830a803198bc9edebc906f`) carries "Printopen 4.0.5.2 - Copyright (c)
    2000-2002 Heidelberger Druckmaschinen AG, All Rights Reserved." Neither the ECI download pages nor the archive's
    documents state any licence. (ECI's terms for its later profiles differ by profile: SC_paper_eci "may be used,
    embedded, exchanged, and shared without restriction", PSOcoated_v3 "may be used, embedded and exchanged without
    restriction. It may not be distributed, sold or altered".) FOGRA29 is not in the ICC Profile Registry.
  - Adobe's "Uncoated FOGRA29 (ISO 12647-2:2004)" comes in the Adobe ICC Profiles download behind a click-through
    agreement. Its end-user licence allows "to use, reproduce and publicly display the Software" and "to distribute the
    Software only (a) as embedded within digital image files and (b) on a standalone basis". A PDF generated for a
    customer is not named. Accepting the agreement is the owner's decision.

  To enable FOGRA29, the owner confirms a licence that covers embedding the profile in PDFs generated for customers
  (ECI or Adobe in writing, or Adobe's agreement read that way), then provisions the file as below.

## Colour engine

[lcms-wasm](https://github.com/mattdesl/lcms-wasm) 1.0.5 (published 2025-01-08, MIT; Little CMS 2, MIT), pinned
exactly. It is WebAssembly, so it runs in the same Node.js functions as the rest of the export on Vercel. It is an
external server package that loads `lcms.wasm` next to itself; the print routes trace that file and `assets/icc/*.icc`
(`next.config.ts`). The engine and each profile's transforms are created once per function instance (about 20–40 ms);
a failure isn't cached, so the next request tries again.

- Vector colours (QR modules, finder patterns, frame, background and bleed, library icons, caption text, inlined SVG
  logos, gradients, crop marks): **relative colorimetric with black point compensation**, 16-bit. An in-gamut colour
  prints as itself on that paper; sRGB black maps to the press's darkest black within the profile's ink limit.
  Without BPC the conversion agrees with macOS ColorSync, an independent CMM, to within 0.5 points on the reference
  colours. BPC moves dark colours by design: #1F4D3A is 71/16/61/67 with BPC and 78/12/68/70 without.
- Raster images (uploaded PNG, JPEG or WebP logos, the brand-card logo, artwork): **perceptual**, the profile's own
  gamut mapping for pictures. They are converted at their own pixel size, never resampled, so the low-resolution
  warning still applies. Transparency stays a soft mask (`/SMask`, DeviceGray), which PDF/X-4 allows, so semi-
  transparent pixels aren't flattened onto a guessed background.
- An uploaded SVG logo with a `<mask>` becomes a CMYK image (svg-to-pdfkit computes masks from RGB). Other
  self-contained SVG logos stay vector.

## The PDF

- Every colour of paths, text and gradients is DeviceCMYK, and images are DeviceCMYK. No DeviceRGB remains.
- `/OutputIntents [<< /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier (FOGRA39 | CGATS21-2-CRPC6 |
FOGRA29) /OutputCondition (…) /RegistryName (http://www.color.org) /Info (…) /DestOutputProfile <ICC stream, /N 4> >>]`.
  The stream is the ICC file byte for byte.
- MediaBox, TrimBox and BleedBox are as for sRGB. PDF 1.7.
- **PDF/X-4 is not claimed.** No preflight tool (for example Acrobat Preflight or callas pdfToolbox) is installed in
  development or CI, so the file has no `GTS_PDFXVersion` and the specifications sheet keeps "PDF 1.7 · vector (PDF/X-4
  after preflight)".
- File name: `<code>-<layout>-print-<w>x<h>mm-<profile>.pdf`. The sRGB name is unchanged.
- Stored files (`/api/print/files`, HEY-102) are keyed by the settings, profile included, by `icc` (the ICC file's
  SHA-256) and by format version `files: 4`.

## Errors

| Case                                                                                  | Answer                                                           |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A profile the deployment doesn't offer (FOGRA29 not provisioned, or an unknown name)  | 422 `unsupported_profile`                                        |
| An offered profile fails now (missing or changed file, storage error, engine failure) | 503 `profile_unavailable`, reported to monitoring as `print.icc` |

Neither falls back to sRGB. Print Preview shows its error state with Try again, and the settings are kept.

## Provisioning

FOGRA39 and GRACoL 2013 need nothing beyond the deployment itself: the files are in the repository and traced into
`/api/print/files/[layoutId]` and `/api/print/preview`.

Uncoated FOGRA29, only after its licence is confirmed:

1. Upload the licensed file unaltered to the environment's private bucket (`S3_BUCKET`, the same private R2 bucket
   as logos), for example under `icc/UncoatedFOGRA29.icc`. Don't commit it.
2. Compute its SHA-256 (`shasum -a 256 UncoatedFOGRA29.icc`).
3. Set the server variables in that Vercel environment:
   - `PRINT_ICC_FOGRA29_KEY=icc/UncoatedFOGRA29.icc`
   - `PRINT_ICC_FOGRA29_SHA256=<64 hex digits>`
4. Redeploy. FOGRA29 is offered once both are set. A missing object, or bytes that don't match, answer 503.
5. Verify one downloaded FOGRA29 PDF as below before announcing it.

## Verifying a downloaded file

```sh
python3 scripts/qa/inspect-print-pdf.py file.pdf assets/icc/Coated_Fogra39L_VIGC_300.icc
pdftoppm -png -r 300 -singlefile file.pdf page && pnpm exec tsx scripts/qa/decode-file.ts page.png
```

The script lists the colour spaces used and checks that no DeviceRGB is left. It also checks the output intent and
that its DestOutputProfile matches the ICC file byte for byte (`prtr`, CMYK), prints the page boxes in mm, and lists
each image's colour space and pixel size.
