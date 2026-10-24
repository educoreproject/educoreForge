# CASE 1.1 — upstream observations (ERRATA)

Observations about the publisher's document `imscasev1p1_openapi3_v1p0.yaml` (snapshot 01, sha256 `8f50402b…7dfd61`), each with its
evidence. The forge carries every one of them VERBATIM; none is repaired (E1's member is carried as declared text, by name). Measured
2026-10-24 by HIDDEN_EMBER (nextStandards wave 2 lane E) by parsing the snapshot (js-yaml JSON_SCHEMA, the kit's own parser).

| # | observation | evidence | how the forge carries it |
|---|---|---|---|
| E1 | `caseVersion`'s one enum member is an unquoted `1.1`, which YAML types as a NUMBER, beside `type: string` | `CFDocumentDType` and `CFPckgDocumentDType`, `caseVersion: { type: string, enum: [ 1.1 ] }`; the property's own description says "MUST have a value of '1.1'"; the publisher's JSON sibling states `"1.1"` | as the text `1.1`, declared in the profile's `enumMemberTextDeclarationList`; the round trip counts the retyping as a declared omission (`declaredMemberText`, 2) |
| E2 | every schema description and 29 property descriptions end with a newline | YAML block scalars (`description: \|`); 39 + 29 = 68 | verbatim, the newline kept (the round trip compares it) |
| E3 | the publisher's JSON sibling at the same URL directory is not the same content | 221 differences inside `components.schemas` (138 reworded descriptions, 68 newlines, 13 statements absent, 2 members typed differently): `assets/standardSourceData/01/README_PROVENANCE.md` | the JSON is stored as an unread peer; the YAML is forged (BRONZE_CROWN 2026-10-24) |
| E4 | 37 properties carry no description | each is a bare `$ref` (e.g. `CFAssociationDType.originNodeURI → LinkGenURIDType`): OpenAPI 3.0 allows no sibling of `$ref` | no `description`; `referencedSchemaNames` names the target for a reader and the judge |
| E5 | 13 `*ExtensionDType` schemas have no properties | `properties: {}`, `additionalProperties: true`: proprietary-extension containers | as classes with no property nodes |
| E6 | two vendor extensions hold a LIST, not a string | `x-1edtech-privacy: [ extensions ]` and `x-1edtech-confidentiality-normal: [ extensions ]` on the 13 `*ExtensionDType` | declared in `listValuedVendorExtensionNameList`; carried as JSON text `["extensions"]` |
| E7 | the CFPckg* schemas repeat their single-record forms | `CFPckgDocumentDType` / `CFDocumentDType`, `CFPckgItemDType` / `CFItemDType`, `CFPckgAssociationDType` / `CFAssociationDType` share most property names and descriptions | as written: separate classes, separate properties (and separate judge units) |
| E8 | most property descriptions end with the 1EdTech model's datatype | "… Model Primitive Datatype = NormalizedString." | verbatim (part of the description the judge reads) |
