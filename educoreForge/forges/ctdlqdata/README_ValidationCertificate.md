# Validation certificate — CTDL-QData (Credential Transparency Description Language — Quantitative Data)

**CTDLQData 20260130 was built from its one JSON-LD schema file. The graph has 215 nodes and 402 edges.**
**It is the July 2026 graph, re-forged on the current framework, plus everything the source says about its own terms that the July forge dropped (phase P2b): nothing in the source is now left out.**

Accuracy was checked two ways:

- **Against the source.** The live graph was read back into source statements and compared, one by one, with an independent reading of the JSON-LD file. Nothing was invented and nothing was lost. The kinds of statement this graph deliberately does not carry yet are declared and listed below.
- **Against the July graph.** The census of the new graph was compared with the census of the July graph (`GOLD_EVAL_260718`). Every difference is one the port was ruled to make, and there are no others.

| | |
|---|---|
| standard | CTDL-QData (Credential Transparency Description Language — Quantitative Data) (bundle `ctdlqdata`, `_source` `CTDLQData`, family `CTDLQData`) |
| source | `assets/standardSourceData/01/qdata.json`, sha256 `7a60c290…967d69`, checked against `SHA256SUMS` at every build. Provenance: `assets/standardSourceData/01/README_PROVENANCE.md` |
| source URL | `https://credreg.com/qdata/schema/encoding/json?includemetaproperties=false` |
| graph | `DEV_gb_materialize_4659_2`, a scratch graph built 2026-10-20 and disposed after its census |
| build | recipe `recipes/ctdlqdataOnlyRoundTrip.recipe.jsonc`, `--vectorize=false`, manifest `b3c89e52…e3f4b66f`, standardBase block **`89e25a2a7f82398ac5783a5da185c5e039575f10fc2887814aa55e606e0f4c0a`** (P2b, head `52747113`; every earlier block and each move is listed in `DEVLOG-P2b.md`) |
| certification | `graphBuilder -goldEvalCheck`: **PASS** (1 declared validator, inventedTotal 0; no bridge, no judged edge) |
| oracle | `apps/graph-builder/tools/oracleDiff.js` against `dataStores/ctdlHub_101926/oracle/CTDLQData.census.json`: **PASS, 0 unexplained differences** |
| structure | `apps/graph-builder/tools/graphStructureCheck.js`: all five checks **PASS**; every content node is reachable from the root |
| commit | branch `ctdlHub/forges` (ctdlHub-101926 phase P2) |

---

## What is in the graph

| In the source | DME role | Label | Count |
|---|---|---|---:|
| the standard | DmeStandardRoot | `CtdlqdataRoot` | 1 |
| `rdfs:Class` | DmeClass | `CtdlqdataClass` | 11 |
| `rdf:Property` | DmeProperty | `CtdlqdataProperty` | 82 |
| `skos:ConceptScheme` | DmeOptionSet | `CtdlqdataConceptScheme` | 8 |
| `skos:Concept` | DmeOptionValue | `CtdlqdataConcept` | 113 |

| Edge | From → to | Source statement | Count |
|---|---|---|---:|
| `HAS_CLASS` | root → class | (every class) | 11 |
| `HAS_PROPERTY` | class → property, and root → the 5 properties with no domain | `schema:domainIncludes` | 108 |
| `REFERENCES` | property → class | `schema:rangeIncludes` | 37 |
| `HAS_OPTION_SET` | root → concept scheme (no property names one) | (every scheme) | 8 |
| `HAS_VALUE` | concept scheme → concept | `skos:inScheme` | 113 |
| `BROADER_CONCEPT` | concept → broader concept | `skos:broader` | 52 |
| `TOP_CONCEPT_OF` | concept → scheme it heads | `skos:topConceptOf` | 61 |
| `SUBPROPERTY_OF` | property → property | `rdfs:subPropertyOf` | 2 |
| `RELATED_CONCEPT` | concept → concept | `skos:relatedMatch` between QData concepts (not a mapping) | 10 |

A node's identifier is its CURIE as the source writes it.
- **References outside CTDLQData:** every one is kept **as written** in the node's `crossRefs`, as `{ raw, locator }` (178 references). Nothing is resolved and no owner is assigned.
- **Other vocabularies' terms:** the entries in which the file describes them are kept whole on the root, in `foreignTermEntryList`: the 31 CTDL terms (7 classes including `ceterms:Credential`, 24 properties) the file re-describes. They are not nodes.
- **Version:** the root's `version` is the published version the provenance record states, `20260130`. The July graph's `Release 20260130` was hard-coded (ruling V2).

## The counts

The round trip compared 1,594 source statements, and **all 1,594 matched the graph**. Nothing is declared omitted (`explicitlyOmittedTotal` 0).

Phase P2b added what the July forge dropped, one kind per commit:
- the concept and property hierarchies, top concepts and inverse properties, as the edges above;
- second description texts (`rdfsComment`, `skosDefinition`), never merged into `description`;
- the change-history link (`changeHistoryUrl`);
- status on concept schemes, and usage notes on every role;
- probable source anomalies, verbatim, in `nativeDeclarationAnomalyList` (CTDL only);
- references to undefined terms under a claimed prefix, as crossRefs (E11).

## Round Trip Validation

The validator (`roundTripValidator.js`, with the shared pair `lib/ctdl-family-forge/jsonLdRoundTripPair.js`) reads the JSON-LD on one side and the live graph on the other, and compares every value inside each statement's key. The result is **inventedTotal 0, lostTotal 0, roundTripClean true**. It was made to fail on purpose (`test/test-ctdlqdataForge.js`): a dropped edge and a dropped crossRef each showed up in the verdict.

## Known issues

- **`schema:` belongs to QData only where QData defines the term.** The 10 `schema:` terms in `qdata.json` are nodes; a reference to any other `schema:` term is a crossRef. This reproduces the July graph's 10 `schema:*` nodes exactly.
- **The source encoding carries no `meta:*` predicates** (`includemetaproperties=false`), so there is no `meta:domainFor` or `meta:hasConcept` to read back.

## For more information

- The port's decisions and traps: `system/management/zNotesPlansDocs/ctdlHub-101926/DEVLOG-forges.md`.
- The ratified differences from the July graph: `system/dataStores/ctdlHub_101926/oracle/A3-candidateList.md`.
