# PROVENANCE — forge-ctdl snapshot 01

## What this snapshot is

The CTDL (Credential Transparency Description Language) schema, published by Credential Engine as one JSON-LD document.

| File | Bytes | sha256 | Role |
|---|---|---|---|
| `ctdl-schema.json` | 1,004,037 | `037152225d97838481b327a31ded0c6fc20eda003c68e2dd417a01cec949eb42` | The vocabulary. The `@graph` holds 138 `rdfs:Class`, 396 `rdf:Property`, 34 `skos:ConceptScheme` and 445 `skos:Concept` entries. |
| `standardSourceLocation` | 877 | `024b60d47c93a6578f3e9d327084679b55deca9f2831acd85c125d34a091d154` | Provenance record. The forge reads `publishedVersion` and `upstreamUrl` from it. |

`SHA256SUMS` lists both files. Every build verifies them before the forge reads a byte.

## Version and source

- **Version:** `Release 20260327`, as stated in `standardSourceLocation`. The JSON-LD does not state its own version, so the root records `versionSource: provenance-file`.
- **Upstream:** `https://credreg.net/ctdl/schema/encoding/json`, retrieved 2026-06-23.

## Lineage

Both files were copied **byte for byte** on 2026-10-20 (ctdlHub-101926 P1) from the July attic forge, `codeAttic/cli/parserLib/forge-ctdl/assets/standardSourceData/01/`. That is the snapshot the July oracle `GOLD_EVAL_260718` was built from (plan ruling R1). The sha256 values above match the attic copies.

## How to re-acquire

1. Fetch the JSON encoding from `https://credreg.net/ctdl/schema/encoding/json`. The site is behind a Cloudflare challenge, so a browser fetch may be needed.
2. A different release is a NEW snapshot directory (`02/`) with its own `standardSourceLocation` and `SHA256SUMS`. It is never an edit to this one.
3. Move `defaultSnapshot` in `parserDescriptor.ini` only deliberately (plan phase P9, version-follow).

The current release at the time of writing is 20260626.
