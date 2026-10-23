# Validation certificate — Open Badges 3.0 (OpenBadges)

**Open Badges 3.0 was built from 1EdTech's OpenAPI 3.0 document `ob_v3p0_oas.json`. The standard's part of the graph has 358 content nodes.**
**It holds all 32 schemas, all 201 schema properties, and the 9 enumerations with their 115 values. Every `$ref` and every branch of a choice is kept as a reference.**

Accuracy was checked by round trip: the live graph was read back into source statements and compared, one by one, with an independent
reading of the document's `components.schemas`. Nothing was invented and nothing was lost. The rest of the document, its API
(paths, servers, security, tags, info), is deliberately not carried; it is listed below.

| | |
|---|---|
| standard | Open Badges 3.0 (bundle `openbadges`, `_source` `OpenBadges`, family `OpenBadges`) |
| source | `assets/standardSourceData/01/ob_v3p0_oas.json`, checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | `https://purl.imsglobal.org/spec/ob/v3p0/schema/openapi/ob_v3p0_oas.json` |
| version | `3.0` (the document's `info.version`, `x-status Final`; it agrees with `standardSourceLocation`, versionSource `spec`) |
| graph | scratch graphs built 2026-10-23 from `recipes/openbadgesOnlyRoundTrip.recipe.jsonc` and disposed by name |
| build | `--vectorize=false` standardBase block **`8ec9115d5e8c2c89bbc70909b80c1d9176d368e05dfc730b157b01b60bb8a7b0`**; vectorised **`f56cb031a373407e6183b08947392fedca01791e284f3b93b84d39e0ddcd8804`** (measured twice: the first vectorised build embedded 325 texts, the replay `--embeddingCacheOnly=true` 0) |
| spend | $0.0004, embedding only (325 new vectors); judge $0 |
| commit | branch `ns/a-openbadges` (nextStandards-102326 lane A) |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the document | DmeStandardRoot | `OpenBadgesRoot` | 1 |
| a `components.schemas` member | DmeClass | `OpenBadgesSchema` | 32 |
| a property of a schema | DmeProperty | `OpenBadgesProperty` | 201 |
| the enum in a property's shape | DmeOptionSet | `OpenBadgesEnum` | 9 |
| an enum member | DmeOptionValue | `OpenBadgesEnumValue` | 115 |
| a name or description text (search) | DmeEmbedText | `OpenBadgesEmbedText` | 352 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → schema | (every schema) | 32 |
| `HAS_PROPERTY` | schema → property | `properties` | 201 |
| `REFERENCES` | property → schema, with `referenceConstruct` and `locator` | each `$ref`: 22 direct, 24 under `items`, 2 in a `oneOf` branch | 48 |
| `HAS_OPTION_SET` | property → enum | `enum` (direct or in a branch) | 9 |
| `HAS_VALUE` | enum → member | each member | 115 |

- **Text.** Each schema and each property carries its OpenAPI `description` verbatim. 22 properties have none: they are a bare `$ref`,
  and OpenAPI 3.0 allows nothing beside one. Those properties carry `referencedSchemaNames` (e.g. `Achievement.creator`: `Profile`).
- **Types.** `dataType`, `dataFormat`, `valuePattern`, `minItems`, and for arrays `itemsDataType` and friends; `isRequired` from each
  schema's `required` list; `additionalPropertiesAllowed` on each schema.
- **Choices.** Five enumerations are EXTENSIBLE (`achievementType`, `targetType`, `identifierType`, `identityType`, `resultType`): an
  `anyOf` of the enum and a pattern `(ext:)…`. The enum is the option set (`enumLocator` `/anyOf/0/enum`); the pattern branch is in
  the property's `compositionBranches`.
- **Identifiers.** 1EdTech's persistent ids are carried as data: `xClassPid` on schemas, `xSrcpropPid` on properties. The second names
  the property's value type, not the property (see Known issues).

## The counts

The round trip compared every scalar of `components.schemas` at its JSON pointer: **inventedTotal 0, lostTotal 0**, in the graph built
without vectors and in the graph built with them. Declared omissions, 11 in all, one per member: the document's `openapi`, `info`,
`servers`, `tags` and `paths`, and its `components.headers` (1), `components.securitySchemes` (1) and `components.links` (4).
`info.version` is the root's version and `info.description` its description.

## Round Trip Validation

The validator (`roundTripValidator.js`, the OpenAPI kit's pair `lib/openapi-forge/openapiRoundTripPair.js`) reads the snapshot and the
materialised graph separately. The `required` list and enum members are compared as sets: their order means nothing in JSON Schema.
A node property the reader cannot account for counts as invented, so a value added in the graph turns the check red. The derived
`referencedSchemaNames` is checked against the `REFERENCES` edges.

## Known issues

- `xSrcpropPid` looks like a property identifier and is not one: 179 properties share 42 values, 63 of them
  `org.1edtech.ob.v3p0.primitive.string.class`. Do not join on it.
- Ten schemas are API plumbing, not credential data (`OpenApi*`, `Imsx_*`, `ServiceDescriptionDocument`,
  `GetOpenBadgeCredentialsResponse`, `Proof`). They are in the graph and in bridge retrieval.
- Two `@context` item branches are typed `string` but described as a map; four descriptions spell "respresents". Carried as written
  (`README_ERRATA.md`).
- Downloads of this standard are withheld under the 1EdTech licence; the graph itself is unaffected.

## Provenance

Fetched 2026-10-23 from the URL above; byte-identical to the copy held since 2026-05-28. The JSON-LD context
(`context-3.0.3.json`) is stored beside it for reference and is not read.

## For more information

`README_identityRules.md` (identity), `README_ERRATA.md` (upstream observations), `assets/standardSourceData/01/README_PROVENANCE.md`,
and `lib/openapi-forge/` (the kit) with its design `system/management/zNotesPlansDocs/nextStandards-102326/DESIGN-K0-openapiKit-102326.md`.
