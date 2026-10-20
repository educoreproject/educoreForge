# PROVENANCE — forge-ctdlasn snapshot 01

## What this snapshot is

The CTDL-ASN (Credential Transparency Description Language — Achievement Standards Network) schema, published by Credential Engine as one JSON-LD document.

| File | Bytes | sha256 | Role |
|---|---|---|---|
| `ctdlasn.json` | 86,764 | `8bacfcec140c03e144903acd04eeacc3f466c2245ca2a1bb703a322981fda0b7` | The vocabulary. The `@graph` holds 11 `rdfs:Class`, 101 `rdf:Property`, 2 `skos:ConceptScheme` and 8 `skos:Concept` entries. |
| `standardSourceLocation` | 1,248 | `275482b404b9ec5692711b09f16e25029727a565be496dd6b9906c92ac11acb6` | Provenance record. The forge reads `publishedVersion` and `upstreamUrl` from it. |

`SHA256SUMS` lists both files. Every build verifies them before the forge reads a byte.

## Version and source

- **Version:** `20230929`, the `publishedVersion` this record states and the version the root carries (ruling V2). The record also has a line `version: Release 20230929`; the July forge hard-coded that form, and this port does not read it.
- **Upstream:** `https://credreg.net/ctdlasn/schema/encoding/json`, the PLAIN encoding (not metaproperties-stripped), retrieved 2026-07-15.

## Lineage

Both files were copied **byte for byte** on 2026-10-20 (ctdlHub-101926 P2) from the July attic forge, `codeAttic/cli/parserLib/forge-ctdlasn/assets/standardSourceData/01/`. That is the snapshot the July oracle `GOLD_EVAL_260718` was built from (plan ruling R1).

## How to re-acquire

A newer release is a NEW snapshot directory (`02/`) with its own `standardSourceLocation` and `SHA256SUMS`. Move `defaultSnapshot` in `parserDescriptor.ini` only deliberately (plan phase P9, version-follow).
