# PROVENANCE — xlsx-reader test fixture `CEDS-V13.0.0.0.xlsx`

A TEST FIXTURE of `lib/xlsx-reader`, not a source anything forges. It was the snapshot of CEDS's Version 13 layer, which
lane UNDES (campaign cedsRichness-101226, 2026-10-13) removed; it stays here because it is the one real workbook in the tree
that carries formula cells (`=HYPERLINK(...)` in every URL cell), CR line endings inside shared strings and text cells with
leading zeros, the three faults `test/test-xlsxReader.js` twins. The V14 workbook gate D reads has no formula cell.

| file | bytes | sha256 | from |
|---|---|---|---|
| `CEDS-V13.0.0.0.xlsx` | 950,412 | f1ac3e066955f02578c4621e655904e6d63cc3841c4d217f4b594c6239bbdbd5 | https://github.com/CEDStandards/CEDS-Elements, commit 6186c00a7de58d197ab3cdd0606a95f1d3a796e7, path `CEDS-V13.0.0.0.xlsx` (deleted at HEAD dd4f0c2) |

**Licence: Apache-2.0** (CEDS-Elements LICENSE, verbatim beside this file as `LICENSE`).

The oracle `../cedsV13.openpyxl.jsonl.gz` is openpyxl 3.1.5's reading of this file, written by `../openpyxlDump.py`.
