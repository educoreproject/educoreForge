# Validation certificate — OneRoster 1.2 Resources (OneRoster)

**OneRoster 1.2 Resources was built from 1EdTech's OpenAPI 3.0 document `orresources_v1p2_openapi3.json`. The standard's part of the graph has
63 content nodes. It holds all 7 schemas, all 19 schema properties, and the 6 enumerations with their 30 values. Every
`$ref` is kept as a reference.**

Accuracy was checked by round trip: the live graph was read back into source statements and compared, one by one, with an independent
reading of the document's `components.schemas`. Nothing was invented and nothing was lost. The rest of the document, its API (paths,
servers, tags, info, and the parameters and security scheme under `components`), is deliberately not carried; it is listed below.

| | |
|---|---|
| standard | OneRoster 1.2 Resources (bundle `onerosterresources`, `_source` `OneRoster-Resources-1.2`, family `OneRoster`, releaseLabel `Resources`): one of the three OneRoster 1.2 standards (Rostering, Gradebook, Resources; ruling R2) |
| source | `assets/standardSourceData/01/orresources_v1p2_openapi3.json`, extracted from the publisher's package `orresources-v1p2.zip`; both checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | `https://purl.imsglobal.org/spec/orresources/v1p2/skill/orresources-v1p2.zip` |
| version | `1.2` (the document's `info.version`, `x-status` Final; it agrees with `standardSourceLocation`, versionSource `spec`) |
| graph | scratch graphs built 2026-10-24/25 from `recipes/onerosterOnlyRoundTrip.recipe.jsonc` and disposed by name; stores on the external scratch volume (`/Users/tqwhite/educoreForgeScratch/wave3/laneH/builds/h1novec`, `h1vec`) |
| build | `--vectorize=false` standardBase block **`151531d106d13a35ed5a103c5f28d8827cdd2011bbba954498ed4d29e49d4a07`**; vectorised **`011282d77908569a7fb95a634d9b51ec5388b44961b3736533f8b50fed20c069`** |
| spend | the vectorised build of all three OneRoster standards: $0.0017, embedding only (874 new vectors, in the wave-3 embed turn); judge $0 for the forge |
| commit | branch `ns/h-oneroster` (nextStandards wave 3 lane H), forge at `afc20d8b` on the kit change `258c8285` |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the document | DmeStandardRoot | `OnerosterResourcesRoot` | 1 |
| a `components.schemas` member | DmeClass | `OnerosterResourcesSchema` | 7 |
| a property of a schema | DmeProperty | `OnerosterResourcesProperty` | 19 |
| the enum in a property's shape | DmeOptionSet | `OnerosterResourcesEnum` | 6 |
| an enum member | DmeOptionValue | `OnerosterResourcesEnumValue` | 30 |
| a name or description text (search) | DmeEmbedText | `OnerosterResourcesEmbedText` | 48 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → schema | (every schema) | 7 |
| `HAS_PROPERTY` | schema → property | `properties` | 19 |
| `REFERENCES` | property → schema, with `referenceConstruct` and `locator` | each `$ref`: 3 direct, 2 under `items` | 5 |
| `HAS_OPTION_SET` | property → enum | `enum` (direct or in an `anyOf` branch) | 6 |
| `HAS_VALUE` | enum → member | each member | 30 |

- **Text.** Each schema and each property carries its OpenAPI `description` verbatim. 3 properties have none: they are a bare
  `$ref`, and OpenAPI 3.0 allows nothing beside one. Those properties carry `referencedSchemaNames`.
- **Types.** `dataType`, `dataFormat`, `valuePattern`, `minItems`, and for arrays `itemsDataType`; `isRequired` from each schema's
  `required` list (10 properties); `additionalPropertiesAllowed` on each schema.
- **Choices.** one of the six is EXTENSIBLE (`Resource.roles` 8). The enum is the option set; the pattern branch is in the property's `compositionBranches`.
- **Persistent ids.** `xClassPid` on every schema and `xSrcpropPid` on 16 properties, verbatim (README_ERRATA E1: the latter names the
  value type).
- **The other OneRoster services.** A schema whose name also occurs in Rostering, Gradebook or Resources is this service's own copy, under
  `onerosterresources:`, with no edge to the other (README_identityRules).

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
against the `REFERENCES` edges: a dropped edge is a named fault. `test-onerosterresourcesForge` runs the same validator over the harness's graph double,
with three perturbations each observed red.

## The bridges (judged, not part of the forge)

One derived facet over every property, judged by Jev `jev-1.13.0` toward both hubs (`bridges/onerosterresourcesBridging.js`), in the run of all three
OneRoster standards (`recipes/onerosterBridged.recipe.jsonc`, $0.1635 over 572 asked for the three; a replay asked 0 and wrote
byte-identical SSSOM). This standard: 24 asked, 14 from cache (7 per hub, the shared imsx_ classes).
- CEDS: 6 (close 4, broad 2), abstained 13 of 19 (68%).
- CTDL: 1 (close: `ResourceSet.resources` → "Has Member"), abstained 18 of 19 (95%).

## Known issues

- **Edges that look wrong on sight** (not reviewed beyond this): `ResourceSet.resources` (a response wrapper's array) → CTDL "Has Member" (close) is plumbing, not meaning.
- 5 of the 7 schemas are API plumbing (`Single*` and `*Set` response wrappers, `imsx_*`). They are in the graph and in bridge
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
