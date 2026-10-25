# Validation certificate — OneRoster 1.2 Rostering (OneRoster)

**OneRoster 1.2 Rostering was built from 1EdTech's OpenAPI 3.0 document `orrostering_v1p2_openapi3.json`. The standard's part of the graph has
319 content nodes. It holds all 40 schemas, all 158 schema properties, and the 32 enumerations with their 88 values. Every
`$ref` is kept as a reference.**

Accuracy was checked by round trip: the live graph was read back into source statements and compared, one by one, with an independent
reading of the document's `components.schemas`. Nothing was invented and nothing was lost. The rest of the document, its API (paths,
servers, tags, info, and the parameters and security scheme under `components`), is deliberately not carried; it is listed below.

| | |
|---|---|
| standard | OneRoster 1.2 Rostering (bundle `onerosterrostering`, `_source` `OneRoster-Rostering-1.2`, family `OneRoster`, releaseLabel `Rostering`): one of the three OneRoster 1.2 standards (Rostering, Gradebook, Resources; ruling R2) |
| source | `assets/standardSourceData/01/orrostering_v1p2_openapi3.json`, extracted from the publisher's package `orrostering-v1p2.zip`; both checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | `https://purl.imsglobal.org/spec/orrostering/v1p2/skill/orrostering-v1p2.zip` |
| version | `1.2` (the document's `info.version`, `x-status` Final; it agrees with `standardSourceLocation`, versionSource `spec`) |
| graph | scratch graphs built 2026-10-24/25 from `recipes/onerosterOnlyRoundTrip.recipe.jsonc` and disposed by name; stores on the external scratch volume (`/Users/tqwhite/educoreForgeScratch/wave3/laneH/builds/h1novec`, `h1vec`) |
| build | `--vectorize=false` standardBase block **`ecc3eaee4de7137e585b2016e0955c8c4d8b137ec379b77f7362f6c81f3946c1`**; vectorised **`69bd72a013d7e778b8ee897ae47700d344bc601661246313c1f688df5e9fda16`** |
| spend | the vectorised build of all three OneRoster standards: $0.0017, embedding only (874 new vectors, in the wave-3 embed turn); judge $0 for the forge |
| commit | branch `ns/h-oneroster` (nextStandards wave 3 lane H), forge at `afc20d8b` on the kit change `258c8285` |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the document | DmeStandardRoot | `OnerosterRosteringRoot` | 1 |
| a `components.schemas` member | DmeClass | `OnerosterRosteringSchema` | 40 |
| a property of a schema | DmeProperty | `OnerosterRosteringProperty` | 158 |
| the enum in a property's shape | DmeOptionSet | `OnerosterRosteringEnum` | 32 |
| an enum member | DmeOptionValue | `OnerosterRosteringEnumValue` | 88 |
| a name or description text (search) | DmeEmbedText | `OnerosterRosteringEmbedText` | 272 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → schema | (every schema) | 40 |
| `HAS_PROPERTY` | schema → property | `properties` | 158 |
| `REFERENCES` | property → schema, with `referenceConstruct` and `locator` | each `$ref`: 26 direct, 19 under `items` | 45 |
| `HAS_OPTION_SET` | property → enum | `enum` (direct or in an `anyOf` branch) | 32 |
| `HAS_VALUE` | enum → member | each member | 88 |

- **Text.** Each schema and each property carries its OpenAPI `description` verbatim. 26 properties have none: they are a bare
  `$ref`, and OpenAPI 3.0 allows nothing beside one. Those properties carry `referencedSchemaNames`.
- **Types.** `dataType`, `dataFormat`, `valuePattern`, `minItems`, and for arrays `itemsDataType`; `isRequired` from each schema's
  `required` list (83 properties); `additionalPropertiesAllowed` on each schema.
- **Choices.** six of the 32 are EXTENSIBLE (an `anyOf` of an enum and a pattern `(ext:)…`: `Role.role` 12, `Org.type` 6, `Demographics.sex` 4, `Enrollment.role` 4, `AcademicSession.type` 4, `Class.classType` 2). The enum is the option set; the pattern branch is in the property's `compositionBranches`.
- **Persistent ids.** `xClassPid` on every schema and `xSrcpropPid` on 132 properties, verbatim (README_ERRATA E1: the latter names the
  value type).
- **The other OneRoster services.** A schema whose name also occurs in Rostering, Gradebook or Resources is this service's own copy, under
  `onerosterrostering:`, with no edge to the other (README_identityRules).

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
against the `REFERENCES` edges: a dropped edge is a named fault. `test-onerosterrosteringForge` runs the same validator over the harness's graph double,
with three perturbations each observed red.

## The bridges (judged, not part of the forge)

One derived facet over every property, judged by Jev `jev-1.13.0` toward both hubs (`bridges/onerosterrosteringBridging.js`), in the run of all three
OneRoster standards (`recipes/onerosterBridged.recipe.jsonc`, $0.1635 over 572 asked for the three; a replay asked 0 and wrote
byte-identical SSSOM). This standard: 316 asked, 0 from cache.
- CEDS: 76 (exact 13, close 41, broad 17, narrow 5), abstained 82 of 158 (52%).
- CTDL: 30 (exact 3, close 18, broad 8, narrow 1), abstained 128 of 158 (81%).

## Known issues

- **Edges that look wrong on sight** (not reviewed beyond this): `Class.course` and `Enrollment.class` (references to another object) → CTDL "Identifier" (close); `CourseGUIDRef.type` (a fixed type token) → CTDL "Classification" (close); `OrgGUIDRef.type` → CTDL "Agent Type" (narrow); `Course.courseCode` → CEDS "Course Identifier" (exact) is arguable (a code, not an identifier).
- 17 of the 40 schemas are API plumbing (`Single*` and `*Set` response wrappers, `imsx_*`). They are in the graph and in bridge
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
