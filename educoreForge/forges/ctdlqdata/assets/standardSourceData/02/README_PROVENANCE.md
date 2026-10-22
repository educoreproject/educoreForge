# PROVENANCE — forge-ctdlqdata snapshot 02

## What this snapshot is

The CTDL-QData (Quantitative Data) schema, published by Credential Engine as one JSON-LD document, at the release credreg.net stated as current on 2026-10-21, in the `includemetaproperties=false` encoding snapshot 01 uses.

| File | Bytes | sha256 | Role |
|---|---|---|---|
| `qdata.json` | 167,205 | `185dd4341efd61e203167d8038230f312abd005d36609d14ed3d5903e03c1cd0` | The vocabulary. The `@graph` holds 18 `rdfs:Class`, 125 `rdf:Property`, 8 `skos:ConceptScheme` and 113 `skos:Concept` entries (264; snapshot 01 held 245). |
| `standardSourceLocation` | 1,377 | `0fe3d70f9a3fd9b9b4e8d4c367df94397f4a72500d4861c8764112ecf57566a4` | Provenance record. The forge reads `publishedVersion` and `upstreamUrl` from it. |

`SHA256SUMS` lists both files. Every build verifies them before the forge reads a byte.

## Version and source

- **Version:** `20260626`, as STATED by Credential Engine: `https://credreg.net/qdata/terms`, read 2026-10-21, says "Release 20260626", "This is the June 2026 QData release" and "Release ID: 20260626 Release Date: 06/26/2026 Release Status: vs:stable".
- **Upstream:** `https://credreg.net/qdata/schema/encoding/json?includemetaproperties=false`, retrieved 2026-10-21. Snapshot 01 came from the same path on credreg.com; credreg.com was not re-tried.
- **The encoding is deliberate.** The full encoding (no query string; SCARLET_ARROW's `sourceReleaseCheck-102126/qdata-schema-20260626.json`) adds `meta:changeHistory`, `meta:domainFor`, `meta:hasConcept` and `meta:targetScheme`. Measured: the two encodings hold the same 264 `@id`s. Using the stripped one keeps the forge's input shape what snapshot 01's was, so the version-follow does not also switch the encoding.
- **What the 19 new entries are:** all foreign (13 `ceterms:`, 6 `ceasn:`), terms QData re-describes; carried verbatim on the root (allowance A5). No native QData term was added, removed or changed.

## How it was retrieved

credreg.net answers curl with a Cloudflare challenge. The bytes are `document.body.innerText` of the JSON response, read through a real Chrome driven by Playwright, by `dataStores/ctdlHub_101926/p10Runs/sourceAcquisition-102126/fetchCredregList.js` (INDIGO_CASCADE, ctdlHub-101926 P10).

## Lineage

Snapshot 01 (20260130) stays on disk unchanged; the July oracle was built from it. `defaultSnapshot` was moved 01 → 02 deliberately in P10. Changes: `system/management/zNotesPlansDocs/ctdlHub-101926/CHANGES-ctdlFamily-01to02-102126.md`.

## How to re-acquire

A newer release is a NEW snapshot directory (`03/`) with its own `standardSourceLocation`, `SHA256SUMS` and this README. Read the release label from the credreg terms page, never infer it. Move `defaultSnapshot` only deliberately.
