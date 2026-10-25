# OneRoster 1.2 Rostering snapshot 01: provenance

**What it is.** The 1EdTech OneRoster 1.2 Rostering Service OpenAPI 3.0 document (`openapi 3.0.1`, `info.title` "OpenAPI schema for OneRoster
Rostering Service", `info.version 1.2`, `x-status Final`): the data model under `components.schemas` (40 schemas, 158 properties, 32 enums /
88 values, 45 `$ref`s, measured 2026-10-24). One of the three OneRoster 1.2 REST service models, forged as three standards in the
OneRoster family (BRONZE_CROWN ruling R2, 2026-10-24; `zNotesPlansDocs/nextStandards-102326/DESIGN-H0-oneroster-102426.md`).

**Acquisition class.** `published-url`. Fetched 2026-10-24 by MIDNIGHT_JOURNEY (nextStandards-102326 wave 3, lane H) with `curl -sL`
(HTTP 200; Last-Modified 2026-06-16 11:43:02 GMT; 96,554 bytes). The publisher ships this OpenAPI file INSIDE its "skill" package for the service, linked
from `https://standards.1edtech.org/oneroster/specifications/standards/v1p2`; the forge reads the one member extracted from it.

## The bytes

| file | sha256 | bytes |
|---|---|---|
| `orrostering-v1p2.zip` from `https://purl.imsglobal.org/spec/orrostering/v1p2/skill/orrostering-v1p2.zip` | `2e79558ea87b932d5206668dbc2f30efaad721e22de13707c4cfb64be9558856` | 96,554 |
| `orrostering_v1p2_openapi3.json` = the zip member `assets/schema/openapi/orrostering_v1p2_openapi3.json` (dated 2026-06-16) | `5bb284f15c5294bcbaa10551bab7595dbf67c90564eb0ac8d77db46c8259043b` | 268,171 |

## The older generation, recorded and NOT forged (BRONZE_CROWN ruling R1, 2026-10-24)

The same page also links the 2022 binding file `https://purl.imsglobal.org/spec/or/v1p2/schema/openapi/onerosterv1p2rostersservice_openapi3_v1p0.json` (Last-Modified
2022-09-13, `openapi 3.0.0`, no `x-status`, schema names suffixed `DType`, no persistent ids; sha256 `06cafc2234ae1cdc…`, 523,788 bytes; a `.yaml`
twin beside it). It is a different document, not a re-serialisation: 15 of 35 schemas identical (after dropping the DType suffix and the x- keys); its one Metadata became six (MetadataClass, MetadataCourse, MetadataEnrollment, MetadataGeneral, MetadataOrg, MetadataUser); descriptions lose the "Model Primitive Datatype = X." prefix; multi-valued strings become arrays; required lists change (Course requires org, no longer courseCode; Class adds classType). The 2026 document is the publisher's latest, so it is the
one forged. (The rostering page also links the 2026 JSON at its own purl, `…/orrostering/v1p2/schema/openapi/orrostering_v1p2_openapi3.json`,
which answered HTTP 404 on 2026-10-24; the zip is the only carrier found.)

## Files (`SHA256SUMS` lists each)

| file | role |
|---|---|
| `orrostering_v1p2_openapi3.json` | **the forge's source** (`parserDescriptor.ini` `sourceFile`); git-ignored, extracted by the recipe below |
| `orrostering-v1p2.zip` | the publisher's package the source is extracted from; git-ignored, kept so the extraction can be re-checked |
| `standardSourceLocation` | the provenance triple; its `upstreamUrl` (the zip's purl) is the root's `sourceUrl` (a declared additional input) |

## Licence

1EdTech Specification Document License (the document's `info.license` names it "IMS Global Specification Document License",
`https://www.imsglobal.org/license.html`; the package's `SKILL.md` says `license: proprietary`). Forged and bridged like Ed-Fi and Open
Badges; the standard's downloads are WITHHELD (`apps/graph-builder/lib/downloadArtifactsRules.json`, TQ ruling Q-N1 2026-10-23). The
publisher's bytes are never committed (TQ 2026-10-24: "Leave it out of git").

## Acquisition recipe

```
DEST=forges/onerosterrostering/assets/standardSourceData/01
curl -sSL -o $DEST/orrostering-v1p2.zip https://purl.imsglobal.org/spec/orrostering/v1p2/skill/orrostering-v1p2.zip
unzip -p $DEST/orrostering-v1p2.zip assets/schema/openapi/orrostering_v1p2_openapi3.json > $DEST/orrostering_v1p2_openapi3.json
(cd $DEST && shasum -a 256 -c SHA256SUMS)
```
