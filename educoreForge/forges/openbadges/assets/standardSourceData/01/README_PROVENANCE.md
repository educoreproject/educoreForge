# Open Badges 3.0 snapshot 01: provenance

**What it is.** The 1EdTech Open Badges 3.0 OpenAPI 3.0 document (`openapi 3.0.1`, `info.version 3.0`, `x-status Final`): the
data model under `components.schemas`, published at the URL below.

**Acquisition class.** `published-url`. Fetched 2026-10-23 by AZURE_MARBLE (nextStandards-102326 lane A) with `curl -sSL`.

## The bytes, compared with the copy held since 2026-05-28

| copy | sha256 | bytes |
|---|---|---|
| fetched 2026-10-23 from `https://purl.imsglobal.org/spec/ob/v3p0/schema/openapi/ob_v3p0_oas.json` | `816f431e9e8ad7f20f80551f9e3ba3143b059318a46c6edb0d357538fd063ba9` | 104,546 |
| held: `git show 88336881:educoreForge/forges/openbadges/assets/standardSourceData/01/ob_v3p0_oas.json` (retrieved 2026-05-28) | `816f431e9e8ad7f20f80551f9e3ba3143b059318a46c6edb0d357538fd063ba9` | 104,546 |

`cmp` reports the two identical: the publisher has not changed the document since May. The forge reads these bytes.

## Files (`SHA256SUMS` lists each)

| file | role |
|---|---|
| `ob_v3p0_oas.json` | **the forge's source** (`parserDescriptor.ini` `sourceFile`) |
| `standardSourceLocation` | the provenance triple; its `upstreamUrl` is the root's `sourceUrl` (a declared additional input) |
| `context-3.0.3.json` | the JSON-LD context, `https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json` (14,565 bytes, fetched 2026-10-23): **reference only, the forge never reads it** (workorder A1) |

## Licence

1EdTech Specification Document License (the document's `info.license`, `https://www.imsglobal.org/license.html`). Forged and
bridged like Ed-Fi; the standard's downloads are WITHHELD (`apps/graph-builder/lib/downloadArtifactsRules.json`, TQ ruling Q-N1
2026-10-23).

## Acquisition recipe

```
DEST=forges/openbadges/assets/standardSourceData/01
curl -sSL -o $DEST/ob_v3p0_oas.json https://purl.imsglobal.org/spec/ob/v3p0/schema/openapi/ob_v3p0_oas.json
curl -sSL -o $DEST/context-3.0.3.json https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json
(cd $DEST && shasum -a 256 ob_v3p0_oas.json context-3.0.3.json standardSourceLocation > SHA256SUMS)
```
