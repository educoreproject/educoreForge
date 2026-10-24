# CASE 1.1 — identity rules

The identity rule is the OpenAPI kit's (`lib/openapi-forge/openapiIdentity.js`) with this bundle's prefix `case:`
(`lib/caseOpenapiProfile.json`). Identity is CASE's own: a schema's name and a property's name as the document writes them (the
publisher's `…DType` names kept). Nothing is borrowed from another standard (FBB-001).

| role | stableId | example | count (snapshot 01) |
|---|---|---|---|
| DmeStandardRoot | `case:root` | | 1 |
| DmeClass | `case:<Schema>` | `case:CFItemDType` | 39 |
| DmeProperty | `case:<Schema>/<property>` | `case:CFAssociationDType/originNodeURI` | 201 |
| DmeOptionSet | `case:<Schema>/<property>/enum` | `case:CFAssociationDType/associationType/enum` | 8 |
| DmeOptionValue | `case:<Schema>/<property>/enum/<member>` | `case:CFAssociationDType/associationType/enum/isChildOf` | 39 |

- A property is identified by its OWNING schema: `identifier` on `CFItemDType` and on `CFPckgItemDType` are two nodes.
- The ONE enum anywhere in a property's shape is that property's option set; `enumLocator` says where (`/enum` for five, an `anyOf`
  branch for `associationType` ×2 and `targetType`).
- `caseVersion`'s one member is the YAML number `1.1`; the profile's `enumMemberTextDeclarationList` carries it as the text `1.1`, so its
  value is `case:CFDocumentDType/caseVersion/enum/1.1` (and the same under `CFPckgDocumentDType`). README_ERRATA E1.
- The 1EdTech annotations are NOT identity: `x-1edtech-confidentiality` (`unrestricted` on all 39), `x-1edtech-privacy` and
  `x-1edtech-confidentiality-normal` (lists, on the 13 `*ExtensionDType`) are carried as data, `x_1edtechConfidentiality`,
  `x_1edtechPrivacy`, `x_1edtechConfidentialityNormal` (K2: a digit-led word is marked with `_`).
- No member needs percent-encoding (measured: 0). A name the pattern does not admit is refused at mint, never repaired.
