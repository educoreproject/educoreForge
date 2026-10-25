# Validation certificate — EduAPI 1.0 (EduAPI)

**EduAPI 1.0 was built from 1EdTech's OpenAPI 3.0 document `eduapi_v1p0_openapi3.json` (`x-status Final`). The standard's part of the
graph has 762 content nodes.**
**It holds all 39 schemas, all 341 schema properties, and the 62 enumerations with their 319 values. Every `$ref`, direct or under
`items`, is kept as a reference.**

Accuracy was checked by round trip: the live graph was read back into source statements and compared, one by one, with an independent
reading of the document's `components.schemas`. Nothing was invented and nothing was lost. The rest of the document, its API
(paths, parameters, headers, links, security, servers, tags, info), is deliberately not carried; it is listed below.

| | |
|---|---|
| standard | EduAPI 1.0 (bundle `eduapi`, `_source` `EduAPI`, family `EduAPI`) |
| source | `assets/standardSourceData/02/eduapi_v1p0_openapi3.json` (the pin, `defaultSnapshot=02`), checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/02/README_PROVENANCE.md`. Snapshot 01 (the May Candidate Final) is record only |
| source URL | `https://purl.imsglobal.org/spec/eduapi/v1p0/schema/openapi/eduapi_v1p0_openapi3.json` |
| version | `1.0` (the document's `info.version`, `x-status Final`; it agrees with `standardSourceLocation`, versionSource `spec`) |
| graph | scratch graphs built 2026-10-24 from `recipes/eduapiOnlyRoundTrip.recipe.jsonc` and disposed by name |
| build | `--vectorize=false` standardBase block **`36873b24b3cca5d16c3af2632d8824ebb3f53e013ac483f429e7ef69f920e5cc`**; vectorised **`96afca5592a11826113dd1b868a1454a919b1c966dfee08c9019d460a5dd4d82`** (the first vectorised build embedded 337 texts; every later build ran `--embeddingCacheOnly=true`) |
| spend | $0.0004, embedding only (337 new vectors); judge $0 |
| commit | branch `ns/f-eduapi` (nextStandards wave 2 lane F) |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the document | DmeStandardRoot | `EduapiRoot` | 1 |
| a `components.schemas` member | DmeClass | `EduapiSchema` | 39 |
| a property of a schema | DmeProperty | `EduapiProperty` | 341 |
| the enum in a property's shape | DmeOptionSet | `EduapiEnum` | 62 |
| an enum member | DmeOptionValue | `EduapiEnumValue` | 319 |
| a name or description text (search) | DmeEmbedText | `EduapiEmbedText` | 294 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → schema | (every schema) | 39 |
| `HAS_PROPERTY` | schema → property | `properties` | 341 |
| `REFERENCES` | property → schema, with `referenceConstruct` and `locator` | each `$ref`: 32 direct, 61 under `items` | 93 |
| `HAS_OPTION_SET` | property → enum | `enum` (direct or in an `anyOf` branch) | 62 |
| `HAS_VALUE` | enum → member | each member | 319 |

- **Text.** Each schema and each property carries its OpenAPI `description` verbatim. 32 properties have none: they are a bare `$ref`,
  and OpenAPI 3.0 allows nothing beside one. Those properties carry `referencedSchemaNames` (e.g. `Person.primaryAddress`:
  `OptionallyTypedAddress`).
- **Types.** `dataType`, `dataFormat`, `valuePattern`, `minItems`, and for arrays `itemsDataType` and friends; `isRequired` from each
  schema's `required` list (151 properties); `additionalPropertiesAllowed` on each schema.
- **Choices.** 41 of the 62 enumerations are EXTENSIBLE: an `anyOf` of the enum and a pattern `(ext:)…` (e.g.
  `Enrollment.enrollmentStatus`). The enum is the option set (`enumLocator` `/anyOf/0/enum`); the pattern branch is in the property's
  `compositionBranches`. 21 are plain (`/enum`).
- **Identifiers.** 1EdTech's persistent ids are carried as data: `xClassPid` on schemas, `xSrcpropPid` on properties. The second names
  the property's value type, not the property (see Known issues).

## The counts

The round trip compared every scalar of `components.schemas` at its JSON pointer: **inventedTotal 0, lostTotal 0**, in the graph built
without vectors and in the graph built with them. Declared omissions, 16 in all, one per member: the document's `openapi`, `info`,
`servers`, `tags` and `paths`, and its `components.parameters` (5), `components.headers` (1), `components.securitySchemes` (1) and
`components.links` (4). `info.version` is the root's version and `info.description` its description ("Edu-API v1p0 Final Release").

## Round Trip Validation

The validator (`roundTripValidator.js`, the OpenAPI kit's pair for the `referencedSingleFile` layout, through
`lib/openapi-forge/openapiLayout.js`) reads the snapshot and the materialised graph separately. The `required` list and enum members are
compared as sets: their order means nothing in JSON Schema. A node property the reader cannot account for counts as invented, so a value
added in the graph turns the check red. The derived `referencedSchemaNames` is checked against the `REFERENCES` edges.
`forges/eduapi/test/test-eduapiForge.js` holds three round-trip twins on the real graph, each observed red (a dropped reference, a
dropped enum member, an edited description).

## Known issues

- `xSrcpropPid` looks like a property identifier and is not one: 309 properties share 61 values, 52 of them
  `org.1edtech.eduapi.v1p0.primitive.string.class`. Do not join on it.
- Eleven schemas are not institutional data: the three `Imsx_*` status-envelope schemas (7 properties) and eight empty
  `<entity>Extensions` extension points (0 properties each). They are in the graph and the envelope properties are in bridge retrieval.
- The Offering and Template families repeat their record envelope: `sourcedId`, `recordStatus`, `dateLastModified`, `recordLanguage`
  and `extensions` appear 14 times each; 341 properties carry only 123 distinct (name, description) pairs.
- One enum member is the name of a hub vocabulary: `LearningObjectiveSet.source` lists `CTDL-ASN`. It is EduAPI's own value, carried
  verbatim, and never shown to the bridge judge (only properties are judged).
- Downloads of this standard are withheld under the 1EdTech licence; the graph itself is unaffected.

## Provenance

Fetched 2026-10-24 from the URL above (HTTP Last-Modified 2026-08-31). It differs from the copy held since 2026-05-28 (snapshot 01,
`x-status Candidate Final`): one new class (`LearningObjectiveSet`), eight new properties referencing it, one enum member re-cased
(`Interruption` → `interruption`) and 48 reworded descriptions, nothing removed. The element-by-element record is
`system/management/zNotesPlansDocs/nextStandards-102326/CHANGES-eduapi-01to02-102426.md`.

## For more information

`assets/standardSourceData/02/README_PROVENANCE.md`, `lib/openapi-forge/README.md` (the kit, whose reference bundle is
`forges/openbadges`), and the lane's reports `system/management/zNotesPlansDocs/nextStandards-102326/GATEREPORT-F0-102426.md` and
`GATEREPORT-F1F2F3-102426.md`.
