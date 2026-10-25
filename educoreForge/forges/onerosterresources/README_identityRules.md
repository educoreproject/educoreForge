# OneRoster 1.2 Resources — identity rules

The identity rule is the OpenAPI kit's (`lib/openapi-forge/openapiIdentity.js`) with this bundle's prefix `onerosterresources:`
(`lib/onerosterresourcesOpenapiProfile.json`). Identity is the service's own: a schema's name and a property's name as the document writes them.
Nothing is borrowed from another standard (FBB-001).

| role | stableId | example | count (snapshot 01) |
|---|---|---|---|
| DmeStandardRoot | `onerosterresources:root` | | 1 |
| DmeClass | `onerosterresources:<Schema>` | `onerosterresources:Resource` | 7 |
| DmeProperty | `onerosterresources:<Schema>/<property>` | `onerosterresources:SingleResource/resource` | 19 |
| DmeOptionSet | `onerosterresources:<Schema>/<property>/enum` | `onerosterresources:Resource/roles/enum` | 6 |
| DmeOptionValue | `onerosterresources:<Schema>/<property>/enum/<member>` | `onerosterresources:Resource/roles/enum/student` | 30 |

- **OneRoster 1.2 is three standards here** (Rostering, Gradebook, Resources; family OneRoster; BRONZE_CROWN ruling R2,
  `zNotesPlansDocs/nextStandards-102326/DESIGN-H0-oneroster-102426.md`), one per service model the publisher issues, each with its own
  prefix. A schema whose name also occurs in another service (`Metadata` and `imsx_*` with Gradebook; `imsx_*` with Rostering) is THIS service's copy: the publisher stamps it in this
  service's persistent-id namespace (`org.1edtech.orresources.v1p2.*`) and this document references only its own schemas, so the same name in two
  services is two nodes of two standards with no edge between them (six of the fifteen same-name pairs also differ in content).
  `test-onerosterresourcesForge` asserts that every node and every edge end is a `onerosterresources:` id.
- A property is identified by its OWNING schema: `sourcedId` on `Resource` and on any other schema are separate nodes.
- The ONE enum anywhere in a property's shape (direct or inside a composition branch) is that property's option set; `enumLocator` says
  where (`/enum`, `/anyOf/0/enum`).
- The 1EdTech persistent ids are NOT identity: `x-class-pid` (unique per schema) and `x-srcprop-pid` (the value type's pid, README_ERRATA
  E1) are carried as data, `xClassPid` / `xSrcpropPid`.
- A member segment keeps `[A-Za-z0-9@_$.:-]` and percent-encodes everything else. No member or name needs percent-encoding.
