# Validation certificate — SIF

**SIF NA 4.3 was built from the Implementation Specification spreadsheet. 27,069 nodes.**
**This graph is complete and usable.** Accuracy was confirmed by round trip validation: data from
the graph was converted back to spreadsheet form and compared against the source. Nothing was missed.
Nothing was invented.

| | |
|---|---|
| standard | SIF NA 4.3, Access 4 Learning, release 2022-10-27 (the graph stamps `version 1.0`) |
| source | `assets/standardSourceData/01/ImplementationSpecification_031326.tsv` — 159 object tables, 3,178,798 bytes — plus `refIdResolutionMap.tsv`, 38 rows |
| graph | `DEV_FourWithNewPesc`, built 2026-08-07 from recipe `fourWithNewPescRoundTripNoBridges` |
| commit | branch `architecture-improvement`, recipe at `a0a4a90` |

---

## What is in the graph

**The SIF data model as the specification spreadsheet states it** — 159 object tables, every field in
each, and for each field the eight values the spreadsheet carries:

| in the graph | from the spreadsheet column |
|---|---|
| field name | Name |
| mandatory / optional / conditional | Mandatory |
| characteristics, including repeatability marks | Characteristics |
| data type | Type |
| description | Description |
| XPath location within its object | XPath |
| CEDS identifier | CEDS ID |
| format | Format |

**Element order is in the graph**, not merely field membership. For every pair of sibling fields the
graph records which comes first, so the sequence of a SIF object is recoverable.

**Also present:** the RefId resolution map — 38 curated rows giving, for each RefId field, the object
table it points at.

**Not present:** any mapping to CEDS, Ed-Fi, PESC or any other standard. SIF sits in a four-standard
graph with no cross-standard edges, so nothing here relates SIF to anything else.

---

## Accuracy

The graph was rebuilt back into spreadsheet statements and compared, statement by statement, against
the source file.

```
statements compared ............ 97,888
missing from the graph ......... 0
present but not in the source .. 0
order mismatches ............... 0
```

**Nothing was dropped and nothing was invented.** The comparison covers field values and sibling
order; it does not compare formatting or whitespace.

The comparison program reads the spreadsheet directly and does not use the forge's own parser, so a
parser fault could not hide by appearing on both sides.

---

## Known problems

**1. Container elements are not in the graph.** SIF's published XSD declares 6,586 elements whose
children are other elements — the structural containers that hold groups of fields. The spreadsheet
has no row for any of them, because its format is a list of fields and a container is not a field.
None of them reached the graph.

**2. 1,887 elements repeat, and the graph does not say so.** Of those 6,586 containers, 1,887 are
declared `maxOccurs="unbounded"` in the XSD. **A consumer reading the graph cannot tell that these
elements may occur more than once.** A further 12 repeatable elements do have spreadsheet rows, but
with the repeatability mark left blank.

**3. Choice groups are not in the graph.** Where SIF defines a set of fields of which one must be
chosen, the spreadsheet cannot express the grouping. A `C` in the mandatory column plus the field's
own flag is the only trace, and that is what the graph carries.

**4. Anything the spreadsheet has no column for is absent.** The graph's vocabulary is exactly the
eight columns above. Facts SIF states elsewhere — in its XSD, its documentation, or its
implementation guidance — are not here.

**5. An empty cell and a missing value look the same.** A blank cell produces no statement, so *"this
field has no description"* and *"this field's description did not survive"* cannot be distinguished
from the graph alone.

**6. Order means document order.** The graph records the sequence the spreadsheet lists fields in. It
does not record XSD compositor rules — sequence versus choice versus all.

---

## Where the data came from

**The spreadsheet is SIF's canonical source.** The A4L specification editor authors it and generates
every published SIF artifact from it, the XSDs included. This is recorded as ruling R-SF-6 on tqii's
firsthand knowledge of the publisher's workflow; it is not independently confirmed with A4L.

**The upstream URL and version were not recorded.** `standardSourceLocation` names A4L as publisher
with `upstreamUrl: unknown`, and no version string appears in the file itself — the only internal
evidence is the filename date-code `031326`. The `4.3` above comes from the specification, not from
the file. Both source files are committed, so a clone has the exact bytes.

**Sample XSDs are held in the bundle** at `assets/publishedXsdCrossCheck/01/`, from the Unity Data
Generator project. **They are not canonical and are not forge input** — the forge reads only the two
spreadsheet exports. They were used to find problems 1, 2 and 3, and if they can be certified as
canonical their additional detail can be added to the graph.

**The XSD and the spreadsheet agree wherever both speak.** Across all 15,620 spreadsheet rows the two
give contradictory values zero times. They differ only by silence: 131 rows where the spreadsheet is
blank and the XSD carries a value.

---

## More detail

| document | what it holds |
|---|---|
| `README_ValidationDetail.md` | how the comparison works, its full modelling boundary, and the commands to reproduce the run |
| `README_ERRATA.md` | what we believe is true about SIF's own published artifacts, with verified and inferred claims marked apart |
| `system/management/zNotesPlansDocs/FINDING-sifExportOmitsContainerElements-080926.md` | the measurement behind problems 1 and 2 |
| `system/management/zNotesPlansDocs/DATA-sifOmittedContainerElements-080926.tsv` | all 6,586 omitted containers, enumerated |
| `assets/standardSourceData/01/README_PROVENANCE.md` | the corpus record and ruling R-SF-6 in full |

Figures measured 2026-08-07; the XSD comparison behind problems 1 to 3 was run 2026-08-09.
