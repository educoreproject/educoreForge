# EduAPI 1.0 snapshot 02: provenance

**What it is.** The 1EdTech Edu-API 1.0 OpenAPI 3.0 document (`openapi 3.0.1`, `info.version 1.0`, `x-status Final`): the data model
under `components.schemas`, published at the URL below. **The forge's pin** (`parserDescriptor.ini` `defaultSnapshot=02`).

**Acquisition class.** `published-url`. Fetched 2026-10-24 by OCEAN_SPIRE (nextStandards wave 2, lane F) with `curl -sSL`: HTTP 200,
`Last-Modified: Mon, 31 Aug 2026 11:54:34 GMT`, `ETag: "620ea-65a56773ef453"`.

## The bytes, compared with the copy held since 2026-05-28

| copy | sha256 | bytes | x-status |
|---|---|---|---|
| fetched 2026-10-24 from `https://purl.imsglobal.org/spec/eduapi/v1p0/schema/openapi/eduapi_v1p0_openapi3.json` | `cf7f2f32d721df48798a5dfe9d8bf261a53e0edc8464a9de5f916ac508cfb5ed` | 401,642 | Final |
| held: snapshot 01 (`git show 88336881:educoreForge/forges/eduapi/assets/standardSourceData/01/eduapi_v1p0_openapi3.json`, retrieved 2026-05-28) | `bed37938b1126c7cea8bb0a114f7840d80b4449071aabd42baee6cd99c1fcd94` | 381,592 | Candidate Final |

The publisher changed the document after May (it was promoted to Final). What changed, element by element:
`system/management/zNotesPlansDocs/nextStandards-102326/CHANGES-eduapi-01to02-102426.md`.

## Files (`SHA256SUMS` lists each)

| file | role | in git |
|---|---|---|
| `eduapi_v1p0_openapi3.json` | **the forge's source** (`parserDescriptor.ini` `sourceFile`) | **no** (publisher bytes, TQ 2026-10-24: "Leave it out of git"; fetch with the recipe below) |
| `standardSourceLocation` | the provenance triple; its `upstreamUrl` is the root's `sourceUrl` (a declared additional input) | yes |
| `SHA256SUMS`, this file | how to check the bytes | yes |

## Licence

1EdTech (IMS Global) Specification Document License (the document's `info.license`, `https://www.imsglobal.org/license.html`). Forged and
bridged like Ed-Fi and Open Badges; the standard's downloads are WITHHELD (`apps/graph-builder/lib/downloadArtifactsRules.json`, TQ ruling
Q-N1 2026-10-23).

## Acquisition recipe

```
DEST=forges/eduapi/assets/standardSourceData/02
curl -sSL -o $DEST/eduapi_v1p0_openapi3.json https://purl.imsglobal.org/spec/eduapi/v1p0/schema/openapi/eduapi_v1p0_openapi3.json
(cd $DEST && shasum -a 256 -c SHA256SUMS)
```

If the check fails the publisher has changed the document again: that is a new snapshot (03), never an edit of this one.
