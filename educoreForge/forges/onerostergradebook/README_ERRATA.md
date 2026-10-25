# OneRoster 1.2 Gradebook — upstream observations (ERRATA)

Observations about the publisher's document `orgradebook_v1p2_openapi3.json` (snapshot 01, the 2026-06-16 skill-package member), each with its
evidence. The forge carries every one of them VERBATIM; none is repaired. Measured 2026-10-24 by MIDNIGHT_JOURNEY (nextStandards-102326 wave
3 lane H) with `python3 -I` over the snapshot.

| # | observation | evidence | how the forge carries it |
|---|---|---|---|
| E1 | `x-srcprop-pid` names a property's VALUE TYPE, not the property | 107 occurrences, 35 distinct; `org.1edtech.orgradebook.v1p2.derived.guid.class` on 17 properties, `…primitive.normalizedstring.class` 13, `…primitive.anyuri.class` 9 | verbatim as `xSrcpropPid`; `nativeIdentifierPropertyName` null |
| E2 | the properties that are a bare `$ref` carry no description | OpenAPI 3.0 allows no sibling of `$ref` | no `description`; the judge sees the target's name (`referencedSchemaNames`) |
| E3 | 8 boolean flags are enumerations of the STRINGS `true` and `false` | `Result` and `AssessmentResult` `.inProgress`, `.incomplete`, `.late`, `.missing` | verbatim: an option set of two values each |
| E4 | 2 property descriptions end in a space | measured over `components.schemas` | verbatim |
| E6 | `imsx_CodeMinorField.imsx_codeMinorFieldValue` lists 10 codes here; the three services' lists differ (Gradebook adds `deletefailure`; Resources adds `invalid_sort_field`, `unsupported`) | the three documents | each service's own list, under its own prefix |
| E7 | `info.contact` still names IMS Global; `info.license` reads "IMS Global Specification Document License" | `info.contact`, `info.license` | not forged (info is out of scope by declaration; `info.description` is the root's description) |
| E8 | the publisher's purl for this generation's JSON (`…/schema/openapi/or<svc>_v1p2_openapi3.json`, linked for Rostering) answered HTTP 404 on 2026-10-24; the file is published only inside the skill package | `01/README_PROVENANCE.md` | the forge reads the extracted member; SHA256SUMS covers both |
