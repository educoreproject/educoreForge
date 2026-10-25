# Validation certificate — OneRoster 1.2 Gradebook (OneRoster)

**OneRoster 1.2 Gradebook was built from 1EdTech's OpenAPI 3.0 document `orgradebook_v1p2_openapi3.json`. The standard's part of the graph has
274 content nodes. It holds all 37 schemas, all 138 schema properties, and the 30 enumerations with their 68 values. Every
`$ref` is kept as a reference.**

Accuracy was checked by round trip: the live graph was read back into source statements and compared, one by one, with an independent
reading of the document's `components.schemas`. Nothing was invented and nothing was lost. The rest of the document, its API (paths,
servers, tags, info, and the parameters and security scheme under `components`), is deliberately not carried; it is listed below.

| | |
|---|---|
| standard | OneRoster 1.2 Gradebook (bundle `onerostergradebook`, `_source` `OneRoster-Gradebook-1.2`, family `OneRoster`, releaseLabel `Gradebook`): one of the three OneRoster 1.2 standards (Rostering, Gradebook, Resources; ruling R2) |
| source | `assets/standardSourceData/01/orgradebook_v1p2_openapi3.json`, extracted from the publisher's package `orgradebook-v1p2.zip`; both checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | `https://purl.imsglobal.org/spec/orgradebook/v1p2/skill/orgradebook-v1p2.zip` |
| version | `1.2` (the document's `info.version`, `x-status` Final; it agrees with `standardSourceLocation`, versionSource `spec`) |
| graph | scratch graphs built 2026-10-24/25 from `recipes/onerosterOnlyRoundTrip.recipe.jsonc` and disposed by name; stores on the external scratch volume (`/Users/tqwhite/educoreForgeScratch/wave3/laneH/builds/h1novec`, `h1vec`) |
| build | `--vectorize=false` standardBase block **`66af7dde017b28070ca0ae680387b6e498c65c953fb3344df1194992e9cc797b`**; vectorised **`a08c87e721e25e87ff2aa599d4c430c474acd35633aef20c389c0a66a8a1f1df`** |
| spend | the vectorised build of all three OneRoster standards: $0.0017, embedding only (874 new vectors, in the wave-3 embed turn); judge $0 for the forge |
| commit | branch `ns/h-oneroster` (nextStandards wave 3 lane H), forge at `afc20d8b` on the kit change `258c8285` |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the document | DmeStandardRoot | `OnerosterGradebookRoot` | 1 |
| a `components.schemas` member | DmeClass | `OnerosterGradebookSchema` | 37 |
| a property of a schema | DmeProperty | `OnerosterGradebookProperty` | 138 |
| the enum in a property's shape | DmeOptionSet | `OnerosterGradebookEnum` | 30 |
| an enum member | DmeOptionValue | `OnerosterGradebookEnumValue` | 68 |
| a name or description text (search) | DmeEmbedText | `OnerosterGradebookEmbedText` | 197 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → schema | (every schema) | 37 |
| `HAS_PROPERTY` | schema → property | `properties` | 138 |
| `REFERENCES` | property → schema, with `referenceConstruct` and `locator` | each `$ref`: 31 direct, 14 under `items` | 45 |
| `HAS_OPTION_SET` | property → enum | `enum` (direct or in an `anyOf` branch) | 30 |
| `HAS_VALUE` | enum → member | each member | 68 |

- **Text.** Each schema and each property carries its OpenAPI `description` verbatim. 31 properties have none: they are a bare
  `$ref`, and OpenAPI 3.0 allows nothing beside one. Those properties carry `referencedSchemaNames`.
- **Types.** `dataType`, `dataFormat`, `valuePattern`, `minItems`, and for arrays `itemsDataType`; `isRequired` from each schema's
  `required` list (85 properties); `additionalPropertiesAllowed` on each schema.
- **Choices.** four of the 30 are EXTENSIBLE (`Result.scoreStatus` 5, `AssessmentResult.scoreStatus` 5, `LearningObjectiveSet.source` 2, `LearningObjectiveScoreSet.source` 2). The enum is the option set; the pattern branch is in the property's `compositionBranches`.
- **Persistent ids.** `xClassPid` on every schema and `xSrcpropPid` on 107 properties, verbatim (README_ERRATA E1: the latter names the
  value type).
- **Encoded members.** `scoreStatus`'s `fully graded`, `not submitted` and `partially graded` (in `Result` and `AssessmentResult`) are percent-encoded in their ids and verbatim in their names (kit change K4a, ruled 2026-10-24).
- **The other OneRoster services.** A schema whose name also occurs in Rostering, Gradebook or Resources is this service's own copy, under
  `onerostergradebook:`, with no edge to the other (README_identityRules).

## The counts

The round trip compared every scalar of `components.schemas` at its JSON pointer: **inventedTotal 0, lostTotal 0, roundTripClean true**,
in the graph built without vectors and in the graph built with them. Declared omissions, 12 in all, kind `outOfScopeByDeclaration`: the
document's `openapi`, `info`, `servers`, `tags` and `paths` (one each), the six `components.parameters` (`filter`, `offset`, `limit`,
`orderBy`, `sort`, `fields`) and `components.securitySchemes.OAuth2CC`. `info.version` is the root's version and `info.description` its
description.

## Round Trip Validation

The validator (`roundTripValidator.js`, the OpenAPI kit's pair `lib/openapi-forge/openapiRoundTripPair.js`, reached through
`openapiLayout.roundTripPairFor`) reads the snapshot and the materialised graph separately. The `required` list and enum members are
compared as sets. A node property the reader cannot account for counts as invented. The derived `referencedSchemaNames` is checked
against the `REFERENCES` edges: a dropped edge is a named fault. `test-onerostergradebookForge` runs the same validator over the harness's graph double,
with three perturbations each observed red.

## The bridges (judged, not part of the forge)

One derived facet over every property, judged by Jev `jev-1.13.0` toward both hubs (`bridges/onerostergradebookBridging.js`), in the run of all three
OneRoster standards (`recipes/onerosterBridged.recipe.jsonc`, $0.1635 over 572 asked for the three; a replay asked 0 and wrote
byte-identical SSSOM). This standard: 232 asked, 44 from cache (22 per hub: prompts byte-identical to Rostering's, the shared GUIDRef and imsx_ classes).
- CEDS: 44 (exact 1, close 25, broad 13, narrow 5), abstained 94 of 138 (68%).
- CTDL: 10 (close 5, broad 4, narrow 1), abstained 128 of 138 (93%).

## Known issues

- **Edges that look wrong on sight** (not reviewed beyond this): `ScoreScaleValue.itemValueLHS` (the left-hand value of a score-scale mapping) → CTDL "Left Source" (close); `LineItem.academicSession` (a reference to a session) → CEDS "Session Designator" (exact); `ScoreScale.course` → CTDL "Identifier" (broad); `OrgGUIDRef.type` → CTDL "Agent Type" (narrow).
- 16 of the 37 schemas are API plumbing (`Single*` and `*Set` response wrappers, `imsx_*`). They are in the graph and in bridge
  retrieval.
- The CTDL abstention rate is high, as for the other operational standards: CTDL is a credential vocabulary and most rostering elements
  have no counterpart there (code estimation; retrieval against meaning not measured).
- Downloads of this standard are withheld under the 1EdTech licence; the graph itself is unaffected.

## Provenance

Fetched 2026-10-24 from the URL above (the package dated 2026-06-16). The 2022 binding file at the publisher's older purl is a different
document and is recorded in `README_PROVENANCE.md`, not forged.

## For more information

`README_identityRules.md` (identity), `README_ERRATA.md` (upstream observations), `assets/standardSourceData/01/README_PROVENANCE.md`,
`lib/openapi-forge/` (the kit), and this lane's design `system/management/zNotesPlansDocs/nextStandards-102326/DESIGN-H0-oneroster-102426.md`.
