# ICC output profiles (HEY-188)

The CMYK profiles the Print Pack converts to and embeds as the PDF's output intent. Both files are byte-for-byte the
files published in the ICC Profile Registry (downloaded 2026-11-27) and must not be modified: the server checks their
SHA-256 before use. See [docs/PRINT_CMYK.md](../../docs/PRINT_CMYK.md).

| File                           | Print Preview name | ICC header                    | SHA-256                                                            | Source                                                         |
| ------------------------------ | ------------------ | ----------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `Coated_Fogra39L_VIGC_300.icc` | Coated FOGRA39     | v2.1, `prtr`, `CMYK` → `Lab ` | `6df43849a84d2632e7900a125f657bd09364ed56775bc4740c1e39a5492d47e3` | https://www.color.org/registry/Coated_Fogra39L_VIGC_300.xalter |
| `GRACoL2013_CRPC6.icc`         | GRACoL 2013        | v4.2, `prtr`, `CMYK` → `Lab ` | `4ebbfad6bc9cfc033fdafdd8ac5df8159208932cb16d9a6596d349ae7ab50443` | https://www.color.org/registry/GRACoL2013_CRPC6.xalter         |

Licence, as stated on each registry page:

- `Coated_Fogra39L_VIGC_300.icc` (provider VIGC, copyright X-Rite, Inc.): "This profile is made available by VIGC, with
  permission of X-rite, and may be used, embedded, exchanged, and shared without restriction. It may not be altered or
  sold without written permission of VIGC".
- `GRACoL2013_CRPC6.icc` (provider Idealliance, copyright X-Rite, Inc.): "This profile is made available by IDEAlliance,
  with permission of X-Rite, Inc., and may be used, embedded, exchanged, and shared without restriction. It may not be
  altered, or sold without written permission of IDEAlliance." The file's own copyright tag says the same and adds
  "included in commercial software".

Uncoated FOGRA29 has no file here: no publisher states terms that allow it (docs/PRINT_CMYK.md).
