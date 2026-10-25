# OneRoster 1.2 Gradebook — identity rules

The identity rule is the OpenAPI kit's (`lib/openapi-forge/openapiIdentity.js`) with this bundle's prefix `onerostergradebook:`
(`lib/onerostergradebookOpenapiProfile.json`). Identity is the service's own: a schema's name and a property's name as the document writes them.
Nothing is borrowed from another standard (FBB-001).

| role | stableId | example | count (snapshot 01) |
|---|---|---|---|
| DmeStandardRoot | `onerostergradebook:root` | | 1 |
| DmeClass | `onerostergradebook:<Schema>` | `onerostergradebook:LineItem` | 37 |
| DmeProperty | `onerostergradebook:<Schema>/<property>` | `onerostergradebook:Result/lineItem` | 138 |
| DmeOptionSet | `onerostergradebook:<Schema>/<property>/enum` | `onerostergradebook:Result/scoreStatus/enum` | 30 |
| DmeOptionValue | `onerostergradebook:<Schema>/<property>/enum/<member>` | `onerostergradebook:Result/scoreStatus/enum/fully%20graded` | 68 |

- **OneRoster 1.2 is three standards here** (Rostering, Gradebook, Resources; family OneRoster; BRONZE_CROWN ruling R2,
  `zNotesPlansDocs/nextStandards-102326/DESIGN-H0-oneroster-102426.md`), one per service model the publisher issues, each with its own
  prefix. A schema whose name also occurs in another service (five GUIDRefs and `imsx_*` with Rostering; `Metadata` and `imsx_*` with Resources) is THIS service's copy: the publisher stamps it in this
  service's persistent-id namespace (`org.1edtech.orgradebook.v1p2.*`) and this document references only its own schemas, so the same name in two
  services is two nodes of two standards with no edge between them (six of the fifteen same-name pairs also differ in content).
  `test-onerostergradebookForge` asserts that every node and every edge end is a `onerostergradebook:` id.
- A property is identified by its OWNING schema: `sourcedId` on `LineItem` and on any other schema are separate nodes.
- The ONE enum anywhere in a property's shape (direct or inside a composition branch) is that property's option set; `enumLocator` says
  where (`/enum`, `/anyOf/0/enum`).
- The 1EdTech persistent ids are NOT identity: `x-class-pid` (unique per schema) and `x-srcprop-pid` (the value type's pid, README_ERRATA
  E1) are carried as data, `xClassPid` / `xSrcpropPid`.
- A member segment keeps `[A-Za-z0-9@_$.:-]` and percent-encodes everything else. Three members need it: `scoreStatus`'s `fully graded`, `not submitted` and `partially graded` (in `Result` and `AssessmentResult`) are `fully%20graded`, `not%20submitted`, `partially%20graded` in their ids and verbatim in their names (K4a, `lib/openapi-forge/openapiIdentity.js`).
