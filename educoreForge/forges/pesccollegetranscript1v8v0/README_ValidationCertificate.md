# Validation certificate — PESC College Transcript v1.8.0

**PESC College Transcript 1.8.0 was built from its four XSD files: the message schema and the exact library editions it
names (CoreMain 1.19.0, AcademicRecord 1.13.0, iso_3166-1 1.0.0). The graph has 8,997 nodes and 11,932 edges.**
**The graph holds the four files exactly, at the level of XML content.** Accuracy was confirmed by a round trip: all four
files were regenerated from the live graph alone and compared, statement by statement, with the source files read by an
independent XML reader. Nothing was missed and nothing was invented. The regenerated files compile.

| | |
|---|---|
| standard | PESC College Transcript 1.8.0 (bundle `pesccollegetranscript1v8v0`, `_source` `PESC-CollegeTranscript-1.8.0`, DME title `PESC College Transcript v1.8.0`) |
| source | `assets/standardSourceData/01/`: `CollegeTranscript_v1.8.0.xsd`, `CoreMain_v1.19.0.xsd` (`d9ded348…`), `AcademicRecord_v1.13.0.xsd`, `iso_3166-1_v1.0.0.xsd`, and the expander's `releaseManifestEntry.json`, every file checked against `SHA256SUMS` at every build. Provenance: `README_PROVENANCE.md` |
| graph | `DEV_pescCollegeTranscript1v8v0_codeList` (a scratch graph; bolt 7811), 2026-10-01 |
| build | recipe `recipes/pesccollegetranscript1v8v0Only.recipe.jsonc` (the release alone, `roundTripStage: true`), manifest `c4b4ccad…cedca4c1`, standardBase block **`5c6b404080ef8eec3d662d60fffb39bda1912f7cca9c1a76757cce7ed6c7ea22`** (it was `f9e2a095…ac7518` before the code-list facts below; that block moved by design) |
| reproduced | the same block and manifest from **two** builds of the recipe at head `8fee4c9` (`f6CodeListBuild1`, `f6CodeListBuild2`); the certifying build is the first. (The earlier block `f9e2a095…` was reproduced three times in phase F5.) |
| certification | `graphBuilder -goldEvalCheck` on `f6CodeListBuild1`'s run directory: **PASS** (1 declared validator, inventedTotal 0; no bridge, no judged edge) |
| commit | branch `pescRelease/F6` at `8fee4c9` (PESC phase F6's first commit, on F5's `f10ae13`); the round-trip harness fix it needed is `39f0502` |

---

## What is in the graph

| in the graph | label (`PescCollegeTranscript1v8v0…`) | DME role | count |
|---|---|---|---:|
| named complex types | `Type` | DmeClass | 222 |
| anonymous complex types | `AnonymousType` | DmeClass | 13 |
| element declarations (each in its owning type, by position) | `Element` | DmeProperty | 1,224 |
| attribute declarations | `Attribute` | DmeProperty | 6 |
| global elements (one is the document root) | `GlobalElement` | DmeProperty | 11 |
| **occurrences**: one per place an element can appear in a document, derived | `Occurrence` | DmeSupport | 1,367 |
| code lists (202 named, 17 anonymous) | `CodeList` | DmeOptionSet | 219 |
| codes | `Code` | DmeOptionValue | 2,741 |
| data types (576 named, 25 anonymous) | `DataType` | DmeSupport | 601 |
| groups | `Group` | DmeSupport | 9 |
| schema files | `SchemaFile` | DmeSupport | 4 |
| the release record (the expander's manifest entry) | `Release` | DmeSupport | 1 |
| search texts, embedded with `voyage-4-large` | `EmbedText` | DmeEmbedText | 2,578 |
| the standard's root | `Root` | DmeStandardRoot | 1 |

| edge | from → to | count |
|---|---|---:|
| `HAS_CLASS` | root → named complex type | 222 |
| `HAS_PROPERTY` | type, anonymous type or group → element or attribute | 1,230 |
| `REFERENCES_TYPE` | declaration → its named complex type (332) or data type (642) | 974 |
| `HAS_OPTION_SET` | declaration → its code list (160 named, 17 anonymous) | 177 |
| `HAS_VALUE` | code list → code | 2,741 |
| `SUBCLASS_OF` | derived type → base (51 extension, 59 restriction) | 110 |
| `REFERENCES` | owner → group it references (20); global element → substitution head (8) | 28 |
| `HAS_SUPPORT` | root → release record, schema files, groups | 14 |
| `HAS_INSTANCE` | element declaration → each of its occurrences | 1,367 |
| `HAS_CHILD` | parent occurrence (the root global element at the top) → occurrence: the document tree | 1,367 |
| `EMBEDS_TEXT_OF` | search text → the node it describes | 3,702 |

**Reachability.** 375 of the 1,224 element declarations can appear in a College Transcript document (371 through content
and extension bases, 4 more because an instance may name `LearningProgramType` with `xsi:type`); they carry
`reachableFromRoot: true`, their paths, and 1,367 occurrences in 22 document sections (deepest at document depth 10). The
other 849 are library content no transcript contains; they stay in the graph, marked `false`. 265 named types and groups
are reachable.

Every vector (4,055: 2,578 texts, 235 classes, 1,241 properties, the root) names `voyage-4-large`. Occurrences carry no
text and no vector.

**Code lists, on their elements.** Each of the 160 element declarations typed by a named code list carries the list's
`codeListName` and `codeListDocumentation` (every named list in this release is documented), so a reader of the element
alone sees its list's prose. The 17 typed by an anonymous list carry neither: such a list has no name, and none of the 17
has documentation. Neither property is a search text, and the round trip does not read them.

**Not present:** any mapping to CEDS or to any other standard. The forge does no bridging.

---

## Accuracy

```
source ........................ 4 XSD files, read by an independent sax reader (not the forge's parser)
regenerated from the graph .... 4 XSD files, read by the same reader
invented ...................... 0
lost .......................... 0
content gaps .................. 0
explicitly omitted ............ 29,339 = 907 XML comments + 28,428 whitespace runs + 4 XML declarations
regenerated root, xmllint ..... compiles (a probe document "fails to validate", exit 3, as with the source files)
```

The comparison is on resolved qualified names (a prefix is not content) and covers every definition and import in
document order, every element, attribute, group reference and wildcard in its compositor position (14 nested
`xs:choice` groups included), every attribute as written, every facet and enumeration value, and every documentation
string verbatim. The validator read the graph through the framework's live reader; the verdict is the build's own stage.
It is also measured hermetically on every test run (`test/test-release.js`, phase F4 gates).

**Measured live** (read-only Cypher; on `DEV_pescCollegeTranscript1v8v0`, phase F5, and the node, edge and code-list counts
again on `DEV_pescCollegeTranscript1v8v0_codeList`, phase F6: 160 elements with `codeListName`, 160 with
`codeListDocumentation`): 8,997 nodes and 11,932 edges scoped
`_source = 'PESC-CollegeTranscript-1.8.0'`, equal to the pure forge label by label and type by type, plus the loader's
`StandardBase` label on every node; the DME's own standards query (`MATCH (r:DmeStandardRoot) RETURN r._source,
r.standardName, r.version`) returns `PESC-CollegeTranscript-1.8.0`, `PESC College Transcript v1.8.0`, `1.8.0`; the root has
14 `HAS_SUPPORT` targets; no occurrence has an embedding, a text embedding or a search text.

---

## The test against a real document (F17, no-sample form)

**No public College Transcript 1.8.0 document exists** that a web search could find (2026-09-30). The content-level round
trip and the `xmllint` compile of the regenerated files are the proof for this release. As a methodology check, two real
transcripts of earlier releases validate against closures built by the expander's own rule: the EMREX College Transcript
1.6.0 sample (`emrex-eu/elmo-pesc`) and the Ontario College Transcript 1.4.0 sample
(`pesc-org/canpesc-common-digital-layout`); see `pescForgeBridgeDesign-093026/evidence/q7SampleValidation/README.md`. They
were not validated against this release, which they were not written for.

---

## Known problems

**1. The DME does not show the occurrences or their mappings yet.** It does not traverse `HAS_INSTANCE` or `HAS_CHILD`
(SIF plan phase E3, which will serve both standards). Until then, a PESC element found in the DME shows no document paths,
and mappings a bridge later writes onto occurrences are in the graph but not on the declaration's DME page. Whether the DME
views handle a `GlobalElement` (DmeProperty) as the parent of `Occurrence` (DmeSupport) nodes is unchecked: the DME was not
run.

**2. Whole numbers are stored as floating point.** `depth`, `documentDepth`, positions and counts load as Neo4j `FLOAT`
(the shared loader's behaviour, as for CEDS and SIF). Every value is integral.

**3. One-element lists are stored as plain strings.** On 303 of the 375 reachable declarations `occurrenceSectionList` is
a string (they occur in one section); `contextPathSampleList` and `reachableVia` likewise. A reader must re-widen; the
bridge's scope-and-sections tool does.

**4. An occurrence's framework `depth` is its `documentDepth` + 1**, because the root global element sits at depth 1.

**5. Not modelled by the round trip, by statement:** XML comments (PESC's change logs; the release record carries the
root's), whitespace, the XML declaration, the files' xmlns prefix declarations, and the order of facets inside one
restriction.

---

## More detail

| document | what it holds |
|---|---|
| `lib/pesc-release-forge/roundTripPair.js` | the round trip's two sides and its diff, including what it does not model |
| `management/zNotesPlansDocs/PESC/pescForgeBridgeBuild-093026/DEVLOG-F3.md`, `DEVLOG-F4.md` | reachability, occurrences, and how the round trip was built |
| `management/zNotesPlansDocs/PESC/pescForgeBridgeBuild-093026/DEVLOG-F5.md` | phase F5's builds, the commands that reproduce them, and its live checks |
| `management/zNotesPlansDocs/PESC/pescForgeBridgeBuild-093026/DEVLOG-F6.md` | the code-list facts, the two rebuilds that moved the block, and their goldEvalCheck |

Figures measured 2026-10-01 from the builds named above.
