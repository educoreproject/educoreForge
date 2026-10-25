# Validation certificate — CLR 2.0 (CLR)

**CLR 2.0 was built from 1EdTech's OpenAPI 3.0 document `clr_v2p0_oas.json`. The standard's part of the graph has 366 content nodes.**
**It holds all 34 schemas, all 206 schema properties, and the 9 enumerations with their 116 values. Every `$ref` is kept as a reference.**

Accuracy was checked by round trip: the live graph was read back into source statements and compared, one by one, with an independent
reading of the document's `components.schemas`. Nothing was invented and nothing was lost. The rest of the document, its API (paths,
servers, tags, info, and the headers, security schemes and links under `components`), is deliberately not carried; it is listed below.

| | |
|---|---|
| standard | CLR 2.0, Comprehensive Learner Record (bundle `clr`, `_source` `CLR`, family `CLR`) |
| source | `assets/standardSourceData/01/clr_v2p0_oas.json`, checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | `https://purl.imsglobal.org/spec/clr/v2p0/schema/openapi/clr_v2p0_oas.json` |
| version | `2.0` (the document's `info.version`, `x-status` Final; it agrees with `standardSourceLocation`, versionSource `spec`) |
| graph | scratch graphs built 2026-10-24 from `recipes/clrOnlyRoundTrip.recipe.jsonc` and disposed by name; stores on the external scratch volume (`/Users/tqwhite/educoreForgeScratch/wave2/laneD/builds/`) |
| build | `--vectorize=false` standardBase block **`13eec30bd3049161a230bcc8dcdb28b3c650fd192070a9e50c0b4ce94ce28727`**; vectorised **`df5e3d79c7839608f0c5a5161d9e7cc533a54be35fce3298271c6ed66687170a`** (the vectorised build embedded 146 new texts, in the wave-2 embed turn) |
| spend | $0.0002, embedding only (146 new vectors; most CLR texts were already cached from Open Badges' identical schemas); judge $0 for the forge |
| commit | branch `ns/d-clr` (nextStandards wave 2 lane D), built at `0dfe1dba` (the forge files are unchanged by every later rebase) |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the document | DmeStandardRoot | `ClrRoot` | 1 |
| a `components.schemas` member | DmeClass | `ClrSchema` | 34 |
| a property of a schema | DmeProperty | `ClrProperty` | 206 |
| the enum in a property's shape | DmeOptionSet | `ClrEnum` | 9 |
| an enum member | DmeOptionValue | `ClrEnumValue` | 116 |
| a name or description text (search) | DmeEmbedText | `ClrEmbedText` | 351 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → schema | (every schema) | 34 |
| `HAS_PROPERTY` | schema → property | `properties` | 206 |
| `REFERENCES` | property → schema, with `referenceConstruct` and `locator` | each `$ref`: 22 direct, 29 under `items`, 3 in an `issuer` `oneOf` | 54 |
| `HAS_OPTION_SET` | property → enum | `enum` (direct or in an `anyOf` branch) | 9 |
| `HAS_VALUE` | enum → member | each member | 116 |

- **Text.** Each schema and each property carries its OpenAPI `description` verbatim (markdown backticks included). 22 properties have
  none: they are a bare `$ref`, and OpenAPI 3.0 allows nothing beside one. Those properties carry `referencedSchemaNames` (e.g.
  `Achievement.creator`: `Profile`).
- **Types.** `dataType`, `dataFormat`, `valuePattern`, `minItems`, and for arrays `itemsDataType` and friends; `isRequired` from each
  schema's `required` list (82 properties); `additionalPropertiesAllowed` on each schema.
- **Choices.** Five of the nine enumerations are EXTENSIBLE (an `anyOf` of an enum and a pattern `(ext:)…`: `achievementType` 31,
  `identifierType` 19, `identityType` 19, `resultType` 12, `targetType` 7). The enum is the option set; the pattern branch is in the
  property's `compositionBranches`.
- **Persistent ids.** `xClassPid` on every schema and `xSrcpropPid` on 184 properties, verbatim (README_ERRATA E1: the latter names the
  value type).
- **The Open Badges-named schemas.** 28 of the 34 schemas share a name with Open Badges 3.0's; 27 are identical to them but for the
  persistent-id namespace. They are CLR's own copies, forged under `clr:` with no edge to Open Badges (README_identityRules).

## The counts

The round trip compared every scalar of `components.schemas` at its JSON pointer: **inventedTotal 0, lostTotal 0, contentGap 0,
roundTripClean true**, in the graph built without vectors and in the graph built with them (and again at the rebased head, `d1novecB`).
Declared omissions, 11 in all, kind `outOfScopeByDeclaration`: the document's `openapi`, `info`, `servers`, `tags` and `paths` (one
each), `components.headers` (1), `components.securitySchemes` (1) and `components.links` (4). `info.version` is the root's version and
`info.description` ("CLR Standard data model.") its description.

## Round Trip Validation

The validator (`roundTripValidator.js`, the OpenAPI kit's pair `lib/openapi-forge/openapiRoundTripPair.js`, reached through
`openapiLayout.roundTripPairFor`) reads the snapshot and the materialised graph separately. The `required` list and enum members are
compared as sets: their order means nothing in JSON Schema. A node property the reader cannot account for counts as invented, so a value
added in the graph turns the check red. The derived `referencedSchemaNames` is checked against the `REFERENCES` edges: a dropped edge is a
named fault. `test-clrForge` runs the same validator over the harness's graph double, with three perturbations each observed red.

## Known issues

- **Duplication with Open Badges.** The DME shows `Achievement`, `Profile`, `Alignment` and 25 other schemas twice, once per standard,
  with near-identical text. That is what the two publications say; the forge does not merge them (a merge would be a bridge).
- **Inherited judgments.** In the bridges (not the forge), 160 of CLR's 206 CEDS prompts and 159 of its 205 CTDL prompts are
  byte-identical to Open Badges' and reused Open Badges' cached judgments (`laneD/d2`, BRONZE_CROWN ruled this correct). The edges on
  those schemas are Open Badges' verdicts, including the two lane A flagged on sight (`credentialStatus` → a CEDS award-status TYPE; CLR's,
  like Open Badges', is a revocation-list pointer).
- 10 of the 34 schemas are API plumbing (`OpenApi*`, `Imsx_*`, `ServiceDescriptionDocument`, `GetClrCredentialsResponse`, `Proof`). They
  are in the graph and in bridge retrieval; `OpenApiSecuritySchemes.OAuth2ACG` drew no CTDL candidate (the one CTDL orphan).
- Downloads of this standard are withheld under the 1EdTech licence; the graph itself is unaffected.

## Provenance

Fetched 2026-10-24 from the URL above; byte-identical to the copy held since 2026-05-28 (whose source URL had not been recorded).

## For more information

`README_identityRules.md` (identity), `README_ERRATA.md` (upstream observations), `assets/standardSourceData/01/README_PROVENANCE.md`,
and `lib/openapi-forge/` (the kit) with this lane's design `system/management/zNotesPlansDocs/nextStandards-102326/DESIGN-D0-clr-102426.md`.
