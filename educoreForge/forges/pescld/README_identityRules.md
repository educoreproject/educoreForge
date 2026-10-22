# PESC_LD forge: identity rules

`stableUriPropertyName` is `pescldStableId`; the root is `pescld:root`. Every id is a pure function of the CSV snapshot; nothing
comes from a counter, a clock or run state. **A borrowed IRI is never a stableId** (WORKORDER-C; the evidence's A6): most PESC_LD
rows constrain a term another standard owns, so keying a node on that term would put it in the owning standard's identity space.
The borrowed term rides on the node as `termCurie` and `termIri` instead.

| role | one per | stableId | why it is stable |
|---|---|---|---|
| DmeClass | `shapes.csv` record (a SHACL NodeShape) | `pescld:shape/<shapeID>` | `shapeID` is the publisher's own shape name and the TTL's NodeShape IRI; refused when empty, repeated or whitespace-bearing |
| DmeProperty | distinct (`shapeID`, `propertyID`) over the seven TAP files (a PropertyShape) | `pescld:shape/<shapeID>/<propertyID>` | the pair is the TTL's PropertyShape key (one-to-one, measured); the TTL's own PropertyShape IRIs are derived from labels and are NOT used |
| DmeOptionSet | non-empty picklist cell | `pescld:picklist/<shapeID>/<propertyID>` | a picklist has no identity of its own; it is its row's |
| DmeOptionValue | distinct value in that cell | `pescld:picklist/<shapeID>/<propertyID>/<value>` | the value as written (after the whitespace rule) |
| DmeEmbedText | distinct text (framework) | `pescld:root/embedText/<sha256>` | minted by the framework from the text |

The declaration's `stableIdPattern` admits exactly these forms (`lib/pescldForgeDeclaration.js`); the kit refuses any other.

**Collision hazards, handled.** The retired attic PESC forge owned `pesc:` stableIds and `_source 'PESC'`; this bundle's `pescld:`
prefix and `PESCLD` source keep the two apart. The same borrowed term appears on several shapes (a row per shape), which is why
rows key on the pair and never on the term. A (shape, property) pair stated in two TAP files is ONE node (the duplicate rule in
`lib/pescldWalk.js`), carrying both file names in `sourceTabs`.
