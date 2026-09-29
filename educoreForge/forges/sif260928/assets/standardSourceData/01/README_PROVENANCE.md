# PROVENANCE — forge-sif260928 snapshot 01

Written 2026-09-28 in phase A1a of the SIF replacement (builder SCARLET_FLAME, supervisor EBONY_DREAM;
`system/management/zNotesPlansDocs/sifStructuralBridge-091826/`). The full acquisition history of
these bytes is in the incumbent's `forges/sif/assets/standardSourceData/01/README_PROVENANCE.md`,
written by COBALT_DREAM on 2026-08-03. This file keeps what the new bundle relies on and corrects
the one sentence of it that went stale.

## What this snapshot is

This snapshot is a **separate directory** from the incumbent's, and is not a shared one. The
incumbent's parser refuses any extra `.tsv` in its own snapshot, and a later phase adds a second
input to this one (SPEC §9 A8; GROUNDING F-F3). The incumbent's snapshot was not modified.

| file | bytes | sha256 | role |
|---|---|---|---|
| `ImplementationSpecification_031326.tsv` | 3,178,798 | `6814727786bd767a23b3f6eabdf1862d30c126a0e82146cd3e622107174ae706` | the SIF data model: 159 object tables, flattened |

The TSV is a **byte copy** of `forges/sif/assets/standardSourceData/01/ImplementationSpecification_031326.tsv`
(verified with `cmp`, and its sha256 equals the incumbent's `SHA256SUMS` entry). Its byte shape
matters to the loader (SPEC §9 A21): it has CRLF line endings, 163 blank separator lines, and
**no trailing newline**. `wc -l` therefore reports 16,100 lines, while a split gives 16,101.

The incumbent's second input, `refIdResolutionMap.tsv`, is **not** in this snapshot yet. Phase A4
copies it here, declares it in `additionalSourceInputList`, and adds it to `SHA256SUMS`.

## Version: 4.3 (corrected)

The incumbent README says the version stamp "remains honestly `unknown`". **That has been stale
since 2026-08-31**, when tqii supplied the version as 4.3 and `publishedVersion: 4.3` was written
into the incumbent's `standardSourceLocation` (session GRANITE_ECHO). This snapshot carries the
same bare line. The framework's `deriveVersionStamp` reads it, and the stamp resolves to
`publishedVersion 4.3`, `versionSource 'provenance-file'`.

The evidence for 4.3, as measured by COBALT_DREAM on 2026-08-03:
- The TSV's 159 table names are **set-identical (159/159)** to the sheet names of the published
  SIF NA 4.3 spreadsheet (`https://files.a4l.org/Implementation/NA/4.3/ImplementationSpecification.xlsx`,
  sha256 `34ea6339b9ce267b15e5ad44f6240fd253c11b8100d9763250cd54a65234cf9c` as fetched then).
- The working directory this TSV came from also holds a `SIF_Message.xsd` that is
  byte-identical to the published 4.3 primary schema.

The TSV itself declares no version. The version is therefore a human-supplied fact backed by that
evidence; it is not parsed from the source.

**This bundle refuses an unknown version.** The framework only warns when no version can be
found, and stamps `unknown`. The sif260928 forge refuses to build instead, by name
(`lib/sif260928VersionGuard.js`; SPEC §9 A5). If the `publishedVersion` line is deleted, or starts
with `unknown`, no graph is produced.

## Acquisition class

`ImplementationSpecification_031326.tsv` is a **human-artifact-snapshot**. The underlying
artifact is A4L's canonical authoring spreadsheet (ruling R-SF-6: every published SIF artifact,
the XSDs included, is generated from it). The committed bytes, however, are a local flattened TSV
export of that spreadsheet. The export step was not recorded, and A4L does not publish this form,
so the bytes cannot be verified against the publisher.

## Acquisition recipe (a checksum refusal points here)

1. Obtain the SIF NA Implementation Specification spreadsheet from A4L
   (`https://files.a4l.org/Implementation/NA/<version>/ImplementationSpecification.xlsx`).
2. Flatten it to TSV. Each sheet becomes one `<TableName>: Table N` line, then the column header
   `Name / Mandatory / Characteristics / Type / Description / XPath / CEDS ID / Format`, then the
   sheet's rows. Keep the sheets in workbook order and the rows in sheet order, because row order
   is document order.
3. Put it in a NEW snapshot directory beside this one; nothing changes until `defaultSnapshot` in
   `parserDescriptor.ini` is deliberately flipped. Write `standardSourceLocation` with a bare
   `publishedVersion:` line.
4. Regenerate the checksums with `shasum -a 256 ImplementationSpecification_<MMDDYY>.tsv > SHA256SUMS`,
   and update this README.

`SHA256SUMS` lists the source data only. `standardSourceLocation` and this README are not
listed, following the incumbent's convention. Listing `standardSourceLocation` would also make a
deleted version line fail the checksum before the version guard could fire.
