# LIF 2.0 — identity rules

The identity rule is the OpenAPI kit's dereferenced-layout rule (`lib/openapi-forge/openapiIdentity.js`) with this bundle's prefix
`lif:` (`lib/lifOpenapiProfile.json`). Identity is LIF's own: an entity's name and a property's name as `lif-schema.json` writes them,
and the path of inline objects between them. Nothing is borrowed from another standard (FBB-001).

| role | stableId | example | count (snapshot 02) |
|---|---|---|---|
| DmeStandardRoot | `lif:root` | | 1 |
| DmeClass (entity) | `lif:<Entity>` | `lif:Person` | 8 |
| DmeClass (inline object) | `<property id>/inline` | `lif:Person/Contact/inline` | 132 |
| DmeProperty | `<owning class id>/<property>` | `lif:Person/Contact/inline/Address` | 1,393 |
| DmeOptionSet | `<property id>/enum` | `lif:Person/Consent/inline/lifEntities/enum` | 23 |
| DmeOptionValue | `<option set id>/<member, percent-encoded>` | `lif:Person/Demographics/inline/tribalNationName/enum/Arctic%20Village` | 1,873 |

- A property is identified by its OWNING class: `identifier` on `Person` and on `Course` are two nodes (the identifier envelope repeats on
  every entity and on every `...Ref<Entity>` object).
- An inline object's id is its property's id plus `/inline`, so nesting reads as a path: up to four objects deep.
- Inline objects are untitled in LIF, so their `name` is DERIVED by the kit (`Person.Contact.inline`), not a statement of the source.
- A member's id segment percent-encodes every character outside `[A-Za-z0-9@_$.:-]` (578 LIF members have a space); its `name` is verbatim.
- Ids are case-sensitive: `lif:Organization/identifier` (a string) and `lif:Organization/Identifier` (an object) are two properties, as
  in CompetencyFramework.Competency and Course (README_ERRATA E4).
- No LIF name is a reserved segment (`codeList`, `inline`, `items`, `allOf`, `anyOf`, `oneOf`, `definitions`, `enum`), measured 2026-10-24.
- A name the pattern does not admit is refused at mint, never repaired.
