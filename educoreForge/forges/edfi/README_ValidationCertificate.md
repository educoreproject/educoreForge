# Validation certificate — Ed-Fi

## Summary

**Everything this graph says, Ed-Fi says. It does not say everything Ed-Fi says.** Nothing was
invented. 349 statements the source makes are missing, every one of them enumerated by name.

**This round trip validation supports the judgement that this graph is trustworthy but not complete.**
Trustworthy, because the hard line held: a reader can rely on any statement the graph carries. Not
complete, because 205 of the missing statements carry real model content and are not recoverable from
what is there. **Ed-Fi is the only one of the four bundles that cannot claim completeness**, and that
is the honest state of unfinished enrichment work rather than a failure — the build passed, correctly.

| | |
|---|---|
| standard | Ed-Fi Data Standard 5.2.0 — 849 MetaEd constructs, 1,904 properties, 3,522 descriptor code values — plus TPDM Community Model 1.2 |
| corpus | `forges/edfi/assets/standardSourceData/04/` — five declared inputs, see Provenance |
| recipe | `recipes/fourWithNewPescRoundTripNoBridges.recipe.jsonc` — `roundTripStage: true`, `hubs: []`, `bridges: []` |
| run | `fourWithNewPescRoundTripNoBridges_20260808-001444`, 2026-08-07 |
| commit | branch `architecture-improvement`; the recipe is committed at `a0a4a90` |
| graph | `DEV_FourWithNewPesc` — resolve the bolt port from the container, never from a document |

**Resolving the port from the container is load-bearing, not decorative.** This graph is the
configured DME golden, so ordinary DME use provisions from it: on 2026-08-09 it was stopped and
restarted inside two seconds by a user-graph provisioning event. Nothing in this campaign owns it
exclusively and a restart can move a port mapping.

Ed-Fi is one island in a four-standard graph — 100,979 nodes total, Ed-Fi 6,336, CEDS 25,202,
SIF 27,069, PESC260805 42,372 — with zero cross-standard edges by design. Nothing here speaks to how
Ed-Fi maps to anything.

---

## The counts

```
statements reproduced .......... 25,374
invented ....................... 0
missed ......................... 349
  contentGap ................... 349      real loss — counted in missed
  explicitlyOmitted ............ 0        see known issue 3
roundTripClean ................. false
```

**The 349 is not one backlog. It is 205 statements of model content and 144 of bookkeeping**, and the
distinction decides how much of it matters:

```
interchangeComponentKind ........ 205     MODEL CONTENT — whether an interchange carries an
                                          entity in full (element) or only as an identity
                                          reference (identityTemplate). 199 / 6 split.
itemMetaEdId .................... 130     bookkeeping — the publisher's hierarchical tracking
                                          id for an item inside a construct, e.g. Assessment
                                          [2516-002] inside Interchange [2516].
itemNamespaceQualifier ........... 14     bookkeeping — the `EdFi.` prefix on TPDM
                                          cross-namespace references. All 14 carry the
                                          identical value and the graph already resolves to
                                          the right node.
```

**Reading 349 as one undifferentiated figure overstates the model-fidelity cost by about forty per
cent of the count.** But **bookkeeping here means lower stakes, not no stakes.** `itemMetaEdId` is a
reader's only thread from a statement in the graph back to the exact line of the published document it
came from, so losing all 130 costs **traceability to source** — a real cost to anyone later auditing
this graph against Ed-Fi, even though it constrains nothing in the model. Genuinely lower priority
than the 205, and genuinely not zero.

**`explicitlyOmitted` is zero, and structurally so** — nothing can ever land in that pile. See known
issue 3; it is deliberate and it fails in the safe direction.

**Invention fails a build. Loss does not, and this is why Ed-Fi passed.** An invented statement is a
claim Ed-Fi never made, and no amount of coverage excuses one, so invention fails unconditionally. A
gap is a coverage problem, so it is tolerated, logged and enumerated as the enrichment meter. The gate
certifies on `inventedTotal = 0`, not on `roundTripClean`, and that is deliberate.

```
graphBuilder: [goldEvalCheck] PASS — 4 declared validator(s) ran with inventedTotal=0     exit 0
```

---

## Round Trip Validation

**One validation process ran, and its independence is real but bounded.** Unlike CEDS and PESC260805,
this bundle has no second instrument written by anyone else.

`lib/roundTripMetaEdCanonical.js` reduces the MetaEd source text, the descriptor XML and the crosswalk
CSV to a canonical statement set — the answer-key side — while the graph side is emitted from the
materialized graph scoped to Ed-Fi, and the two are compared by set membership.

**It shares zero code with the forge's own parser** (`metaEdLexer.js`, `metaEdSyntaxParser.js`,
`metaEdParser.js`) and loaders, and the strategy differs on purpose: a masking scanner plus a flat
keyword-phrase extractor, with no token-type registry, no recursive descent and no resolved model.
That matters because **if the instrument reused the forge's parser, a parser bug would cancel on both
sides of the diff and a dropped statement would read as reproduced.**

**The module states its own limit and states it correctly:** *the independence is of code path and
failure mode, not of mind — same author, same reference grammar.* What bounds it instead are the
adversarial-pair fixtures, where cosmetic variants must collapse and semantic variants must not, and a
two-independent-readers census cross-check against the Phase 1 census of record, with disagreement
counting as a finding either way.

**Refusal boundaries, so that measuring less is never silent.** The reducer accepts the published
packages' bare `topLevelEntity` file form across all 849 corpus files; an explicit `Begin Namespace`
wrapper is a **refusal by name, not a skip**, so a future snapshot shipping wrapped files surfaces for
adjudication instead of quietly measuring less. Any text the reducer cannot classify is a
canonicalization fault — fatal, never advisory — because a half-reduced document must not produce a
verdict someone might believe.

---

## Known issues

Ordered by consequence. Full treatment in `README_ValidationDetail.md` and in
`system/management/zNotesPlansDocs/FINDINGS-edfi349AndRWO15d-080926.md`.

1. **The 205 lost `interchangeComponentKind` statements are total, not partial, and not recoverable.**
   Every interchange component in the standard, across all 32 interchanges. The value reaches the
   emission and dies there — it is already formatted into an `edgeContext` argument that `addEdge`
   discards. **It cannot be derived back from the graph:** five entities (Assessment, AssessmentItem,
   LearningStandard, ObjectiveAssessment, Section) appear with *both* kinds in different interchanges,
   because the kind is a property of the relationship rather than of the target. Any target-keyed
   reconstruction would emit the wrong kind in eleven specific places — that is, would manufacture
   invented statements. **The gap is real and carrying it is the only honest fix.**

2. **All three losses share one architectural cause: they are edge attributes, and Ed-Fi edges carry
   none.** The graph keeps `metaEdId` faithfully wherever the item is a node and loses it wherever the
   item is an edge. Four sibling forges already carry arbitrary extra edge properties and the replay
   engine already persists them, so closing this is no contract change.

3. **`explicitlyOmitted` is structurally unreachable, by design, and it fails safe.** The bucket
   selector returns `contentGap` for every registry entry *and* for the default, so the counting
   branch is dead code and the pile is declared empty by design. The consequence is that this bundle
   can only ever **over**-report loss, never hide it. **Note that the fork was one boolean wide:**
   `roundTripClean` is defined as `contentGap === 0 && invented === 0`, `explicitlyOmitted` does not
   participate, and had those 349 been sorted into the other pile Ed-Fi would have reported clean.
   The current classification is the correct one.

4. **Fixing issue 1 requires a prerequisite, and the order is not optional.** The replay engine MERGEs
   edges on `(fromRef, type, toRef)` with last-write-wins, and gate 1 checks only the count of the
   edges array, never its uniqueness. Today a collapse is harmless *because* the properties are
   identical — which is exactly what makes the defect latent rather than absent. **Persist
   `componentKind` and a collapse becomes lossy:** two components of one interchange pointing at the
   same entity with different kinds would silently lose a statement. Measured exposure is currently
   zero — 8,171 declared edges, 8,171 distinct triples — so nothing is wrong today. **The uniqueness
   gate must land before the edge properties do.**

5. **Gate 2's failure message names one cause as though it were the only one.** On a mismatch it says
   the loader dropped or added something; a block-side duplicate collapsing under MERGE would produce
   the same mismatch. The gate would still correctly fail — **its stated diagnosis would send the next
   person to the wrong file.** Found, named, and deliberately left unfixed.

6. **This bundle declares no `semanticValidationLimit`**, so what the round trip does and does not
   model does not travel with the number. The qualifications here are *derived* by reading the
   canonicalizer, and a derived qualification drifts the moment someone edits the module. The run's own
   stage summary carries the explicit "none declared" marker, so the absence is recorded rather than
   merely missing.

7. **The declared-equivalence policy list is a filtered subset and does not say so.** `R-WO-15` runs
   (a) through (f), but the canonicalizer's header block enumerates only the *equivalences* — (a), (b),
   (c) — plus the instrument limit (e), because (d) and (f) are expected-**loss** rulings and belong to
   a different category. The lettering is preserved through the filter, leaving a hole that reads as an
   omission. **Do not renumber:** the letters are cited in code, recipe, verdict artifacts and DEVLOG.
   Separately, the code labels `itemMetaEdId` and `itemNamespaceQualifier` as "R-WO-15d extension" when
   it is (f) that authorizes them — a misattribution, not a missing policy.

8. **Declaration order within a construct is not measured.** Set semantics, so a reordering of
   declarations inside a construct cannot register as a difference. *(Contrast SIF, where order is part
   of statement identity. The four bundles do not agree on this and a reader comparing them should not
   assume they do.)* Comment lines are excluded by the publisher's own grammar — 19 in this run, each
   censused with file and line rather than silently dropped.

9. **Whether carrying the three edge properties disturbs anything downstream is not established.** The
   investigation read the forge, the instrument and the replay engine — not the DME, not search, not
   any consumer walking `REFERENCES` edges. Treat that as unexamined rather than clear.

---

## Provenance

Snapshot `04`, acquired 2026-08-03. **Five declared source inputs, each with its acquisition class
stated separately**, because they are not all of the same kind.

| input | what it is | class | in git? |
|---|---|---|---|
| `metaEdModel/` | `@edfi/ed-fi-model-5.2` v3.0.1 — 653 `.metaed` files, THE canonical source; the standard is authored in MetaEd | machine-canonical | **no — gitignored under the Ed-Fi Alliance License** |
| `descriptorCodeValues/` | 203 descriptor code-value XMLs, the only machine-readable home of the default code sets | machine-canonical | yes |
| `tpdmCommunityModel/` | TPDM Community Model v1.2, 196 `.metaed` | machine-canonical | yes |
| `tpdmDescriptorCodeValues/` | 27 TPDM descriptor XMLs | machine-canonical | yes |
| `cedsAuthoredCrosswalk/` | the authored Ed-Fi→CEDS crosswalk, 2 CSVs | **human-artifact-snapshot** | yes |

Upstream: `https://pkgs.dev.azure.com/ed-fi-alliance/.../@edfi/ed-fi-model-5.2/-/ed-fi-model-5.2-3.0.1.tgz`
for the model package, and the Ed-Fi Alliance GitHub organisations for the rest —
`Ed-Fi-Data-Standard` at tag `v5.2.0` (`bb65fc2e`), `Ed-Fi-TPDM-Community-Model` at tag `v1.2`
(`a43d2a1d`), and `Ed-Fi-TPDM-Artifacts` (`de6f7c27`).

**The mixed classes matter.** The round trip against the four machine-canonical inputs proves fidelity
to the publisher's own artifacts. For the crosswalk it proves losslessness against *this snapshot
only* — the original harvest recorded no upstream URL or version, so fidelity to the publisher's
intent is exactly as good as the snapshot is. Version evidence for it is circumstantial but real: all
8,310 descriptor-CSV data rows stamp `EdFiVersionNumber=DS5.2`.

**A clone does not have the whole corpus.** `metaEdModel/` is gitignored because the licensed bytes are
never committed, so a git-clone consumer must run the acquisition recipe in the provenance README
before forging. `SHA256SUMS` covers every source file in all five subfolders including the gitignored
bytes, so "same bytes" is provable on any machine: `cd 04 && shasum -c SHA256SUMS --quiet`.

**The crosswalk is stashed, not mapped, and that is a deliberate refusal.** 1,147 Ed-Fi nodes carry an
authored `cedsId`. **That is the answer key, not an input** — loading the authored bridge and then
scoring against it would be marking our own homework. It is guarded against invention by raw-value set
membership, with `violationCount 0` in this run.

---

## For more information

| document | what it holds |
|---|---|
| `README_ValidationDetail.md` | the evidence behind every figure above, the declared equivalence policy in full, the gate-2 attribution defect, and the commands to reproduce this run |
| `system/management/zNotesPlansDocs/FINDINGS-edfi349AndRWO15d-080926.md` | the investigation that decomposed the 349, established non-derivability, and found the sequencing constraint in known issue 4 |
| `assets/standardSourceData/04/README_PROVENANCE.md` | the corpus record — five inputs, licences, and the exact rerunnable acquisition recipe |
| `forges/README_ValidationCertificateStandard.md` | how this document is meant to be written |

Certificate written 2026-08-07 by session VIOLET_STONE from a build it ran; restructured 2026-08-09 by
session CRYSTAL_ORBIT, incorporating findings from session OCEAN_DELTA. Build figures unchanged.
Revision history lives in `README_ValidationDetail.md`, not here.
