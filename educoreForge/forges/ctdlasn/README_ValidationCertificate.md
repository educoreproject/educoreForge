# Validation certificate — CTDL-ASN (Credential Transparency Description Language — Achievement Standards Network)

**CTDLASN 20230929 was built from its one JSON-LD schema file. The graph has 119 nodes and 280 edges.**
**It is the July 2026 CTDLASN graph, re-forged on the current framework, node for node and edge for edge.**

Accuracy was checked two ways:

- **Against the source.** The live graph was read back into source statements and compared, one by one, with an independent reading of the JSON-LD file. Nothing was invented and nothing was lost. The kinds of statement this graph deliberately does not carry yet are declared and listed below.
- **Against the July graph.** The census of the new graph was compared with the census of the July graph (`GOLD_EVAL_260718`). Every difference is one the port was ruled to make, and there are no others.

| | |
|---|---|
| standard | CTDL-ASN (Credential Transparency Description Language — Achievement Standards Network) (bundle `ctdlasn`, `_source` `CTDLASN`, family `CTDLASN`) |
| source | `assets/standardSourceData/01/ctdlasn.json`, sha256 `8bacfcec…a0b7`, checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | `https://credreg.net/ctdlasn/schema/encoding/json` |
| graph | `DEV_gb_materialize_3768_2`, a scratch graph built 2026-10-20 and disposed after its census |
| build | recipe `recipes/ctdlasnOnlyRoundTrip.recipe.jsonc`, `--vectorize=false`, manifest `ad7739a5…d1fd07`, standardBase block **`2145d170eab3ad6b0ad8fbbe3b6229d093d395f8f06752d6475520218b4842e3`** |
| certification | `graphBuilder -goldEvalCheck`: **PASS** (1 declared validator, inventedTotal 0; no bridge, no judged edge) |
| oracle | `apps/graph-builder/tools/oracleDiff.js` against `dataStores/ctdlHub_101926/oracle/CTDLASN.census.json`: **PASS, 0 unexplained differences** |
| structure | `apps/graph-builder/tools/graphStructureCheck.js`: all five checks **PASS**; every content node is reachable from the root |
| commit | branch `ctdlHub/forges` (ctdlHub-101926 phase P2) |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the standard | DmeStandardRoot | `CtdlasnRoot` | 1 |
| `rdfs:Class` (including the W3C `skos:Concept` and `skos:ConceptScheme` the source declares as its own) | DmeClass | `CtdlasnClass` | 11 |
| `rdf:Property` | DmeProperty | `CtdlasnProperty` | 97 |
| `skos:ConceptScheme` | DmeOptionSet | `CtdlasnConceptScheme` | 2 |
| `skos:Concept` | DmeOptionValue | `CtdlasnConcept` | 8 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → class | (every class) | 11 |
| `HAS_PROPERTY` | class → property | `schema:domainIncludes` | 203 |
| `REFERENCES` | property → class | `schema:rangeIncludes` | 54 |
| `HAS_OPTION_SET` | property → concept scheme | `meta:targetScheme` | 2 |
| `HAS_VALUE` | concept scheme → concept | `skos:inScheme` | 8 |
| `SUBCLASS_OF` | class → class | `rdfs:subClassOf` | 2 |

A node's identifier is its CURIE as the source writes it.
- **References outside CTDLASN:** every one is kept **as written** in the node's `crossRefs`, as `{ raw, locator }` (349 references). Nothing is resolved and no owner is assigned.
- **Other vocabularies' terms:** the entries in which the file describes them are kept whole on the root, in `foreignTermEntryList`: the 4 CTDL terms (`ceterms:ctid`, `industryType`, `instructionalProgramType`, `occupationType`) the file re-describes. They are not nodes.
- **Version:** the root's `version` is the published version the provenance record states, `20230929`. The July graph's `Release 20230929` was hard-coded (ruling V2).

## The counts

The round trip compared 1,532 source statements. 1,320 matched the graph exactly, and 212 are **declared** as not yet carried. The July graph never held them, and phase P2b adds them:

| Kind | Count | What it is |
|---|---:|---|
| `changeHistory` | 118 | each term's `meta:changeHistory` link |
| `unresolvedNativePrefixReference` | 35 | references to `asn:` terms of the **external** ASN vocabulary (e.g. `owl:equivalentClass asn:Rubric`): the July allowlist claims all of `asn:` but this file defines only 4 `asn:` terms |
| `secondaryDescription` | 28 | an `rdfs:comment` or `skos:definition` that differs from the description the node shows |
| `nativeReferenceNotModelled` | 28 | `rdfs:subPropertyOf` 10, `skos:hasTopConcept`/`topConceptOf` 8/8, `owl:inverseOf` 2 |
| `schemeStatus` | 2 | `vs:term_status` on concept schemes |
| `usageNoteOffProperty` | 1 | a `vann:usageNote` on a non-property |

## Round Trip Validation

The validator (`roundTripValidator.js`, with the shared pair `lib/ctdl-family-forge/jsonLdRoundTripPair.js`) reads the JSON-LD on one side and the live graph on the other, and compares every value inside each statement's key. The result is **inventedTotal 0, lostTotal 0, roundTripClean true**. It was made to fail on purpose (`test/test-ctdlasnForge.js`): a dropped edge and a dropped crossRef each showed up in the verdict.

## Known issues

- **The 35 `asn:` references are dropped, not carried.** They name the external ASN vocabulary. P2b (item E11) carries them as crossRefs.
- **CTDL-ASN imports W3C SKOS terms as its own** (`skos:Concept`, `skos:ConceptScheme` and 17 `skos:*` properties), exactly as the July graph did. Whether it should is TQ's question Q-T5.

## For more information

- The port's decisions and traps: `system/management/zNotesPlansDocs/ctdlHub-101926/DEVLOG-forges.md`.
- The ratified differences from the July graph: `system/dataStores/ctdlHub_101926/oracle/A3-candidateList.md`.
