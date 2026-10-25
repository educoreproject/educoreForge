# CLR 2.0 — identity rules

The identity rule is the OpenAPI kit's (`lib/openapi-forge/openapiIdentity.js`) with this bundle's prefix `clr:`
(`lib/clrOpenapiProfile.json`). Identity is CLR's own: a schema's name and a property's name as the document writes them. Nothing is
borrowed from another standard (FBB-001).

| role | stableId | example | count (snapshot 01) |
|---|---|---|---|
| DmeStandardRoot | `clr:root` | | 1 |
| DmeClass | `clr:<Schema>` | `clr:ClrCredential` | 34 |
| DmeProperty | `clr:<Schema>/<property>` | `clr:ClrSubject/verifiableCredential` | 206 |
| DmeOptionSet | `clr:<Schema>/<property>/enum` | `clr:Association/associationType/enum` | 9 |
| DmeOptionValue | `clr:<Schema>/<property>/enum/<member>` | `clr:Alignment/targetType/enum/ceterms:Credential` | 116 |

- A property is identified by its OWNING schema: `id` on `Profile` and `id` on `Achievement` are two nodes.
- **The 28 schemas whose names CLR shares with Open Badges 3.0 (`Achievement`, `Profile`, `Alignment`, …) are CLR's, under `clr:`.** The
  publisher stamps them in CLR's persistent-id namespace (`org.1edtech.clr.v2p0.*`) and CLR's document references only its own schemas, so
  `clr:Achievement` and `openbadges:Achievement` are two nodes of two standards with no edge between them. `test-clrForge` asserts that
  every node and every edge end is a `clr:` id.
- The ONE enum anywhere in a property's shape (direct or inside a composition branch) is that property's option set; `enumLocator` says
  where (`/enum`, `/anyOf/0/enum`).
- The 1EdTech persistent ids are NOT identity: `x-class-pid` (unique per schema) and `x-srcprop-pid` (the value type's pid, README_ERRATA
  E1) are carried as data, `xClassPid` / `xSrcpropPid`.
- No member or name needs percent-encoding (every segment is inside `[A-Za-z0-9@_$.:-]`; `ceterms:Credential` keeps its colon).
