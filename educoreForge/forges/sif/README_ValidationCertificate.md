# Validation certificate — SIF

## Summary

**The graph is a faithful re-statement of its source, including the order of everything in it.**
Everything the source says, the graph carries; nothing the graph carries was invented; and because
element order is part of statement identity here, `reproduced` means relative order was preserved
rather than merely that the same facts are present.

**This round trip validation supports the judgement that this graph is a complete and usable rendering
of its source.** It also establishes something the round trip cannot see and this certificate must
say: **the source itself omits 1,887 repeatability declarations that SIF's own published schema
carries.** The graph is complete with respect to the spreadsheet. The spreadsheet is not complete with
respect to SIF. See known issue 1.

**That comparison required SIF's published annotated XSD, which is now held in this bundle** at
`assets/publishedXsdCrossCheck/01/` — committed 2026-08-09 on TQ's ruling, having previously been
borrowed read-only from an unrelated project. It is a cross-check corpus and **not forge input**: the
forge's only source remains the two TSVs. See Provenance for where the bytes came from and why their
identity is inferred rather than verified.

| | |
|---|---|
| standard | SIF NA 4.3, Access 4 Learning (release 2022-10-27); the graph stamps `version 1.0` |
| corpus | `assets/standardSourceData/01/` — `ImplementationSpecification_031326.tsv` (3,178,798 bytes, 159 object tables) and `refIdResolutionMap.tsv` (38 rows) |
| recipe | `recipes/fourWithNewPescRoundTripNoBridges.recipe.jsonc` — `roundTripStage: true`, `hubs: []`, `bridges: []` |
| run | `fourWithNewPescRoundTripNoBridges_20260808-001444`, 2026-08-07 |
| commit | branch `architecture-improvement`; the recipe is committed at `a0a4a90` |
| graph | `DEV_FourWithNewPesc` — resolve the bolt port from the container, never from a document |

**Resolving the port from the container is load-bearing, not decorative.** This graph is the
configured DME golden, so ordinary DME use provisions from it: on 2026-08-09 it was stopped and
restarted inside two seconds by a user-graph provisioning event. Nothing in this campaign owns it
exclusively and a restart can move a port mapping.

**The spreadsheet is the canonical source, and that is a ruling rather than an assumption.** ⟪R-SF-6⟫
The A4L specification editor authors the specification spreadsheet and feeds it to a generator he
wrote; every published SIF artifact, the XSDs included, is generated from it. The spreadsheet is
therefore SIF's analogue of Ed-Fi's MetaEd — upstream of every generated artifact. The provenance of
that claim is TQ's testimony on firsthand knowledge of the publisher's workflow; it is not
independently verified against A4L tooling and per the ruling it does not need to be.

SIF is one island in a four-standard graph — 100,979 nodes total, SIF 27,069, CEDS 25,202,
PESC260805 42,372, Ed-Fi 6,336 — with zero cross-standard edges by design. SIF carries no mapping
content here, so nothing speaks to how well it maps to anything.

---

## The counts

```
statements reproduced .......... 97,888
invented ....................... 0
missed ......................... 0
  contentGap ................... 0        real loss — counted in missed
  explicitlyOmitted ............ 0        deliberate non-carriage — not counted in missed
orderMismatches ................ 0
```

**`explicitlyOmitted` is zero and there is no exclusion list.** Nothing was argued at the margin.

**Order is inside these numbers, not beside them.** ⟪R-SF-1⟫ *element sequence is important.* The
mechanism ⟪R-SF-7⟫ is all-pairs precedence: for every ordered pair X-before-Y in a sibling group, one
`precedesInGroup` statement. That buys a specific calculus — a **swap** flips exactly the affected
pairs, producing a lost source pair and an invented reversed pair, naming the group and both members;
a **missing** member degrades to a located loss only and never a false invention. **The hard line is
never spent to express loss.** `orderMismatches` is reported separately and is also zero.

**Invention fails a build. Loss does not.** An invented statement is a claim the source never made; a
lost one is a claim the graph fails to repeat. No amount of coverage excuses a fabrication.

```
graphBuilder: [goldEvalCheck] PASS — 4 declared validator(s) ran with inventedTotal=0     exit 0
```

---

## Round Trip Validation

**One validation process ran against the build.** This bundle has no second instrument written by
anyone else — unlike CEDS, which has an independent RDF implementation, and PESC260805, which has an
independent XSD compiler.

`lib/roundTripSifCanonical.js` mints a canonical statement set from **either** side:
`statementsFromTsvText` reads the committed TSV, `statementsFromSifGraph` reads the
materialized-graph payload, and the two sets are compared. Both minters live in one module so the
identity rules are shared code, **but the source minter never sees the graph and the graph minter
never opens a file.**

**Neither path touches the forge's own `lib/parser.js`**, and that is deliberate: a validator that
parses with the forge's parser can only prove the forge agrees with itself.

**What the round trip models, and what it does not, is declared by the bundle rather than derived by
a reader.** `roundTripValidator.js` states a `semanticValidationLimit` in its verdict. It names the
statement vocabulary as the source's column set, records that absent is absent and that order
semantics are document-order-only, and carries the measured fact that the source omits **1,899
repeatability declarations — the 1,887 of known issue 1 plus the 12 of known issue 4**, which is the
only place in this document the two are combined into one figure. Before 2026-08-09 the builder
substituted its "none declared" marker and this section had to be derived by reading the module.

**Declared and observed in a real verdict, not merely typed into a file** — a read-only round trip
against `DEV_FourWithNewPesc` on 2026-08-09 landed it, 2,380 characters intact. **What has not been
observed is the next hop**: `round-trip-stage.js` carries the field into the stage summary and the
`goldEvalCheck` payload, which are what a promoter actually reads, and that path is pre-existing and
demonstrably works for `pesc260805` — but confirming it for SIF needs a full build, which has not been
run since the declaration. Verified to the verdict; inferred beyond it.

**A second, separate instrument examined the source rather than the graph.** On 2026-08-09 a full
inventory compared SIF's published annotated XSD against the TSV export, in both directions, over all
159 object roots. **That XSD was borrowed read-only** from
`A4L/unityObjectGenerator/system/code/cli/lib.d/assets/XSDs/SIF_Message.xsd`, an unrelated project on
the same machine, **and is now committed here** at `assets/publishedXsdCrossCheck/01/`, so the
comparison is reproducible from the bundle alone. It is identified as the errata's own artifact by
74,122 matching lines, six exactly matching `sifChar` distribution values and both cited `ValidMark`
line numbers; **that identification is inferred, not verified**, because the provenance record
checksums the published ZIP rather than the extracted file. Nobody has re-acquired the ZIP and
checksummed the extraction. It reads two files and opens no database, so it has no exposure to the graph at all
— and equally, it says nothing about the graph as built. It is the instrument behind known issue 1,
and its findings are corroborated four independent ways — and separately confirmed against the
spreadsheet itself: **across all 15,620 export rows, the spreadsheet's `Characteristics` column and
the XSD's `sifChar` annotation contradict each other zero times.** Every divergence has the same
shape: 131 rows where the spreadsheet is silent and the XSD carries a value, and none the other way.
**The two artifacts do not disagree. The spreadsheet is simply less expressive.**

---

## Known issues

Ordered by consequence.

1. **The source omits every container element, and with them 1,887 repeatability declarations.**
   Measured 2026-08-09, and this settles a question the errata had carried as *inferred, not
   verified*. The cross-tabulation over all 9,231 intermediate elements is categorical in both
   directions:

   | | has own row | no own row |
   |---|---:|---:|
   | structural container (has element children) | **0** | **6,586** |
   | value-bearing element (attributes only) | **2,645** | **0** |

   Of the 6,586, **1,887 declare `maxOccurs="unbounded"`** — so a consumer reading only the
   spreadsheet cannot know those elements repeat. Deduplicated for whoever has to act: 1,255 distinct
   XSD declaration sites, of which 203 are the repeatable ones.

   **The right characterization is not that the export drops rows.** The export is a list of fields
   and a structural container is not a field, so the format has no representation for one. `ValidMark`
   — the case that first exposed this — is not special in any respect; it was noticed only because
   `CR` is a characteristic value occurring nowhere else in the file.

   **This is a statement about the source, not about the forge.** `lost 0` above remains correct: the
   round trip measures fidelity to the ingested snapshot, and every fact the snapshot states is in the
   graph.

2. **The finding is bounded, and the bound is worth as much as the finding.** A full bidirectional
   diff found the export omits **exactly and only containers**: of 6,745 paths declared in the XSD
   without an export row, 6,745 are containers, **zero are leaf elements and zero are attributes** —
   and **zero export rows name anything the schema does not declare**. Attribute paths match exactly,
   3,789 on each side. There is no worse hidden class underneath this one.

3. **This is a difference in expressive capacity, not a conflict between artifacts.** Measured across
   all 15,620 export rows: zero contradictions between the spreadsheet and the XSD, with 131 rows
   where the spreadsheet is silent and the XSD speaks. The export is strictly poorer and never wrong.
   Any account of this finding that describes the two artifacts as disagreeing would be both
   inaccurate and accusatory.

4. **A further 12 repeatability declarations are missing on rows that DO exist**, beyond the 1,887
   carried by containers with no row at all. These are export rows whose `Characteristics` cell is
   blank where the XSD says `MR`.

5. **What caused the omission is not established, and must not be stated as though it were.** We have
   seen neither the authoring spreadsheet nor the generator. That containers drop out *in generation*
   is inference. It is equally consistent with every measured fact that the authoring spreadsheet has
   no container row either — in which case this is a finding about the **specification format** rather
   than about anyone's tool. Not reported to A4L; no contact made.

6. **The statement vocabulary is the column set**, so anything the spreadsheet has no column for is
   not modelled at all. Seven predicates, one per source column. Errata S-2 is exactly this: the
   export cannot express choice-group membership, and a `C` plus the mandatory flag is the only trace.

7. **Absent is absent.** An empty cell mints no statement, so *"this field has no description"* and
   *"this field's description was lost"* are not distinguished by the presence of a statement — only by
   the source having no cell there. Cell values are trimmed, so leading and trailing whitespace is not
   a statement.

8. **Order semantics are document-order-only** ⟪R-SF-8⟫. The source states row order and nothing else;
   the instrument never consults the published XSD for compositor facts. Absolute ordinals are
   deliberately not statements — rank is derivable as a predecessor count, and rival forms were
   considered and rejected on the record.

9. **Only one instrument examined the graph.** The source-side inventory behind issues 1 to 4 is
   genuinely independent, but it never read the container, so the round-trip figures rest on a single
   instrument.
   *(Contrast: declaration order is part of statement identity here and is explicitly **not** measured
   in Ed-Fi. The four bundles do not agree on this and a reader comparing them should not assume they
   do.)*

10. **Mapping and cross-standard content are out of scope entirely.** SIF is base-only in this graph.

---

## Provenance

Snapshot `01`, migrated to its in-forge canonical location on 2026-05-28. Both inputs are committed;
no gitignore involvement, so a clone has the exact bytes.

| file | bytes | role |
|---|---:|---|
| `ImplementationSpecification_031326.tsv` | 3,178,798 | the data model — a flattened export of the SIF NA 4.3 authoring spreadsheet: 159 `<TableName>: Table N` sections, each with the literal header `Name / Mandatory / Characteristics / Type / Description / XPath / CEDS ID / Format` |
| `refIdResolutionMap.tsv` | 4,042 | curated RefId→target-table resolution map, 38 rows |

**The upstream URL was never captured.** `standardSourceLocation` records `upstreamUrl: unknown`,
naming A4L (`https://www.a4l.org`) as publisher without an artifact URL, with the bytes copied on
2026-05-28 from a local `sourceData/forge-sif-tsv` directory. **The published version is likewise
unrecorded** — no version string appears in the TSV itself; the only evidence is the filename
date-code `031326`. The `4.3` in the identity table above comes from the specification, not from the
file.

**The published XSD is now in this bundle**, at `assets/publishedXsdCrossCheck/01/` with its own
`SHA256SUMS` and a `README_source.md`. TQ ruled the disposition on 2026-08-09, lifting a supervisor
fence that had held it out. **Until that ruling the investigation behind known issues 1 to 3 could not
be run from inside this bundle** — the annotated schema it required was borrowed, read-only, from an
unrelated project on the same machine. That is no longer true and the comparison is now reproducible
from the bundle alone.

The bytes are identified as the errata's own artifact by six exactly matching `sifChar` distribution
values, a matching line count of 74,122, and both cited `ValidMark` line numbers. **That
identification remains inferred rather than verified**, and committing the files did not change it:
the provenance record checksums the published ZIP, not the extracted file inside it, so there is still
no publisher checksum for these bytes to be compared against. Re-acquiring the ZIP and checksumming
the extraction would settle it, and `README_source.md` records that as the task.

**Those XSDs are a cross-check corpus and not forge input.** They sit in a sibling directory
deliberately: adding them to the snapshot's `SHA256SUMS` would break every SIF round trip, because the
validator filters that directory to `.tsv` and then refuses by name for any listed file missing from
that filtered list. The trap is recorded in both READMEs.

---

## For more information

| document | what it holds |
|---|---|
| `README_ValidationDetail.md` | the all-pairs precedence mechanism, the full modelling boundary, and the commands to reproduce this run |
| `README_ERRATA.md` | what we believe is true about SIF's own published artifacts — someone else's work, held to a different standard of care, with verified and inferred claims marked apart |
| `system/management/zNotesPlansDocs/FINDING-sifExportOmitsContainerElements-080926.md` | the source inventory behind known issues 1 to 3, its four-way arithmetic closure, and its author's account of three bugs found in the instrument itself |
| `system/management/zNotesPlansDocs/DATA-sifOmittedContainerElements-080926.tsv` | the full enumeration, 6,586 rows |
| `assets/standardSourceData/01/README_PROVENANCE.md` | the corpus record and the R-SF-6 canonical-source ruling in full |
| `forges/README_ValidationCertificateStandard.md` | how this document is meant to be written |

Certificate written 2026-08-07 by session VIOLET_STONE from a build it ran; restructured 2026-08-09 by
session CRYSTAL_ORBIT, incorporating the source inventory produced by session QUIET_LOOM. Build
figures unchanged. Revision history lives in `README_ValidationDetail.md`, not here.
