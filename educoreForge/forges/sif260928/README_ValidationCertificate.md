# Validation certificate — SIF260928

**SIF 4.3 was built from its published Implementation Specification spreadsheet: one TSV, 15,620 field rows over 159 objects. The graph has 39,268 nodes and 72,953 edges.**
**The graph holds the spreadsheet exactly.** Accuracy was confirmed by a round trip: the whole TSV was regenerated from the live graph alone and compared with the source file byte for byte. The sha256 of the regenerated file equals the source file's. Nothing was missed and nothing was invented.

| | |
|---|---|
| standard | SIF 4.3 Implementation Specification (bundle `sif260928`, `_source` `SIF260928`) |
| source | `assets/standardSourceData/01/ImplementationSpecification_031326.tsv`, sha256 `6814727786bd…` (plus `refIdResolutionMap.tsv`, `7ca182bc…`) |
| graph | `DEV_sif260928Hub` (a scratch graph, built beside the CEDS hub), 2026-09-29 |
| build | recipe `recipes/sif260928WithHub.recipe.jsonc`, manifest `f7e5b0c8…`, sif260928 block `576db654…` |
| commit | branch `sifReplacement/A7`, cut from `f203498` (phase A7 of the SIF replacement) |

---

## What is in the graph

| in the graph | label | count |
|---|---|---:|
| fields: one per spreadsheet row, all eight cells carried verbatim | `Sif260928Field` | 15,620 |
| objects: one per table | `Sif260928Object` | 159 |
| containers: element paths that have no row of their own | `Sif260928Container` | 6,586 |
| questions: fields that mean the same thing, grouped | `Sif260928Question` | 5,018 |
| code lists, read from quote-wrapped Format cells | `Sif260928Codeset` | 131 |
| code list values | `Sif260928CodesetValue` | 4,055 |
| search texts (names, descriptions, paths), embedded with `voyage-4-large` | `Sif260928EmbedText` | 7,698 |
| the standard's root | `Sif260928Root` | 1 |

| edge | from → to | count |
|---|---|---:|
| `HAS_FIELD` | Object → Field | 15,620 |
| `HAS_CHILD` | Object → Container, Container → Container or Field, **Field → Field** (an attribute on an element that is itself a field: 3,138 edges on 2,645 fields) | 21,017 |
| `HAS_INSTANCE` | Question → Field | 15,620 |
| `CONSTRAINED_BY` | Field → Codeset | 1,495 |
| `HAS_VALUE` | Codeset → CodesetValue | 4,055 |
| `REFERENCES_OBJECT` | Field → Object (a RefId field, resolved through the map or by exact name) | 607 |
| `EMBEDS_TEXT_OF` | EmbedText → the node it describes | 14,539 |

Every search text has a vector, and every SIF vector (12,876, counting the object, question and root vectors) names `voyage-4-large`, the same model as the 6,684 CEDS hub texts in the same graph.

**Not present:** any mapping to CEDS or to any other standard. The forge does no bridging. SIF's own `CEDS ID` column is carried on each field verbatim, because it is part of the SIF source.

---

## Accuracy

```
source ..................... ImplementationSpecification_031326.tsv, 16,101 lines
regenerated from the graph . sha256 equal to the source (byte for byte)
invented ................... 0
lost ....................... 0
content gaps ............... 0
explicitly omitted ......... 6,586 (the containers, which have no row to regenerate)
```

The validator reads the graph through the framework's live reader and nothing else, and regenerates every row on its own source line, every table title and every blank separator line. The run shown here is the one inside the build, and it was run again, live, after the build. Both gave these figures.

Further live checks, measured against the forge's own output on this graph:
- The node count per label and the edge count per type both equal the forge's census exactly. The one addition is the loader's `StandardBase` label, which it puts on all 39,268 nodes.
- Every `formatCellText` (the longest is 12,180 bytes) and every code list value whose identifier contains a space or a slash came through byte for byte.
- There are no duplicate `HAS_INSTANCE` edges.

---

## Known problems

**1. The DME does not show the new structure yet.** The DME does not traverse the new edge types `HAS_INSTANCE`, `REFERENCES_OBJECT`, `CONSTRAINED_BY`, or `HAS_CHILD` (including Field → Field `HAS_CHILD`) until the DME is updated, in phase E3 of the SIF replacement. This holds for the website's traversal queries, its LLM prompt and its schema summary. Its lookups also still name the incumbent's labels (`SifObject`, `SifField`), not `Sif260928Object` and `Sif260928Field`. Until E3, a SIF260928 field found in the DME shows no parent, children, question or code list.

**2. Whole numbers are stored as floating point.** `xpathDepth`, `sourceLineNumber`, `valueOrdinal`, `valueCount`, `fieldCount`, `instanceCount` and the framework's `depth` all load as Neo4j `FLOAT`. Every value is integral: 0 of 79,871 values differ from their integer. This is how the shared loader writes JavaScript numbers, and CEDS's `depth` and `sequence` load the same way. It is not specific to SIF. A cypher consumer comparing against an integer literal still matches (`3.0 = 3`), but a consumer that checks the type does not.

**3. One-element lists are stored as plain strings.** A list property with a single entry loads as that entry: `objectNameList` and `objectNameSampleList` on 4,433 questions, and `propertyNameList` on 14,397 `EMBEDS_TEXT_OF` edges. A reader must re-widen these, as the bridge framework already does for `propertyNameList`. Again, this is the shared loader's behaviour.

**4. Fourteen RefId rows resolve to no object.** These are the rows over two names, `SIF_RefId` and `@SIF_RefId`, that neither the map nor an exact name match resolves. They get no `REFERENCES_OBJECT` edge, and each is listed by name.

**5. Eight questions carry no `cedsElementId`.** In these questions, some fields carry a CEDS id and others don't. Each field keeps its own id.

**6. Containers carry no "unbounded" marking.** The spreadsheet does not state it. The 1,887 unbounded containers the incumbent forge reported came from an XSD this forge does not read.

---

## Where the data came from

The single TSV is SIF's Implementation Specification spreadsheet, byte-copied from the incumbent forge's snapshot `01` with its `SHA256SUMS` entry. The RefId map is a hand-kept table carried with the snapshot. `assets/standardSourceData/01/README_PROVENANCE.md` has the full record.

---

## More detail

| document | what it holds |
|---|---|
| `lib/sif260928RoundTripPair.js` | the round trip's two sides and its diff, including what it does not model |
| `management/zNotesPlansDocs/sifStructuralBridge-091826/devlogs/DEVLOG-A6.md` | how the byte-for-byte proof was built |
| `management/zNotesPlansDocs/sifStructuralBridge-091826/devlogs/DEVLOG-A7.md` | this live build, the commands that reproduce it, and every check above |

Figures measured 2026-09-29 from the run named above.
