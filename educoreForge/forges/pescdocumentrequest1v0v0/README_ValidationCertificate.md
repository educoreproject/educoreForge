# Validation certificate — PESC Document Request v1.0.0

**PESC Document Request 1.0.0 was built from its 4 XSD files: the message schema and the exact library editions it
names (AcademicRecord 1.14.0, CoreMain 1.19.1, iso_3166-1 1.0.0). The graph has 8,253 nodes and 10,661 edges.**
**The graph holds the 4 files exactly, at the level of XML content.** Accuracy was confirmed by a round trip: all
4 files were regenerated from the live graph alone and compared, statement by statement, with the source files read by
an independent XML reader. Nothing was missed and nothing was invented. The regenerated files compile.

| | |
|---|---|
| standard | PESC Document Request 1.0.0 (bundle `pescdocumentrequest1v0v0`, `_source` `PESC-DocumentRequest-1.0.0`, DME title `PESC Document Request v1.0.0`) |
| source | `assets/standardSourceData/01/`: `AcademicRecord_v1.14.0.xsd`, `CoreMain_v1.19.1.xsd`, `DocumentRequest_v1.0.0.xsd`, `iso_3166-1_v1.0.0.xsd` (CoreMain `5ade5560…`), and the expander's `releaseManifestEntry.json`, every file checked against `SHA256SUMS` at every build. Provenance: `README_PROVENANCE.md` |
| graph | `DEV_pescDocumentRequest1v0v0` (a scratch graph; bolt 7823; STOPPED after these checks under the PESC memory budget, `docker start` it to look), 2026-10-01 |
| build | recipe `recipes/pescdocumentrequest1v0v0Only.recipe.jsonc` (the release alone, `roundTripStage: true`), manifest `5f6f6c5d…f17ed900`, standardBase block **`b68b8e53a4ca0f016c27ec10a078fa6d199fbd9d182bc9f6f1f4e60d73fbb709`** |
| reproduced | the same block and manifest from **two** builds of the recipe (`f6Build1` at head `b7d4337`, `f6Build2` at head `9f2d3b8`, the second's graph `DEV_pescDocumentRequest1v0v0_repro`, stopped); the certifying build is the first |
| certification | `graphBuilder -goldEvalCheck` on `f6Build1`'s run directory: **PASS** (1 declared validator, inventedTotal 0; no bridge, no judged edge) |
| commit | branch `pescRelease/F6` at `d3e048f` (PESC phase F6) |

---

## What is in the graph

| in the graph | label (`PescDocumentRequest1v0v0…`) | DME role | count |
|---|---|---|---:|
| named complex types | `Type` | DmeClass | 226 |
| anonymous complex types | `AnonymousType` | DmeClass | 13 |
| element declarations (each in its owning type, by position) | `Element` | DmeProperty | 1,265 |
| attribute declarations | `Attribute` | DmeProperty | 6 |
| global elements (one is the document root) | `GlobalElement` | DmeProperty | 11 |
| **occurrences**: one per place an element can appear in a document, derived | `Occurrence` | DmeSupport | 733 |
| code lists (202 named, 17 anonymous) | `CodeList` | DmeOptionSet | 219 |
| codes | `Code` | DmeOptionValue | 2,741 |
| data types (576 named, 25 anonymous) | `DataType` | DmeSupport | 601 |
| groups | `Group` | DmeSupport | 9 |
| schema files | `SchemaFile` | DmeSupport | 4 |
| the release record (the expander's manifest entry) | `Release` | DmeSupport | 1 |
| search texts, embedded with `voyage-4-large` | `EmbedText` | DmeEmbedText | 2,423 |
| the standard's root | `Root` | DmeStandardRoot | 1 |

| edge | from → to | count |
|---|---|---:|
| `HAS_CLASS` | root → named complex type | 226 |
| `HAS_PROPERTY` | type, anonymous type or group → element or attribute | 1,271 |
| `REFERENCES_TYPE` | declaration → its named complex type (348) or data type (658) | 1,006 |
| `HAS_OPTION_SET` | declaration → its code list (167 named, 17 anonymous) | 184 |
| `HAS_VALUE` | code list → code | 2,741 |
| `SUBCLASS_OF` | derived type → base (51 extension, 59 restriction) | 110 |
| `REFERENCES` | owner → group it references (20); global element → substitution head (8) | 28 |
| `HAS_SUPPORT` | root → release record, schema files, groups | 14 |
| `HAS_INSTANCE` | element declaration → each of its occurrences | 733 |
| `HAS_CHILD` | parent occurrence (the root global element at the top) → occurrence: the document tree | 733 |
| `EMBEDS_TEXT_OF` | search text → the node it describes | 3,615 |

**Reachability.** 198 of the 1,265 element declarations can appear in a Document Request document
(198 through content and extension bases); they carry `reachableFromRoot: true`, their paths, and
733 occurrences in 23 document sections (deepest at document depth 7). The other
1,067 are library content no such document contains; they stay in the graph, marked `false`. 141 named types and
groups are reachable.

**Code lists, on their elements.** Each of the 167 element declarations typed by a named code list carries the list's `codeListName`
(167 measured live), and 167 carry its `codeListDocumentation` (a list without documentation gives none). The
17 typed by an anonymous list carry neither. Neither property is a search text, and the round trip does not read them.

Every vector (3,945) names `NULL`. Occurrences carry no text and no vector (0 measured).

**Not present:** any mapping to CEDS or to any other standard. The forge does no bridging.

---

## Accuracy

```
source ........................ 4 XSD files, read by an independent sax reader (not the forge's parser)
regenerated from the graph .... 4 XSD files, read by the same reader
invented ...................... 0
lost .......................... 0
content gaps .................. 0
explicitly omitted ............ 29,403 = 884 XML comments + 28,515 whitespace runs + 4 XML declarations
regenerated root, xmllint ..... compiles (a probe document "fails to validate", exit 3, as with the source files)
```

The comparison is on resolved qualified names (a prefix is not content, on attribute names as on QName values) and covers every
definition, import and schema-level annotation in document order, every element, attribute, group reference and wildcard in its
compositor position (14 nested `xs:choice` groups included), every attribute as written, every facet and
enumeration value, and every documentation string verbatim. This release carries 2 element documentation strings that are empty or a second documentation, 1 schema-level annotation that follows the imports; each is regenerated in its place. Before phase F6 taught the forge these shapes the
round trip of this release found 3 content gap(s). The validator read the graph through the framework's live reader; the
verdict is the build's own stage. It is also measured hermetically on every test run (`test/test-release.js`, phase F4 gates).

**Measured live on `DEV_pescDocumentRequest1v0v0`** (read-only Cypher): 8,253 nodes and 10,661 edges scoped `_source = 'PESC-DocumentRequest-1.0.0'`;
the DME's own standards query (`MATCH (r:DmeStandardRoot) RETURN r._source, r.standardName, r.version`) returns "PESC-DocumentRequest-1.0.0", "PESC Document Request v1.0.0", "1.0.0"; the root has
14 `HAS_SUPPORT` targets; no occurrence has an embedding, a text embedding or a search text. Spend: embedding only (the shared vector cache held 325371 entries before the certifying build and 326542 after it).

---

## The test against a real document (F17, no-sample form)

**No public Document Request 1.0.0 document was found** (searched 2026-10-01; the known PESC samples of this family are of other
releases, and no sample is validated against a release it was not written for). The content-level round trip and the `xmllint`
compile of the regenerated files are the proof for this release.

---

## Known problems

**1. The DME does not show the occurrences or their mappings yet.** It does not traverse `HAS_INSTANCE` or `HAS_CHILD` (SIF plan
phase E3). Whether the DME views handle a `GlobalElement` (DmeProperty) as the parent of `Occurrence` (DmeSupport) nodes is
unchecked: the DME was not run.

**2. Whole numbers are stored as floating point**, as for CEDS, SIF and College Transcript 1.8.0.

**3. One-element lists are stored as plain strings** (`occurrenceSectionList`, `contextPathSampleList`, `reachableVia`,
`documentationValueList`); a reader must re-widen.

**4. An occurrence's framework `depth` is its `documentDepth` + 1.**

**5. Not modelled by the round trip, by statement:** XML comments, whitespace, the XML declaration, the files' xmlns prefix
declarations, and the order of facets inside one restriction.

---

## More detail

| document | what it holds |
|---|---|
| `lib/pesc-release-forge/roundTripPair.js` | the round trip's two sides and its diff, including what it does not model |
| `management/zNotesPlansDocs/PESC/pescForgeBridgeBuild-093026/DEVLOG-F6.md` | these builds, the commands that reproduce them, and every live check above |

Figures measured 2026-10-01 from the builds named above (written by `evidence/F6/writeCertificate.py`).
