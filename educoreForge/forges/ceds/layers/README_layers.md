# CEDS layers

**What a layer is.** A separately published, separately versioned companion of CEDS, forged as its OWN block (kind `layer`)
beside the CEDS base block, never written onto it. Its nodes carry `_source: 'CEDS'`, the label `StandardLayer` and a layer
role (`DmeLayerRoot`, `DmeArea`, `DmeLayerElement`, `DmePlacement`, `DmeConcept`, `DmeTextRepair`); its edges may land on
CEDS base nodes, resolved by stableId exactly as relationship edges are. It requires exactly the CEDS base block, and it never
relates CEDS to another standard (FBB-001). Lane DES, campaign cedsRichness-101226, 2026-10-12 (TQ rulings 1-3; COPPER_RIVER's
design word, amendments A-C). Design: `system/management/zNotesPlansDocs/cedsRichness-101226/DESIGN-DES-cedsStructureLayer-101226.md`.

| layer | block subject | source | what it adds |
|---|---|---|---|
| `des` | `ceds@14_0_0_0_layer_des@13` | CEDS-V13.0.0.0.xlsx (CEDS-Elements 6186c00) | the Domain Entity Schema V13: 13 DES domains, 75 entities, 523 category nodes, 1,965 elements with their V13 prose, 5,110 placements; 4,907 placements reach a V14 property by Global ID, 28 DES-only elements are counted, never dropped |
| `guide` | `ceds@14_0_0_0_layer_guide@14` | CEDS Ontology Guide V14, Appendix A (CEDS-Ontology 77e1ef1) | 8 Conceptual Model concepts; class -> primary concept (400), secondary (191); 204 event-date properties (418 concept edges) |
| `textRepair` | `ceds@14_0_0_0_layer_textRepair@14_0_0_0` | CEDS IDS v14.0.0.0 DDL and reference data | 834 repairs of U+FFFD-damaged text, beside the faithful text (README_sourceExceptions.md case 12) |

**How a layer is declared and built.** `layers/<layerKey>/layerDescriptor.ini` declares it (capability); a recipe's
`layers: [{ standard, layer }]` activates it. The forger produces it over the CEDS base as just shaped
(`lib/layer-framework`, which owns the root, the ids, the stamps and the integrity refusals); build.js Phase A2 mints its block
in the working graph that still holds the base and adds it to the manifest requiring the base. Ids:
`<layerNamespace><layerKey>/<layerVersion>/<kind>/<natural id>`, the namespace declared once in `parserDescriptor.ini`.

**Round trips.** Each layer declares its own `roundTripValidator.js` and the RT-13 stage runs it against the materialized graph
(token `ceds:<layerKey>`), so `-goldEvalCheck` certifies layers exactly as it certifies standards: des re-emits every cell of
the workbook's four sheets; guide every cell of its three tables; textRepair recomputes every repair decision from the IDS and
the live base. CEDS's own round trip is unchanged (layers are invisible to its role-scoped compiler) and now carries gate D, the
CEDS-Elements V14 workbook, inside its verdict.

**Readers.** A reader counting or listing CEDS excludes `StandardLayer` (graph contract `layerScopeRule`). In the DME the layers
are reached through `dme_structure`.

**Traps.** `README_PROVENANCE.md` in each snapshot names its own; the big ones: the V14 guide is not at the V14.0.0.0 tag; the
V13 workbook is not at CEDS-Elements HEAD; the URL column is a formula; Global ID is text with leading zeros; the IDS populate
script is Windows-1252 and its first INSERT for a guard wins.
