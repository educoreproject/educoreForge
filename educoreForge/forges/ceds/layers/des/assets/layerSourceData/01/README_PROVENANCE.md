# PROVENANCE — CEDS layer `des` snapshot 01 (the Domain Entity Schema, Version 13)

Acquired 2026-10-12 by lane INV (CRIMSON_THREAD) and pinned here by lane DES (RADIANT_HORIZON), campaign cedsRichness-101226.
Harvest record: `educoreForge/system/dataStores/sourceData/cedsPublications-101226/ACQUISITION-cedsPublications-101226.md`.

| file | bytes | sha256 | from |
|---|---|---|---|
| `CEDS-V13.0.0.0.xlsx` | 950,412 | f1ac3e066955f02578c4621e655904e6d63cc3841c4d217f4b594c6239bbdbd5 | https://github.com/CEDStandards/CEDS-Elements, commit **6186c00a7de58d197ab3cdd0606a95f1d3a796e7** ("Correct V13.0.0.0 Elements File", 2025-08-14), path `CEDS-V13.0.0.0.xlsx` |

- **The file is no longer at the repository's HEAD** (deleted at dd4f0c2, 2026-03-05). Re-acquire it with
  `git -C CEDS-Elements show 6186c00:CEDS-V13.0.0.0.xlsx > CEDS-V13.0.0.0.xlsx` and check the sha256.
- **Byte-identical** to https://ceds.ed.gov/data/xls/CEDS-V13.xlsx (fetched 2026-10-12), which states no licence; this snapshot
  is sourced from GitHub for that reason.
- **Licence: Apache-2.0** (CEDS-Elements LICENSE, copied verbatim beside this file as `LICENSE`). Apache-2.0 permits
  redistribution in a public repository with the licence carried alongside.
- **Version 13** is what CEDS calls this publication; no Version 14 DES exists (no V14 download on ceds.ed.gov, no DES column
  in the V14 workbook, no DES edit-history entry tagged 14). Every node this layer mints is stamped `desVersion '13'`
  (TQ ruling 1, 2026-10-12); the descriptor's `layerVersion=13` is cross-checked against `layerSourceLocation`.
- `SHA256SUMS` lists the one source file; the layer framework verifies it before a byte is read.
