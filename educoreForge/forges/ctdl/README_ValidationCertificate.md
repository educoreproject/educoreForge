# Validation certificate — CTDL (Credential Transparency Description Language)

**CTDL Release 20260327 was built from its one JSON-LD schema file. The graph has 994 nodes and 10,131 edges.**
**It is the July 2026 CTDL graph, re-forged on the current framework, node for node and edge for edge, plus 12 edges that make every node reachable from the root.**

Accuracy was checked two ways:

- **Against the source.** The live graph was read back into source statements and compared, one by one, with an independent reading of the JSON-LD file. Nothing was invented and nothing was lost. The kinds of statement this graph deliberately does not carry yet are declared and listed (below).
- **Against the July graph.** The census of the new graph was compared with the census of the July graph (`GOLD_EVAL_260718`, the graph production serves). Every difference is one the port was ruled to make, and there are no others.

| | |
|---|---|
| standard | CTDL Release 20260327 (bundle `ctdl`, `_source` `CTDL`, family `CTDL`, DME title `Credential Transparency Description Language (CTDL)`) |
| source | `assets/standardSourceData/01/ctdl-schema.json`, sha256 `03715222…49eb42`, checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | `https://credreg.net/ctdl/schema/encoding/json` (retrieved 2026-06-23) |
| graph | `DEV_gb_materialize_29392_2`, a scratch graph built 2026-10-20 and disposed after its census |
| build | recipe `recipes/ctdlOnlyRoundTrip.recipe.jsonc`, `--vectorize=false`, manifest `d841e13b…54ee4dcc`, standardBase block **`3d8b12186d70d44a03c03c6dceb4b0b8dc13960b3d766182543b26639b375458`** |
| certification | `graphBuilder -goldEvalCheck` on the build's run directory: **PASS** (1 declared validator, inventedTotal 0; no bridge, no judged edge) |
| oracle | `apps/graph-builder/tools/oracleDiff.js` against `dataStores/ctdlHub_101926/oracle/CTDL.census.json`: **PASS, 0 unexplained differences** |
| commit | branch `ctdlHub/forges` (ctdlHub-101926 phase P1) |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the standard | DmeStandardRoot | `CtdlRoot` | 1 |
| `rdfs:Class` | DmeClass | `CtdlClass` | 136 |
| `rdf:Property` | DmeProperty | `CtdlProperty` | 378 |
| `skos:ConceptScheme` | DmeOptionSet | `CtdlConceptScheme` | 34 |
| `skos:Concept` | DmeOptionValue | `CtdlConcept` | 445 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → class | (every class) | 136 |
| `HAS_PROPERTY` | class → property | `schema:domainIncludes` | 7,076 |
| `HAS_PROPERTY` | root → property | (each of the 12 properties with no CTDL domain; the July graph left them unreachable) | 12 |
| `REFERENCES` | property → class | `schema:rangeIncludes` | 2,339 |
| `HAS_OPTION_SET` | property → concept scheme | `meta:targetScheme` | 41 |
| `HAS_VALUE` | concept scheme → concept | `skos:inScheme` | 445 |
| `SUBCLASS_OF` | class → class | `rdfs:subClassOf` | 82 |

A node's identifier is its CURIE as the source writes it (`ceterms:Credential`, `audience:Resident`).

**What the graph carries that is not CTDL's own.**

- Every reference a CTDL term makes to a term outside CTDL is kept **as written** in the node's `crossRefs`, as `{ raw, locator }`: 562 references, such as `xsd:string` ranges, `schema:` equivalents, and CTDL-ASN and CTDL-QData domains. Nothing is resolved and no owner is assigned.
- CTDL's 53 declarations about CEDS (26 `owl:equivalentClass`, 22 `skos:narrowMatch`, 5 `skos:relatedMatch`, on 52 concepts) are kept as written in `declaredCorrespondenceList`. They are **not** match edges.
- The 20 entries in which the CTDL file describes other vocabularies' terms (7 `ceasn:`, 4 `qdata:`, 8 `schema:`, `owl:sameAs`) are kept whole on the root, in `foreignTermEntryList`. They are not nodes.

## The counts

The source has 1,013 `@graph` entries: 993 CTDL terms and 20 foreign entries. The round trip compared 24,463 source statements: 22,146 matched the graph exactly and 2,317 are declared as not yet carried.

The 2,317 **declared** statements are below. The July graph never held them; phase P2b of this lane adds them:

| Kind | Count | What it is |
|---|---:|---|
| `changeHistory` | 993 | each term's `meta:changeHistory` link |
| `nativeReferenceNotModelled` | 942 | concept `skos:broader`/`narrower` (98/98, plus 1 `broader` to a scheme), `skos:topConceptOf`/`hasTopConcept` (346/346), property `rdfs:subPropertyOf` (37), `owl:inverseOf` (12), and 4 references whose target type no edge expresses (3 `meta:targetScheme` → a class, 1 `owl:equivalentProperty` → a class) |
| `secondaryDescription` | 265 | an `rdfs:comment` or `skos:definition` that differs from the `dct:description` the node shows |
| `usageNoteOffProperty` | 62 | `vann:usageNote` on classes, schemes and concepts (properties carry theirs) |
| `schemeStatus` | 34 | `vs:term_status` on concept schemes |
| `undefinedNativeTarget` | 21 | references to CTDL terms the file never defines: 12 × `rdfs:subPropertyOf ceterms:credentialAlignment`, 8 × `schema:domainIncludes ceterms:FinancialAlignmentObject`, 1 × `schema:rangeIncludes ceterms:TransferValueAgreement`. **This is a defect in the source**, listed by name in the verdict |

## Round Trip Validation

The validator (`roundTripValidator.js`, pair `lib/ctdl-family-forge/jsonLdRoundTripPair.js`) reads the JSON-LD on one side and the live graph on the other. It compares type, label, primary description, usage note, status, and every IRI each term references, with the value in each statement's key. On the graph side, native references are read back from the edges that express them. Non-native ones are read from `crossRefs` and `declaredCorrespondenceList`; foreign entries from the root. The result is **inventedTotal 0, lostTotal 0, roundTripClean true**.

The instrument was seen to fail on purpose four ways (`test/test-ctdlForge.js`): a dropped edge, an altered description, a dropped crossRef, and a retargeted CEDS declaration. Each one showed up in the verdict.

## Known issues

- **The concept hierarchy and the property hierarchy are not in the graph.** A query cannot yet walk `skos:broader` or `rdfs:subPropertyOf` (942 statements; see the counts). Scheduled: P2b.
- **Only one description per term.** Where CTDL gives both `dct:description` and `rdfs:comment`, the node shows the first, and the other text is not carried (265). Scheduled: P2b.
- **The CEDS declarations are data, not links.** Nothing joins a CTDL concept to a CEDS node yet. That is the declared-seam bridge, a later phase. Whether any of them may become match edges is TQ's question Q-T1.
- **The source refers to three CTDL terms it never defines** (21 references, listed above). The graph cannot make those references into edges.

## Provenance

The source is the CTDL schema in its JSON encoding, Release 20260327, copied byte for byte from the July forge's snapshot. Credential Engine's current release is 20260626. Moving to it is a separate, deliberate phase (P9), not a silent upgrade.

## For more information

- `README_ValidationDetail.md` does not exist yet. The port's decisions and traps are in `system/management/zNotesPlansDocs/ctdlHub-101926/DEVLOG-forges.md`.
- The ratified differences from the July graph: `system/dataStores/ctdlHub_101926/oracle/A3-candidateList.md`.
