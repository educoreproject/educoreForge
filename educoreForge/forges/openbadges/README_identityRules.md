# Open Badges 3.0 — identity rules

The identity rule is the OpenAPI kit's (`lib/openapi-forge/openapiIdentity.js`) with this bundle's prefix `openbadges:`
(`lib/openbadgesOpenapiProfile.json`). Identity is Open Badges' own: a schema's name and a property's name as the document writes
them. Nothing is borrowed from another standard (FBB-001).

| role | stableId | example | count (snapshot 01) |
|---|---|---|---|
| DmeStandardRoot | `openbadges:root` | | 1 |
| DmeClass | `openbadges:<Schema>` | `openbadges:Achievement` | 32 |
| DmeProperty | `openbadges:<Schema>/<property>` | `openbadges:AchievementCredential/@context` | 201 |
| DmeOptionSet | `openbadges:<Schema>/<property>/enum` | `openbadges:Achievement/achievementType/enum` | 9 |
| DmeOptionValue | `openbadges:<Schema>/<property>/enum/<member>` | `openbadges:Alignment/targetType/enum/ceasn:Competency` | 115 |

- A property is identified by its OWNING schema: `id` on `Profile` and `id` on `Achievement` are two nodes.
- The ONE enum anywhere in a property's shape (direct, under `items`, or inside a composition branch) is that property's option set;
  `enumLocator` says where (`/enum`, `/anyOf/0/enum`). A property stating two enums is refused (none does).
- The 1EdTech persistent ids are NOT identity: `x-class-pid` (unique per schema) and `x-srcprop-pid` (the value type's pid, see
  README_ERRATA E1) are carried as data, `xClassPid` / `xSrcpropPid`.
- A name the pattern does not admit (a `/` or a space) is refused at mint, never repaired.
