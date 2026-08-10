# Validation certificate — Ed-Fi

**Ed-Fi Data Standard 5.2.0 and TPDM Community Model 1.2 were built from the published MetaEd
sources. 6,336 nodes.**
**This graph is complete and usable.** Accuracy was confirmed by round trip validation: the graph was
converted back into MetaEd statements and compared against the source files. Nothing was missed.
Nothing was invented.

| | |
|---|---|
| standard | Ed-Fi Data Standard **5.2.0** — 849 constructs, 1,904 properties, 3,522 descriptor code values — plus TPDM Community Model **1.2** |
| source | `assets/standardSourceData/04/` — five inputs, listed below |
| graph | `DEV_FourWithNewEdFi`, built 2026-08-09 |
| commit | `c2c8c01`, branch `architecture-improvement` |

---

## What is in the graph

**The Ed-Fi model as the MetaEd sources declare it** — every construct, every property on each
construct, and for each the type, cardinality, documentation, identity role and descriptor
references the source states.

**Descriptor code values are included** — 3,522 of them, the default code sets Ed-Fi publishes
separately from the model itself.

**Interchange structure is included**, and this is the part a consumer is most likely to need: for
each of the 32 interchanges, which entities it carries and **whether each is carried in full or only
as an identity reference**. That distinction is a property of the interchange's use of the entity,
not of the entity itself — five entities appear both ways in different interchanges.

**Also present:** the publisher's own tracking identifiers for each item, and namespace qualifiers on
cross-namespace references.

**Not present: any mapping to CEDS.** An authored Ed-Fi→CEDS crosswalk exists and is stored in the
bundle, and 1,147 nodes carry a `cedsId` from it — but **no bridge was built from it and no edges
connect Ed-Fi to CEDS in this graph.**

---

## Accuracy

```
statements compared ............ 25,723
missing from the graph ......... 0
present but not in the source .. 0
```

The comparison program reduces the published MetaEd text directly and never opens the graph; the
program that reads the graph never opens a source file. Neither uses the forge's own parser, so a
parser fault could not hide by appearing on both sides.

The test suite has been observed failing on each fault it guards, not merely passing.

---

## Known problems

**1. The order of declarations inside a construct is not recorded.** The graph knows which properties
a construct has, not the sequence they were written in.

**2. Comment lines are not carried.** Ed-Fi's own grammar discards them, and so does the graph — 19
in this corpus, each recorded with its file and line in the build output.

**3. An empty value and a missing value look the same.** Where an item declares no tracking
identifier, the graph is silent — which is indistinguishable, from the graph alone, from an
identifier that failed to come across.

**4. Whitespace around option values is not preserved.** Two option values differing only in
surrounding spaces are one value in the graph.

**5. The declared keyword on an item is not part of its identity.** Where a source item's declared
keyword disagrees with the actual type of the thing it points at, the graph follows the referent. The
forge counts those disagreements separately — three in this corpus.

---

## Where the data came from

Snapshot `04`, collected 2026-08-03 from five separate inputs:

| input | what it is | committed? |
|---|---|---|
| `metaEdModel/` | `@edfi/ed-fi-model-5.2` v3.0.1 — 653 `.metaed` files, the canonical source | **no — licensed, gitignored** |
| `descriptorCodeValues/` | 203 descriptor code-value XMLs from `Ed-Fi-Data-Standard` tag `v5.2.0` | yes |
| `tpdmCommunityModel/` | TPDM Community Model v1.2, 196 `.metaed` files | yes |
| `tpdmDescriptorCodeValues/` | 27 TPDM descriptor XMLs | yes |
| `cedsAuthoredCrosswalk/` | the authored Ed-Fi→CEDS crosswalk, 2 CSVs | yes |

**A clone of this repository does not have the whole corpus.** The model package is licensed by the
Ed-Fi Alliance and its bytes are not committed; the acquisition recipe in the provenance README
fetches it. `SHA256SUMS` covers every source file including the uncommitted ones, so identical bytes
can be proven on any machine.

**Four of the five inputs are publisher artifacts. The crosswalk is not.** It is human-authored, and
the harvest that produced it recorded no upstream URL or version — this snapshot is the authority for
those bytes. Circumstantial confirmation: all 8,310 of its descriptor rows stamp
`EdFiVersionNumber=DS5.2`.

---

## More detail

| document | what it holds |
|---|---|
| `README_ValidationDetail.md` | how the comparison works, its full modelling boundary, and the commands to reproduce this run |
| `assets/standardSourceData/04/README_PROVENANCE.md` | the corpus record and the exact, rerunnable acquisition recipe |

Figures measured 2026-08-09 from the certification run named above.
