# PROVENANCE — forge-ctdlasn snapshot 02

## What this snapshot is

The CTDL-ASN (Credential Transparency Description Language — Achievement Standards Network) schema, published by Credential Engine as one JSON-LD document, at the release credreg.net stated as current on 2026-10-21.

| File | Bytes | sha256 | Role |
|---|---|---|---|
| `ctdlasn.json` | 175,986 | `2cdfee336e4842be92f228b97759719142f597be28afcf71b9de8310f852f3c0` | The vocabulary. The `@graph` holds 11 `rdfs:Class`, 137 `rdf:Property`, 2 `skos:ConceptScheme` and 8 `skos:Concept` entries (158; snapshot 01 held 122). |
| `standardSourceLocation` | 1,166 | `a3f8cafaf43fc3b1383b6f183716809e1623493e169605b433a0b92b10a423b7` | Provenance record. The forge reads `publishedVersion` and `upstreamUrl` from it. |

`SHA256SUMS` lists both files. Every build verifies them before the forge reads a byte.

## Version and source

- **Version:** `20260626`, the `publishedVersion` this record states, as STATED by Credential Engine: `https://credreg.net/ctdlasn/terms`, read 2026-10-21, says "Release 20260626", "This is the June 2026 CTDL-ASN release" and "Release ID: 20260626 Release Date: 26/06/2026 Release Status: vs:stable". The release timeline agrees: CTDL-ASN changed at 05/29/2026 (+2) and 06/26/2026 (+36), and holds 158 terms, this file's entry count.
- **Upstream:** `https://credreg.net/ctdlasn/schema/encoding/json`, the PLAIN encoding (as snapshot 01), retrieved 2026-10-21.
- **What the 36 new entries are:** all foreign: 30 `ceterms:`, 4 `schema:`, `meta:hasConcept`, `meta:supersededBy` (terms ASN re-describes; carried verbatim on the root, allowance A5). No native ASN term was added or removed.

## How it was retrieved

credreg.net answers curl with a Cloudflare challenge. The bytes are `document.body.innerText` of the JSON response, read through a real Chrome driven by Playwright, by `dataStores/ctdlHub_101926/p10Runs/sourceAcquisition-102126/fetchCredreg.js` (INDIGO_CASCADE, ctdlHub-101926 P10). The terms page text is kept beside it.

## Lineage

Snapshot 01 (20230929) stays on disk unchanged; the July oracle was built from it. `defaultSnapshot` was moved 01 → 02 deliberately in P10. Changes: `system/management/zNotesPlansDocs/ctdlHub-101926/CHANGES-ctdlFamily-01to02-102126.md`.

## How to re-acquire

A newer release is a NEW snapshot directory (`03/`) with its own `standardSourceLocation`, `SHA256SUMS` and this README. Read the release label from the credreg terms page, never infer it. Move `defaultSnapshot` only deliberately.
