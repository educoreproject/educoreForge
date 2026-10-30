# Identity rules — the use-case forge (`forges/usecase`)

Every node's `stableId` is a pure function of the snapshot's case documents. `stableUriPropertyName` is `usecaseStableId`; the root is
`usecase:root`. The rules (ratified in `system/management/zNotesPlansDocs/useCaseForge-102926/DESIGN-0-identityAndUri-102926.md`):

| node | stableId | why it is stable |
|---|---|---|
| a use case | the corpus `id` verbatim (`uc:ler-issuance`) | the author's opaque graph key (v011-spec.md, UseCase `id`) |
| a shared node with an identifier: story `us:`, actor `actor:` / `ip:`, condition `cond:`, event `event:`, value driver `vd:`, subject `subj:`, intermediate `intermediate:`, artifact `artifact:`, orphan `orphan:`, resource (any ratified namespace) | the identifier verbatim | the editor registers it; one identifier, one node (v0.11 rule 3) |
| a declared subject constituent | its token verbatim | as above |
| an element citation of another standard | `usecase:ref/<registryKey>/<local>` | `<local>` is the author's identifier when it is a plain token, else its remainder after the registry entry's own `shorthandExpansion` head (two CEDS citations give the full term IRI `https://w3id.org/CEDStandards/terms/NI…`). The author's identifier rides verbatim as `citedIdentifier`. |
| a whole-standard citation | `usecase:ref/<registryKey>` | one per registry key |
| an anonymous story | `usecase:story/<case local part>/step.<codedNotation>` | owner + the step's handle |
| an anonymous condition | `usecase:condition/<case>/assumes.<n>` or `/guarantees.<n>` | owner + file position |
| an anonymous event, value driver, subject, actor, resource | `usecase:<kind>/<case>/<slot>.<n>` (`triggeredBy`, `subject` where the slot is single) | owner + file position |
| an anonymous artifact citation | `usecase:artifact/<case>/<site of first use>`, one per artifact NAME corpus-wide | the standard's own key for an artifact without an identifier is its name |

`stableIdPattern` admits exactly the ratified namespace enumeration (`v011-schema.json $defs.namespacePrefix`) plus `uc:`, with the
schema's own identifier body, and the forge's `usecase:` forms; anything else is refused by name, never repaired.

**Not stable by construction, and said so.** An anonymous node's id moves when its author reorders the file or renumbers a step; the
editor's identity desk is where such a node earns an identifier, and that is a new node by design (identity is adjudicated, never
text-matched). A reference node's id moves only if the cited standard's identifier does.

**The URI** of every node is the graph's element URI, `https://w3id.org/EDUcore/UseCase/<release>/<stableId>` (release `1.0` for
snapshot 01). A new release mints new URIs; an author-identified node keeps its stableId across releases.

**Collision hazard, handled:** two inline definitions under one identifier must be canonical-JSON identical (an actor: one display
name, and one `kind` within the `actors` slot), and an element or intermediate identifier carries one name; otherwise the forge refuses
naming both sites (`identifier conflict`).
