# PROVENANCE — forge-ctdl snapshot 02

## What this snapshot is

The CTDL (Credential Transparency Description Language) schema, published by Credential Engine as one JSON-LD document, at the release credreg.net stated as current on 2026-10-21.

| File | Bytes | sha256 | Role |
|---|---|---|---|
| `ctdl-schema.json` | 1,164,036 | `bf5dd4b5c975c898fc0d67f173a91c340b263fbd4f928c6eff17e0ea298158b9` | The vocabulary. The `@graph` holds 140 `rdfs:Class`, 435 `rdf:Property`, 36 `skos:ConceptScheme` and 457 `skos:Concept` entries (1,068; snapshot 01 held 1,013). |
| `standardSourceLocation` | 1,116 | `58ebe476750224ba32b5e45e8d8556570f8a776173d45a9b3edc6c1f6da9d5ac` | Provenance record. The forge reads `publishedVersion` and `upstreamUrl` from it. |

`SHA256SUMS` lists both files. Every build verifies them before the forge reads a byte.

## Version and source

- **Version:** `Release 20260927`, as STATED by Credential Engine: `https://credreg.net/ctdl/terms`, read 2026-10-21, says "Release 20260927", "This is the September 2026 CTDL release" and "Release ID: 20260927 Release Date: 09/27/2026 Release Status: vs:stable". The JSON-LD does not state its own version, so the root records `versionSource: provenance-file`.
  - An earlier note (sourceReleaseCheck-102126/README.txt) called this file the "August 2026 CTDL release (28/08/2026)", from the term pages. The release timeline (`credreg.net/page/schemareleasetimeline`, read the same day) lists 28/08/2026 (+6 CTDL terms) AND 09/27/2026 (+30), and the entry count fits 20260927 exactly: 1,068 entries + 33 = the timeline's 1,101 CTDL terms, the same +33 offset snapshot 01 shows against its release (1,013 + 33 = 1,046 at 03/27/2026). That fit is a code estimation; the label itself is the page's statement.
- **Upstream:** `https://credreg.net/ctdl/schema/encoding/json`, retrieved 2026-10-21.

## How it was retrieved

credreg.net answers curl with a Cloudflare challenge. The bytes are `document.body.innerText` of the JSON response, read through a real Chrome (channel `chrome`) driven by Playwright, by `dataStores/ctdlHub_101926/p10Runs/sourceAcquisition-102126/fetchCredregList.js` (INDIGO_CASCADE, ctdlHub-101926 P10). The same folder keeps the terms page and the release timeline as text.

SCARLET_ARROW fetched the same URL earlier the same day (`dataStores/ctdlHub_101926/sourceReleaseCheck-102126/ctdl-schema-202608.json`, sha256 `57242df9…`). That file differs from this one only by a trailing newline its decoding added; parsed, the two are identical (`jq -S` digests equal). This snapshot keeps the bytes without the added newline, as snapshot 01 (fetched with curl) has none.

## Lineage

Snapshot 01 (Release 20260327) stays on disk unchanged; the July oracle was built from it. `defaultSnapshot` in `parserDescriptor.ini` was moved 01 → 02 deliberately in P10. What changed between the two is in `system/management/zNotesPlansDocs/ctdlHub-101926/CHANGES-ctdlFamily-01to02-102126.md`.

Known source defects in this release, carried and never repaired: 140 references to the undefined `ceterms:WorkbasedLearningCertificate` (the defined class is `ceterms:WorkBasedLearningCertificate`); 2,258 repeated members in `schema:domainIncludes`/`schema:rangeIncludes` lists.

## How to re-acquire

1. Fetch the JSON encoding from `https://credreg.net/ctdl/schema/encoding/json` through a browser (Cloudflare). Read the release label from `https://credreg.net/ctdl/terms`, never infer it.
2. A different release is a NEW snapshot directory (`03/`) with its own `standardSourceLocation`, `SHA256SUMS` and this README. It is never an edit to this one.
3. Move `defaultSnapshot` only deliberately, in a version-follow phase.
