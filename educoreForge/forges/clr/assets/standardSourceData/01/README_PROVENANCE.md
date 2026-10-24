# CLR 2.0 snapshot 01: provenance

**What it is.** The 1EdTech Comprehensive Learner Record 2.0 OpenAPI 3.0 document (`openapi 3.0.1`, `info.title` "OpenAPI schema for
Comprehensive Learner Record Standard", `info.version 2.0`, `x-status Final`): the data model under `components.schemas`, published at the
URL below.

**Acquisition class.** `published-url`. Fetched 2026-10-24 by QUIET_GATE (nextStandards-102326 wave 2, lane D) with `curl -sSL` (HTTP 200,
no redirect).

## The bytes, compared with the copy held since 2026-05-28

| copy | sha256 | bytes |
|---|---|---|
| fetched 2026-10-24 from `https://purl.imsglobal.org/spec/clr/v2p0/schema/openapi/clr_v2p0_oas.json` | `fc6d7ea0ee1baa39707a149f9f47ff9f62952d327d433ec507a017aeba8f994d` | 109,746 |
| held: `git show 88336881:educoreForge/forges/clr/assets/standardSourceData/01/clr_v2p0_oas.json` (copied 2026-05-28 from A4L/unityObjectGenerator; its `upstreamUrl` was recorded as "unknown") | `fc6d7ea0ee1baa39707a149f9f47ff9f62952d327d433ec507a017aeba8f994d` | 109,746 |

The two are identical: the held copy was the publisher's current document, and the purl the census inferred is now verified. The forge reads
these bytes.

## Files (`SHA256SUMS` lists each)

| file | role |
|---|---|
| `clr_v2p0_oas.json` | **the forge's source** (`parserDescriptor.ini` `sourceFile`); git-ignored, fetched by the recipe below |
| `standardSourceLocation` | the provenance triple; its `upstreamUrl` is the root's `sourceUrl` (a declared additional input) |

## Licence

1EdTech Specification Document License (the document's `info.license` names it "IMS Global Specification Document License",
`https://www.imsglobal.org/license.html`). Forged and bridged like
Ed-Fi; the standard's downloads are WITHHELD (`apps/graph-builder/lib/downloadArtifactsRules.json`, TQ ruling Q-N1 2026-10-23). The
publisher's bytes are never committed (TQ 2026-10-24: "Leave it out of git").

## Acquisition recipe

```
DEST=forges/clr/assets/standardSourceData/01
curl -sSL -o $DEST/clr_v2p0_oas.json https://purl.imsglobal.org/spec/clr/v2p0/schema/openapi/clr_v2p0_oas.json
(cd $DEST && shasum -a 256 -c SHA256SUMS)
```
