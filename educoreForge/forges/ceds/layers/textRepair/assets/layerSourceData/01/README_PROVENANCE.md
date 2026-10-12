# PROVENANCE — CEDS layer `textRepair` snapshot 01 (CEDS IDS v14.0.0.0 DDL and reference data)

Pinned by lane DES (RADIANT_HORIZON), campaign cedsRichness-101226, 2026-10-12, for TQ ruling 3 (the U+FFFD source exception).

| file | bytes | sha256 | from |
|---|---|---|---|
| `CEDS-IDS.sql` | 11,529,514 | 808a1730d2e8a66bf408609f1274d3ae650ec6f9cff6840def1e8a5d788d71a2 | https://github.com/CEDStandards/CEDS-IDS, tag **v14.0.0.0** = 9919c9faec77a81a79ae7d4eba7a9c4987f53e8f, `src/ddl/CEDS-IDS.sql` |
| `Populate-CEDS-Ref-Tables.sql` | 9,194,147 | 83cf526b183fe73b2b6a517d6477e9b77f6dd98fe3a95abdd3ba7d6413b64789 | the same tag, `src/reference-data/Populate-CEDS-Ref-Tables.sql` |

- Written out of the tag with `git show v14.0.0.0:<path>`; the sha256 equal lane INV's harvest of HEAD (HEAD differs from the
  tag only by one added change-log xlsx).
- **Licence: Apache-2.0** (CEDS-IDS LICENSE, copied verbatim beside this file; the populate script also carries the Apache
  header itself).
- **Encodings differ** (a trap): the DDL is UTF-8; the populate script is Windows-1252 and decodes with zero replacement
  characters. Read as UTF-8 it would itself manufacture the damage it is here to repair.
- **The script's statement forms** (measured): 16,830 `INSERT ... VALUES (...)`, 471 `INSERT ... SELECT ... FROM <ref table>`
  (foreign-key reference tables), each guarded by `IF NOT EXISTS`, with `@updateExisting = 0` declared, so a repeated guard
  inserts nothing (10 such, e.g. RefAllergyType '420140004'); and 30 unconditional PART 2 `UPDATE`s that rewrite earlier rows.
  `lib/idsSource.js` reads the table as the script leaves it.
- The IDS is also the planned source of a future `ids` layer (DESIGN-DES §7); this snapshot is its first slice of evidence.
