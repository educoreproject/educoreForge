# PROVENANCE — forge-sif snapshot 01

Written by the forge-sif round-trip retrofit campaign, Phase 0 (builder COBALT_DREAM,
2026-08-03), per the Round-Trip Forge Contract (RT-9/RT-11;
`DOCTRINE-roundTripForgeContract-080326.md`). Supervisor: AMBER_TOWER.

## What this snapshot is

The SIF (Schools Interoperability Framework) North America data model, held as TWO source
inputs (both committed; no gitignore involvement):

| file | bytes | sha256 (see SHA256SUMS) | role |
|---|---|---|---|
| `ImplementationSpecification_031326.tsv` | 3,178,798 | `6814727786bd767a…` | the data model: 159 object tables, flattened |
| `refIdResolutionMap.tsv` | 4,042 | (see SHA256SUMS) | curated RefId→target-table resolution map (38 rows) |

The TSV is a flattened export of the **SIF Data Model Implementation Specification (NA) 4.3**
authoring spreadsheet: 159 `<TableName>: Table N` sections, each with the literal column header
`Name / Mandatory / Characteristics / Type / Description / XPath / CEDS ID / Format`.

## Canonical-source ruling — R-SF-6 (TQ, 2026-08-03, firsthand testimony)

**The spreadsheet is SIF's canonical source.** TQ, by text at commissioning (relayed by
supervisor AMBER_TOWER, recorded as R-SF-6): the A4L specification editor (John Lovell,
personally known to TQ) authors the specification spreadsheet and feeds it into a generator
tool he wrote; **all published SIF artifacts — the XSDs included — are generated from it.**
The spreadsheet is therefore SIF's analogue of Ed-Fi's MetaEd: upstream of every generated
artifact. Provenance of this claim: TQ testimony on firsthand knowledge of the publisher's
workflow — not independently verified against A4L tooling, and per R-SF-6 it does not need to
be; it is ruled.

## Version evidence (measured 2026-08-03)

- The TSV's 159 table names are **set-identical (159/159)** to the sheet names of the
  published SIF NA 4.3 spreadsheet (`https://files.a4l.org/Implementation/NA/4.3/ImplementationSpecification.xlsx`,
  sha256 `34ea6339b9ce267b15e5ad44f6240fd253c11b8100d9763250cd54a65234cf9c` as fetched
  2026-08-03).
- The sibling working directory this TSV came from (see Lineage) also holds a `SIF_Message.xsd`
  that is **byte-identical** to the published 4.3 PRIMARY schema
  (`XSD/Schema_NoIncludes_Strict/SIF_Message.xsd`, sha256
  `a6d9f4ae0c04b4c18c195062699970b9aa8bdd0070dfd4ce6196e84b31d20411`).
- Filename date-code `031326` reads as an export date of 2026-03-13 (inference from TQ's
  filename convention, labeled as such). The TSV does not self-describe a version, so the
  forge's version stamp remains honestly `unknown` (`standardSourceLocation`,
  `versionSource: unknown`).
- Conclusion carried by the evidence: this snapshot's content is the **SIF NA 4.3** data model
  (release 2022-10-27; the current latest per `https://data.a4l.org/sif-specifications-north-america/`).

## Acquisition class (RT-9, per input)

- `ImplementationSpecification_031326.tsv` — **human-artifact-snapshot.** The UNDERLYING
  artifact is the publisher's canonical authoring spreadsheet (machine-canonical CHARACTER per
  R-SF-6), but the committed bytes are a LOCAL flattened TSV export of it; A4L does not publish
  this TSV form, the export step (application, operator, exact source file) was not recorded at
  the time, and byte-level verification against the publisher is therefore not possible. The
  round trip proves the forge lossless against THIS snapshot; fidelity to the publisher's
  intent rides on the version evidence above. No invented provenance.
- `refIdResolutionMap.tsv` — **human-artifact-snapshot.** A locally curated crosswalk
  (columns `refIdProperty / inferredTarget / resolvedTable / resolutionMethod / notes`, method
  `sif_knowledge`) resolving RefId reference properties to their target tables where the TSV's
  own naming is insufficient. Authored in-house; not a publisher artifact.

## Lineage of the committed bytes

`standardSourceLocation` (2026-05-28) records `copiedFrom:
…/educoreForge/system/dataStores/sourceData/forge-sif-tsv`; that staging directory no longer
exists. Byte-identical copies of the TSV (same sha256) exist at, and the likely origin export
is the first of:

- `…/webdev/A4L/unityObjectGenerator/system/code/assets/databaseDefinitionss/A4L/ImplementationSpecification 2.tsv`
  (the A4L client-work project; sits beside `ImplementationSpecification.xlsx` and the
  4.3-primary-identical `SIF_Message.xsd`)
- `…/webdev/educore/system/code/cli/lib.d/index-data-model-explorer-for-milo/assets/ImplementationSpecification_031326.tsv`
- `~/tq_usr_bin/qbookSuperTool/system/code/cli/lib.d/sif-spec-graph/assets/ImplementationSpecification_031326.tsv`

## Acquisition recipe (RT-3 refusals point here)

There is no public URL for the TSV form — the canonical acquisition path is:

1. Obtain the current SIF NA Implementation Specification spreadsheet from A4L
   (published, non-normative export: `https://files.a4l.org/Implementation/NA/<version>/ImplementationSpecification.xlsx`;
   canonical authoring copy: the A4L specification editor's spreadsheet, per R-SF-6).
2. Export/flatten to TSV: one `<TableName>: Table N` header per sheet, followed by that
   sheet's rows (column set as above), tables in workbook sheet order, rows in sheet row order
   — **row order is load-bearing** (R-SF-1: element sequence is semantic for SIF; the forge
   reads row order as document order).
3. Name it `ImplementationSpecification_<MMDDYY>.tsv`, place it in a NEW snapshot directory
   beside a curated `refIdResolutionMap.tsv` (RT-12: new version = new snapshot directory;
   nothing changes until `defaultSnapshot` in `parserDescriptor.ini` is deliberately flipped).
4. Regenerate SHA256SUMS (`shasum -a 256 *.tsv > SHA256SUMS`) and update this README.

## Published generated artifacts (cross-check corpus, NOT in this snapshot)

The published 4.3 artifacts generated from the canonical spreadsheet (R-SF-6) were located and
checksummed 2026-08-03 (all under `https://files.a4l.org/Implementation/NA/4.3/`;
also mirrored at `http://specification.sifassociation.org/Implementation/NA/4.3/`).
They are NOT committed here (supervisor fence: scratch acquisition until TQ rules on their
disposition); they are a candidate independent answer key for round-trip/order work, since the
XSDs carry the `xs:sequence`/`xs:choice` compositor information the flattened TSV does not:

| artifact | sha256 (fetched 2026-08-03) |
|---|---|
| `XSD/Schema_NoIncludes_Strict.zip` (PRIMARY) | `8df678903a61e12810594bd196d7ba014dbf9e14a41c93a97994e6177dea13cb` |
| `XSD/Schema_NoIncludes_Lax.zip` | `51c67dc4e1c86fb9ab320a4c270f220045c285f1b163b5e3b061f88daab5bc06` |
| `XSD/Schema_Strict.zip` | `5ebd7b3ae06e0b9310cd38b164abb89b7c7cc993ce01c5175d1b8e055a394e3c` |
| `XSD/Schema_Lax.zip` | `e04b8c44117da66bb3f98b52088dfc60d3491739fb213f8154ace4592ade0ae3` |
| `XSD/Schema_Annotated_Strict.zip` | `513e9efc21479a2489167ff631583a2c9b2e1ad0723b04c267b08bcaf332b39b` |
| `XSD/Schema_Annotated_Lax.zip` | `5c4644b675d482c67e6b824e9c4a87baa09419b1469b9d9b76e0e039d216740d` |
| `XSD/Schema_NoIncludes_Annotated_Strict.zip` | `e97c56acb55b365005ed03633f2e2d45bbe0cdc65fb63941f7c7a2312a77ddb6` |
| `XSD/Schema_NoIncludes_Annotated_Lax.zip` | `0bd82c0ec7ce23b2e462fc7040d6691b1837291991fe1932199192335511f3b1` |
| `ImplementationSpecification.xlsx` | `34ea6339b9ce267b15e5ad44f6240fd253c11b8100d9763250cd54a65234cf9c` |

## License posture (observed, not adjudicated)

The 4.3 specification document carries "Copyright © 2022 SIF® Association (dba Access 4
Learning® Community). All Rights Reserved." Earlier A4L specification pages (e.g. NA 2.8)
state the SIF Implementation Specifications are available under CC BY-SA 4.0. Both
observations recorded; no license claim invented for 4.3. The committed TSV bytes predate this
campaign and are retained as found; nothing here is license-gated per current practice
(RT-11: no gitignore scoping in use for this bundle).

## Element order (R-SF-1 note)

TSV row order is the ONLY order signal this snapshot carries: there is **no compositor column**
(`xs:sequence` vs `xs:choice` is not representable in this format), so the forge stamps
`orderSemantics: 'document'` — never 'normative' — via the shared sequence-contract module,
which structurally refuses an unverifiable 'normative' claim. Order-normativity lives only in
the generated XSDs (cross-check corpus above).
