# Validation certificate — PESC_LD (PESC College Transcript in JSON-LD)

**PESC_LD v0.0.2 was built from the ten CSVs of its application profile (the TAP). The graph has 1,084 nodes and 1,257 edges.**
**It holds the 39 shapes, the 266 profile rows and the 45 picklists the package publishes, with every borrowed term carried as written.**

Accuracy was checked two ways:

- **Against the source.** The live graph was read back into source statements and compared, one by one, with an independent reading
  of the CSVs. Nothing was invented and nothing was lost. Four kinds of statement are deliberately not carried; they are listed below.
- **Against the publisher's own SHACL file.** The package's merged TTL was translated into the same statements and compared with
  the graph. Every difference falls under one of 11 declared departure kinds, each at its measured count, and there are no others.

| | |
|---|---|
| standard | PESC College Transcript in JSON-LD (PESC_LD) (bundle `pescld`, `_source` `PESCLD`, family `PESCLD`) |
| source | `assets/standardSourceData/01/`: `shapes.csv`, seven TAP files, `namespaces.csv`, `about.csv`, checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | the TAP spreadsheet `about.csv` names (`https://docs.google.com/spreadsheets/d/18HzS4phUl7olmUEjh0deA3vgVPdque4_iGzK7_zTWLE/`) |
| version | `0.0.2` (the package's name; the files inside say v0.0.1; see Provenance) |
| graph | scratch graphs `DEV_gb_materialize_36874_2` and `DEV_gb_materialize_38072_2`, built 2026-10-22 and disposed by name |
| build | recipe `recipes/pescldOnlyRoundTrip.recipe.jsonc`. Since the DME-text fix (2026-10-23, the usage note carried as `description`): `--vectorize=false` standardBase block **`27f3709b7d66ddd98c1bd80e766a7d9004f899827a923d235fffcbc0e0f046a2`** (measured twice at `8bc9aee8`, round trip clean). SUPERSEDED by that fix: vectorised `2838e683…c5a6e9` (manifest `a45b062a…5ef26c`) and `--vectorize=false` `171ab377…263973` (C1, reproduced four times on two heads before the fix); the vectorised id after the fix is not yet measured |
| certification | `graphBuilder -goldEvalCheck`: **PASS** (1 declared validator, inventedTotal 0; conservation 1 of 1 member; no bridge, no judged edge) |
| spend | $0.0014, embedding only (792 new vectors); judge $0 |
| commit | branch `zb/c-pescLd` (zeroBacklog lane C1) |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the package | DmeStandardRoot | `PescLdRoot` | 1 |
| a `shapes.csv` record (a SHACL node shape) | DmeClass | `PescLdShape` | 39 |
| a (shape, property) row of the TAP | DmeProperty | `PescLdProperty` | 266 |
| a non-empty picklist cell | DmeOptionSet | `PescLdPicklist` | 45 |
| a value in that picklist | DmeOptionValue | `PescLdPicklistValue` | 482 (334 distinct values) |
| a label or note text (search) | DmeEmbedText | `PescLdEmbedText` | 251 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → shape | (every shape) | 39 |
| `HAS_PROPERTY` | shape → row | the row's `shapeID` | 266 |
| `REFERENCES` | row → shape, `locator: valueShape` | `valueShape` | 72 |
| `HAS_OPTION_SET` | row → picklist | `valueConstraintType picklist` | 45 |
| `HAS_VALUE` | picklist → value | each line of the cell | 482 |

- **Borrowed terms.** Most rows use a term another vocabulary owns. Each shape, row and CURIE picklist value carries it as
  `termCurie` (exactly as written) and `termIri` (expanded from the package's own `namespaces.csv`). Nothing is resolved here; the
  declared-identity bridges do that.
- **Ranges.** A `valueClass` is kept as written in `crossRefs`, as `{ raw, locator: 'valueClass' }` (93 references).
- **Identity.** Ids are PESC-owned (`pescld:shape/<shapeID>`, `pescld:shape/<shapeID>/<propertyID>`, `pescld:picklist/…`); a
  borrowed IRI is never an id (`README_identityRules.md`).

## The counts

The round trip compared every source statement it models with the graph: **inventedTotal 0, lostTotal 0**. The usage note's second
carriage, as `description`, is its own statement (`dmeTextFromNote`), so a description invented, changed or dropped turns it red. Declared omissions,
222 in all: the spreadsheet row-number column (167), the `namespaces.csv` table (47; applied as every `termIri`), the `about.csv`
metadata (6; its url is the root's `sourceUrl`), and the raw text of 2 whitespace-trimmed cells.

The source states some things twice or not at all; each is carried under a declared rule and counted:
- 4 records appear in two TAP files: one node each, both files in `sourceTabs`.
- `PersonShape pesc:hasSummary` is `mandatory FALSE` in one file and `TRUE` in another: TRUE (the publisher's own merge), both
  values in `sourceValueConflicts`.
- 3 picklists repeat a value: one node with `listRepeatCount 2`.
- 3 empty picklists and 1 empty `maxLength`: `valueConstraintDeclaredEmpty: true`.

## Round Trip Validation

- **The round trip** (`roundTripValidator.js`, `lib/pescldRoundTripPair.js`) reads the CSVs on one side and the materialised graph on
  the other, and compares cell by cell. Ten perturbations of the graph (a dropped edge, a dropped reference, a flipped flag, a lost
  file name, an invented note, …) each turn it red (`test/test-pescldForge.js`).
- **The second oracle** (`lib/pescldTtlOracle.js`, `lib/pescldTtlDepartureTable.json`) compares the graph with the publisher's TTL.
  The TTL adds language tags, its own derived shape IRIs and `sh:closed false`; the CSVs carry Rec Usage, the TAP file names, both
  conflicting values, the declared emptinesses and the repeats. Those are the departures, and they are all.

## Known issues

- **One term is not in the vocabulary it names.** Row `P001075` (`hasStudentIdentificationSystem`, PersonIdentificationShape) and
  its four values cite terms the named vocabulary's current release does not define. They are in the graph as written; a bridge
  will report them unresolved.
- **The package's version is ambiguous.** It is called v0.0.2; its files say v0.0.1; `about.csv` has a date and no version.
- **No definitions.** The package publishes labels and usage notes only. The DME reads one text field, `description`, so a row's
  usage note is carried there too, verbatim (48 rows); the root's `descriptionSource` says it is a usage note, not a definition.
  Shapes and rows without a note carry no `description`.
- **Picklist names are borrowed from their row.** A picklist has no name of its own in the source; it takes its row's label.

These and the other source observations are in `README_ERRATA.md`.

## Provenance

The package was received as a directory (`JSON-LD College Transcript_v0.0.2`, author Phil Barker, dated 2026-06-25). The forge reads
the CSVs extracted from its zip; the TTL is kept only as the second oracle, and the combined JSON is not read (it lacks the `note`
column and disagrees with the TTL on `hasSummary`). Whether a newer version exists is open with the publisher (plan Q-Z7).

## For more information

`README_identityRules.md` (ids), `README_ERRATA.md` (source observations),
`system/management/zNotesPlansDocs/zeroBacklog-102226/DEVLOG-C.md` (the build's record), `GATEREPORT-C1-102226.md`.
