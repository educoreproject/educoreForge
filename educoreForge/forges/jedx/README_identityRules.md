# JEDx: how stableIds are minted, and why they are stable

The forge is `forges/jedx` on the OpenAPI kit (`lib/openapi-forge`, layout `dereferencedMultiFile`, step K1). The kit's
`openapiIdentity.js` owns the identity rule; this file says what it produces for JEDx. Every id is a pure function of the
source's NAMES and JSON positions. None comes from a counter, a clock or a file order.

All counts were measured on snapshot 02 on 2026-10-24.

`stableUriPropertyName` is `jedxStableId`. The prefix is `jedx:`.

| node | stableId | count | natural key |
|---|---|---|---|
| the root | `jedx:root` | 1 | declared |
| a component schema | `jedx:<Component>` | 149 | the `components.schemas` member name, e.g. `jedx:WorkerType` |
| a property of a schema | `jedx:<Component>/<property>` | 665 | (component, property name) |
| a code-list component | `jedx:codeList/<Name>` | 42 | the component name; the set is owned by the root |
| a code-list value | `jedx:codeList/<Name>/<member>` | 1,201 | (code list, enum member) |
| an inline object that equals no component | `jedx:<Owner>/<property>/inline`; array items `…/items`; a composition branch `…/allOf/<n>` | 16 | the owner and the JSON position of the site |
| a property of such an inline class | `<inline class id>/<property>` | 29 | (inline class, property name) |
| a property-local enum | `<property id>/enum`; its members `…/enum/<member>` | 15 / 95 | the property, then the member |
| an embed-text node | `jedx:root/embedText/<sha256>` | 1,381 | the framework's text digest |

## Why these are stable, and the hazards handled

- **One model across four files.** A component is identified by its NAME, not by the bundle that holds it. When a name appears in
  several bundles, its content must be byte-identical as canonical JSON; a conflict would be refused by name, and there are 0 such
  conflicts today. Which files hold the component is DATA (`bundleMembership`, a sorted JSON list), so it never enters the id. Adding
  or dropping a bundle therefore changes no other component's id.
- **A reference is recovered by CONTENT, never by title.** An inline copy that equals exactly one component (top-level `description`
  aside) becomes a REFERENCES edge to that component's id, and no new node is minted for it. There are 609 such sites; in 6 of them
  two components tie (`confirmMessageType` / `ConfirmMessageType`), and the copy's `title` breaks the tie. Titles cannot identify
  components in JEDx: some components carry another type's title (README_ERRATA E10). An id built from a title would bind sites to the
  wrong type.
- **Reserved segments.** `codeList`, `inline`, `items`, `allOf` and `definitions` are id segments. A component named after one of them
  is refused by name, so the class space and the code-list space cannot collide. No component is named that way today.
- **Members that are not id-safe.** A member containing spaces, commas or slashes is percent-encoded in the id segment only; its
  `name` stays verbatim. Examples: `Joint Venture` → `jedx:codeList/ResponsibilityCodeList/Joint%20Venture`, and
  `bs, hr, or sr` → `…/LanguageCodeList/bs%2C%20hr%2C%20or%20sr`.
- **Determinism.** `test/test-jedxForge.js` SECTION 4 forges twice and compares the results byte for byte.
