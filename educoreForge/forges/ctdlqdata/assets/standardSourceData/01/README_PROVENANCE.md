# PROVENANCE — forge-ctdlqdata snapshot 01

## What this snapshot is

The CTDL-QData (Credential Transparency Description Language — Quantitative Data) schema, published by Credential Engine as one JSON-LD document.

| File | Bytes | sha256 | Role |
|---|---|---|---|
| `qdata.json` | 116,625 | `7a60c290a2f25db486555c1a614f72b229885da11ecfc285db81c0f827967d69` | The vocabulary. The `@graph` holds 18 `rdfs:Class`, 106 `rdf:Property`, 8 `skos:ConceptScheme` and 113 `skos:Concept` entries. |
| `standardSourceLocation` | 2,007 | `130844d926f5fa84230963e7050c6bc7cd46ff94f40e97dbea21ec2e7ba8729e` | Provenance record. The forge reads `publishedVersion` and `upstreamUrl` from it. |

`SHA256SUMS` lists both files. Every build verifies them before the forge reads a byte.

## Version and source

- **Version:** `20260130`, the `publishedVersion` this record states and the version the root carries (ruling V2). The record also has a line `version: Release 20260130`; the July forge hard-coded that form, and this port does not read it.
- **Upstream:** `https://credreg.com/qdata/schema/encoding/json?includemetaproperties=false`, the `includemetaproperties=false` encoding, which carries no `meta:*` predicate (so the round trip reads back no `meta:domainFor` / `meta:hasConcept` inverse), retrieved 2026-07-15.

## Lineage

Both files were copied **byte for byte** on 2026-10-20 (ctdlHub-101926 P2) from the July attic forge, `codeAttic/cli/parserLib/forge-ctdlqdata/assets/standardSourceData/01/`. That is the snapshot the July oracle `GOLD_EVAL_260718` was built from (plan ruling R1).

## How to re-acquire

A newer release is a NEW snapshot directory (`02/`) with its own `standardSourceLocation` and `SHA256SUMS`. Move `defaultSnapshot` in `parserDescriptor.ini` only deliberately (plan phase P9, version-follow).
