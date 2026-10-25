# Validation certificate — CASE 1.1 (CASE)

**CASE 1.1 was built from 1EdTech's OpenAPI 3.0 YAML document `imscasev1p1_openapi3_v1p0.yaml`. The standard's part of the graph has 288 content nodes.**
**It holds all 39 schemas, all 201 schema properties, and the 8 enumerations with their 39 values. Every `$ref` is kept as a reference.**

Accuracy was checked by round trip: the live graph was read back into source statements and compared, one by one, with an independent
reading of the document's `components.schemas`. Nothing was invented and nothing was lost. The rest of the document, its API
(paths, servers, tags, info), is deliberately not carried; it is listed below, with the two enum members the profile declares.

| | |
|---|---|
| standard | CASE 1.1, Competencies and Academic Standards Exchange (bundle `case`, `_source` `CASE`, family `CASE`) |
| source | `assets/standardSourceData/01/imscasev1p1_openapi3_v1p0.yaml`, checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | `https://purl.imsglobal.org/spec/case/v1p1/schema/openapi/imscasev1p1_openapi3_v1p0.yaml` |
| version | `1.1` (the document's `info.version`; it agrees with `standardSourceLocation`, versionSource `spec`) |
| graph | scratch graphs built 2026-10-24 from `recipes/caseOnlyRoundTrip.recipe.jsonc` and disposed by name |
| build | `--vectorize=false` standardBase block **`8ab5739e5eb2afbc65626766ad8a8708da7b6dd1a0c8577b1cb28d11b986515f`**; vectorised **`6e15c658b9ff5033ada796bbfc9db4a479f45e1d96eb8af16fb12adee880aa36`** (the vectorised build embedded 415 new texts, in the wave-2 embed turn) |
| spend | $0.0005, embedding only (415 new vectors); judge $0 for the forge |
| commit | branch `ns/e-case` (nextStandards wave 2 lane E), built at `bdb14b93` (the tree of `0b52cec1` after the rebase onto `d45f4d95`) |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the document | DmeStandardRoot | `CaseRoot` | 1 |
| a `components.schemas` member | DmeClass | `CaseSchema` | 39 |
| a property of a schema | DmeProperty | `CaseProperty` | 201 |
| the enum in a property's shape | DmeOptionSet | `CaseEnum` | 8 |
| an enum member | DmeOptionValue | `CaseEnumValue` | 39 |
| a name or description text (search) | DmeEmbedText | `CaseEmbedText` | 259 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → schema | (every schema) | 39 |
| `HAS_PROPERTY` | schema → property | `properties` | 201 |
| `REFERENCES` | property → schema, with `referenceConstruct` and `locator` | each `$ref`: 37 direct, 21 under `items` | 58 |
| `HAS_OPTION_SET` | property → enum | `enum` (direct or in an `anyOf` branch) | 8 |
| `HAS_VALUE` | enum → member | each member | 39 |

- **Text.** Each schema and each property carries its OpenAPI `description` verbatim, as the YAML states it: a block scalar keeps its
  final newline (all 39 schema descriptions and 29 property descriptions end in one). 37 properties have none: they are a bare `$ref`,
  and OpenAPI 3.0 allows nothing beside one. Those properties carry `referencedSchemaNames` (e.g. `CFAssociationDType.originNodeURI`:
  `LinkGenURIDType`).
- **Types.** `dataType`, `dataFormat`, `valuePattern`, `minItems`, and for arrays `itemsDataType` and friends; `isRequired` from each
  schema's `required` list (84 properties); `additionalPropertiesAllowed` on each schema.
- **Choices.** `associationType` (on `CFAssociationDType` and `CFPckgAssociationDType`) is EXTENSIBLE: an `anyOf` of a 10-member enum and
  a pattern. The enum is the option set; the pattern branch is in the property's `compositionBranches`.
- **Annotations.** 1EdTech's privacy annotations are carried as data: `x_1edtechConfidentiality` (`unrestricted`) on every schema, and
  `x_1edtechPrivacy` and `x_1edtechConfidentialityNormal` (JSON lists, `["extensions"]`) on the 13 `*ExtensionDType` schemas. A word
  that begins with a digit is marked with `_` so the name reads back (the OpenAPI kit's rule since K2).

## The counts

The round trip compared every scalar of `components.schemas` at its JSON pointer: **inventedTotal 0, lostTotal 0**, in the graph built
without vectors and in the graph built with them. Declared omissions, 7 in all: the document's `openapi`, `info`, `servers`, `tags` and
`paths` (one each), and the two `caseVersion` enum members (kind `declaredMemberText`, below). `info.version` is the root's version and
`info.description` its description.

## Round Trip Validation

The validator (`roundTripValidator.js`, the OpenAPI kit's pair `lib/openapi-forge/openapiRoundTripPair.js`) reads the snapshot (through
the kit's one parser, js-yaml under its JSON schema) and the materialised graph separately. The `required` list and enum members are
compared as sets: their order means nothing in JSON Schema. A declared list-valued annotation is compared member by member, in order. A
node property the reader cannot account for counts as invented, so a value added in the graph turns the check red. The derived
`referencedSchemaNames` is checked against the `REFERENCES` edges.

## Known issues

- `caseVersion`'s one member is the unquoted YAML number `1.1` beside `type: string`. The profile declares it as the text `1.1` (what the
  property's description and the publisher's JSON sibling say); the round trip counts the retyping as a declared omission, twice.
- The publisher's JSON at the same URL directory is a different document (datatype-first descriptions, 13 statements fewer, the member
  as text). The YAML is the one forged; the JSON is stored, unread (`README_PROVENANCE.md`).
- The three `CFPckg*` schemas repeat their single-record forms (`CFDocumentDType`, `CFItemDType`, `CFAssociationDType`): separate nodes
  with mostly the same names and descriptions.
- 13 of the 39 schemas are empty `*ExtensionDType` containers (no properties), and three (`imsx_CodeMinorDType`,
  `imsx_CodeMinorFieldDType`, `imsx_StatusInfoDType`) are the API's status plumbing. They are in the graph and in bridge retrieval.
- Downloads of this standard are withheld under the 1EdTech licence; the graph itself is unaffected.

## Provenance

Fetched 2026-10-24 from the URL above; byte-identical to the copy held since 2026-06-23. The JSON sibling
(`imscasev1p1_openapi3_v1p0.json`) is stored beside it for reference and is not read.

## For more information

`README_identityRules.md` (identity), `README_ERRATA.md` (upstream observations), `assets/standardSourceData/01/README_PROVENANCE.md`,
and `lib/openapi-forge/` (the kit) with this lane's design `system/management/zNotesPlansDocs/nextStandards-102326/DESIGN-E0-case-102426.md`.
