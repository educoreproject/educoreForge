# Validation certificate — PESC Test Score Report v1.1.0

**PESC Test Score Report 1.1.0 was built from its 4 XSD files: the message schema and the exact library editions it
names (AcademicRecord 1.11.0, CoreMain 1.17.0, iso_3166-1 1.0.0). The graph has 8,898 nodes and 11,719 edges.**
**The graph holds the 4 files exactly, at the level of XML content.** Accuracy was confirmed by a round trip: all
4 files were regenerated from the live graph alone and compared, statement by statement, with the source files read by
an independent XML reader. Nothing was missed and nothing was invented. The regenerated files compile.

| | |
|---|---|
| standard | PESC Test Score Report 1.1.0 (bundle `pesctestscorereport1v1v0`, `_source` `PESC-TestScoreReport-1.1.0`, DME title `PESC Test Score Report v1.1.0`) |
| source | `assets/standardSourceData/01/`: `AcademicRecord_v1.11.0.xsd`, `CoreMain_v1.17.0.xsd`, `TestScoreReport_v1.1.0.xsd`, `iso_3166-1_v1.0.0.xsd` (CoreMain `f4b05efd…`), and the expander's `releaseManifestEntry.json`, every file checked against `SHA256SUMS` at every build. Provenance: `README_PROVENANCE.md` |
| graph | `DEV_pescTestScoreReport1v1v0` (a scratch graph; bolt 7821; STOPPED after these checks under the PESC memory budget, `docker start` it to look), 2026-10-01 |
| build | recipe `recipes/pesctestscorereport1v1v0Only.recipe.jsonc` (the release alone, `roundTripStage: true`), manifest `b5de0a44…9d77be8c`, standardBase block **`7bad009abb4861d3b2216f09ef5953f4f2aa6fcce6ff6c22373afebddf82339a`** |
| reproduced | the same block and manifest from **two** builds of the recipe (`f6Build1` at head `675739f`, `f6Build2b` at head `d3e048f`, the second's graph `DEV_pescTestScoreReport1v1v0_repro`, stopped); the certifying build is the first |
| certification | `graphBuilder -goldEvalCheck` on `f6Build1`'s run directory: **PASS** (1 declared validator, inventedTotal 0; no bridge, no judged edge) |
| commit | branch `pescRelease/F6` at `d3e048f` (PESC phase F6) |

---

## What is in the graph

| in the graph | label (`PescTestScoreReport1v1v0…`) | DME role | count |
|---|---|---|---:|
| named complex types | `Type` | DmeClass | 210 |
| anonymous complex types | `AnonymousType` | DmeClass | 12 |
| element declarations (each in its owning type, by position) | `Element` | DmeProperty | 1,164 |
| attribute declarations | `Attribute` | DmeProperty | 6 |
| global elements (one is the document root) | `GlobalElement` | DmeProperty | 11 |
| **occurrences**: one per place an element can appear in a document, derived | `Occurrence` | DmeSupport | 1,355 |
| code lists (200 named, 17 anonymous) | `CodeList` | DmeOptionSet | 217 |
| codes | `Code` | DmeOptionValue | 2,721 |
| data types (572 named, 24 anonymous) | `DataType` | DmeSupport | 596 |
| groups | `Group` | DmeSupport | 9 |
| schema files | `SchemaFile` | DmeSupport | 4 |
| the release record (the expander's manifest entry) | `Release` | DmeSupport | 1 |
| search texts, embedded with `voyage-4-large` | `EmbedText` | DmeEmbedText | 2,591 |
| the standard's root | `Root` | DmeStandardRoot | 1 |

| edge | from → to | count |
|---|---|---:|
| `HAS_CLASS` | root → named complex type | 210 |
| `HAS_PROPERTY` | type, anonymous type or group → element or attribute | 1,170 |
| `REFERENCES_TYPE` | declaration → its named complex type (302) or data type (626) | 928 |
| `HAS_OPTION_SET` | declaration → its code list (153 named, 17 anonymous) | 170 |
| `HAS_VALUE` | code list → code | 2,721 |
| `SUBCLASS_OF` | derived type → base (50 extension, 58 restriction) | 108 |
| `REFERENCES` | owner → group it references (20); global element → substitution head (8) | 28 |
| `HAS_SUPPORT` | root → release record, schema files, groups | 14 |
| `HAS_INSTANCE` | element declaration → each of its occurrences | 1,355 |
| `HAS_CHILD` | parent occurrence (the root global element at the top) → occurrence: the document tree | 1,355 |
| `EMBEDS_TEXT_OF` | search text → the node it describes | 3,660 |

**Reachability.** 483 of the 1,164 element declarations can appear in a Test Score Report document
(483 through content and extension bases); they carry `reachableFromRoot: true`, their paths, and
1,355 occurrences in 26 document sections (deepest at document depth 9). 3 subtypes may be named with `xsi:type` (0 occurrences beneath them). The other
681 are library content no such document contains; they stay in the graph, marked `false`. 340 named types and
groups are reachable.

**Code lists, on their elements.** Each of the 153 element declarations typed by a named code list carries the list's `codeListName`
(153 measured live), and 153 carry its `codeListDocumentation` (a list without documentation gives none). The
17 typed by an anonymous list carry neither. Neither property is a search text, and the round trip does not read them.

Every vector (3,995) names `NULL`. Occurrences carry no text and no vector (0 measured).

**Not present:** any mapping to CEDS or to any other standard. The forge does no bridging.

---

## Accuracy

```
source ........................ 4 XSD files, read by an independent sax reader (not the forge's parser)
regenerated from the graph .... 4 XSD files, read by the same reader
invented ...................... 0
lost .......................... 0
content gaps .................. 0
explicitly omitted ............ 28,635 = 820 XML comments + 27,811 whitespace runs + 4 XML declarations
regenerated root, xmllint ..... compiles (a probe document "fails to validate", exit 3, as with the source files)
```

The comparison is on resolved qualified names (a prefix is not content, on attribute names as on QName values) and covers every
definition, import and schema-level annotation in document order, every element, attribute, group reference and wildcard in its
compositor position (14 nested `xs:choice` groups included), every attribute as written, every facet and
enumeration value, and every documentation string verbatim. This release carries 3 element documentation strings that are empty or a second documentation; each is regenerated in its place. Before phase F6 taught the forge these shapes the
round trip of this release found 6 content gap(s). The validator read the graph through the framework's live reader; the
verdict is the build's own stage. It is also measured hermetically on every test run (`test/test-release.js`, phase F4 gates).

**Measured live on `DEV_pescTestScoreReport1v1v0`** (read-only Cypher): 8,898 nodes and 11,719 edges scoped `_source = 'PESC-TestScoreReport-1.1.0'`;
the DME's own standards query (`MATCH (r:DmeStandardRoot) RETURN r._source, r.standardName, r.version`) returns "PESC-TestScoreReport-1.1.0", "PESC Test Score Report v1.1.0", "1.1.0"; the root has
14 `HAS_SUPPORT` targets; no occurrence has an embedding, a text embedding or a search text. Spend: embedding only (the shared vector cache held 323968 entries before the certifying build and 325371 after it).

---

## The test against a real document (F17, no-sample form)

**No public Test Score Report 1.1.0 document was found** (searched 2026-10-01; the known PESC samples of this family are of other
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
