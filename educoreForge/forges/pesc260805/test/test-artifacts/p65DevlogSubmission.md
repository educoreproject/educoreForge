# PHASE 6.5 — DEVLOG SUBMISSION (drafted by RADIANT_LOOM, 2026-08-07, for JADE_PORTAL to place)

**THIS FILE IS NOT THE CAMPAIGN RECORD AND DOES NOT AMEND IT.** JADE_PORTAL's standing instruction is
that the supervisor owns `DEVLOG-pescForgeRebuild-080526.md` and `DESIGN-pescGraphModel-080526.md`; a
later instruction asked that several Phase 6.5 items "be in the DEVLOG". Rather than resolve that
ambiguity in my own favour by editing a document I was told not to touch, the text is staged here for
the supervisor to place, amend or discard. Every figure below has a receipt named in the last section.

---

## PHASE 6.5 — EXTRACTOR/EMITTER COMPLETION (builder RADIANT_LOOM, 2026-08-07)

### GATE 6.5, OBSERVED

The independent instrument (Python `xmlschema` 4.3.2, `XMLSchema11`) compiles the reconstructed corpus
with a refusal count MATCHING the source corpus, and the refusals are the same files for the same
reasons:

| | source | reconstructed |
|---|---:|---:|
| attempted | 64 | 64 |
| clean | **55** | **55** |
| refused | **9** | **9** |

`sameRefusedFilenameSet: true`, `allCausesIdentical: true`. All nine are cross-version reference
defects in PESC's own published bytes (3 × missing group `core:OrganizationIDGroup`, 6 × unknown type
`AcRec:TransmissionDataType` / `AcRec:TestScoreReportType`). `componentComparison` rose from
`comparedTypeTotal` **1** to **25,540** with zero differences on every dimension.

`roundTripClean true` · `reproduced 173,216` · `inventedTotal 0` · **`lostTotal 0`**

### THE 293 WAS NEVER CONTENT LOSS — IT WAS CONTENT THE COMPARATOR COULD NOT SEE

The ruled 293 (268 `usesGroup` + 25 `allowsAnyElement`) is now 0, and three facts must travel with
that number so a reader is not left to reconstruct the difference:

1. **The graph-model fact is UNCHANGED.** The forge still builds no node for an `xs:group ref` or an
   `xs:any`, and `lib/parser.js` was not touched.
2. **The 293 closed as a CONSEQUENCE** of emitting the ordered particle list, because those particles
   ride inside `contentModelShape`, which the emitter had never read.
3. **Therefore the 293 was the same root cause as the compositors** — not loss, but content the
   comparator could not model. *(Supervisor note, JADE_PORTAL: relaying the 293 upward as genuine loss
   was the supervisor's error and its correction is the supervisor's, not the builder's.)*

Omitting those particles was not an option rather than an option declined: 84 shapes in this corpus
hold ONLY group references or wildcards, and would have emitted empty sequences.

### DOCTRINE — A FAIL-FAST REPORTER MAKES EVERY CAUSE TALLY A FIRST-ERROR TALLY

Phase 6 published "62 of 63 refusals are `element particle not inside a compositor`". That was true and
INCOMPLETE. **A schema processor reports the FIRST fault per component**, so a tally of causes across
refusals measures what failed first, never what is wrong. With the compositor defect repaired, the
instrument still returned 1 clean / 63 refused, and the real message was
`Unexpected child with tag 'xs:simpleContent' at position 3` — a second defect of the identical family
that the classifier was still binning under the old label.

**This generalizes past this instrument: any counter fed by a fail-fast reporter measures what failed
first, not what is wrong.** A cause tally from such a source is a lower bound on the number of distinct
defects, and it must be read as one.

### THE FIFTH DEFECT, AND THE SHAPE OF THE FIX THAT WAS NOT TAKEN

**The attribute placement (F-1).** The parser attributes `xs:attribute` to the CONTAINER by the same
rule it applies to elements, so the 14 attributes declared inside a `simpleContent` extension were
emitted OUTSIDE it, before the wrapper. XSD permits a complexType carrying simpleContent/complexContent
no other children but annotation. Pre-existing and byte-identical in Phase 5's committed emission.

**The obvious compositor fix would have left 478 types broken (F-2).** Wrapping the flat child run in
an `xs:sequence` at the TYPE level repairs 2,517 types and fails 478, because those carry a
`complexContent/extension` AND 2,105 element declarations parented to the type rather than to the
derivation; a complexType carrying both an `xs:sequence` and an `xs:complexContent` is refused by every
conforming processor. **Where the elements were parented was MEASURED before any code was written**,
which is the only reason the placement rule was found rather than discovered by a failing gate.

### THE ELEMENT-ORDER BLIND SPOT IS CLOSED, ON INDEPENDENT EVIDENCE

Phase 6 declared element order undetectable, on the stated ground that no statement subject carried an
ordinal. The canonicalizer now emits `particleAt/N`, and the ground is false.

**Phase 6's OWN mutation suite, run UNMODIFIED against the Phase 6.5 code, printed
`swapTwoSiblingElements: expected blind, observed CAUGHT` and exited non-zero.** That suite was written
by a different phase to measure the primary comparator rather than to flatter it, so it is an
independent confirmation. CAUGHT went 4 → 5; documented blind spots 2 → 1.

**`repointReferenceToOtherNamespace` REMAINS BLIND and is unchanged** — `canonicalTypeRef` still strips
the prefix, so a repoint to a same-named type in another namespace canonicalizes identically. That is
R-ID-1's fusion surviving in the object space and it is still open.

### AN ARTIFACT OF A CLOSED PHASE WAS AMENDED — RECORD, NOT DISCOVERABLE BY DIFF

`test/probes/p6_mutationSuite.js`, entry `swapTwoSiblingElements`: `expectation` changed
**`'blind'` → `'caught'`**, by RADIANT_LOOM on 2026-08-07, ratified by JADE_PORTAL.

- **The mismatch was OBSERVED FIRST** and that run is in `p65PersistRun.log`; the edit came after.
- Phase 6's stated ground for `'blind'` is now factually false, and a false pre-registered expectation
  is the same defect class as a false limitation declaration.
- Leaving it would have handed Phase 7 a non-zero exit to mis-attribute.
- It is one line plus a comment. No other Phase 6 file was changed.

### THE PUBLISHED 3,021 xs:sequence IS SUPERSEDED BY 3,042

Counted four independent ways over the raw corpus bytes by the supervisor and two ways by the builder:
occurrences 3,042, opening tags 3,042, closing tags 3,042, self-closing 0. `xs:choice` is 211, matching
the published figure. **The counts are internally consistent, so 3,042 is the number.**

The builder observed that 3,021 is exactly the `declaresComplexType` statement count. **That stands as
an OBSERVATION and NOT as a mechanism.** The 21 is left unexplained rather than given a story.

### THE RED LEVER DID NOT PRODUCE THE CHARTERED OUTCOME, AND WAS NOT MADE TO

The charter asks that stripping `contentModelShape` make the reconstructed document for that type
INVALID. It makes the emitter **REFUSE BY NAME and emit no document at all**, so the chartered outcome
is UNREACHABLE BY DESIGN — the standing rule to refuse rather than substitute forbids emitting from
data known to be incomplete. Refusal is the stronger result and the code was not weakened to produce an
invalid document instead. *(Supervisor: accepted; "refusing to emit from data known to be incomplete is
the rule working.")*

The read-not-guess claim is carried instead by `flattenNestedCompositorToGuessersSequence`, which
replaces a nested shape with EXACTLY what a child-order guesser would emit and observes the output move.

**THE ONE PATH THAT DOES NOT REFUSE IS PUBLISHED AS ITS OWN LEVER.** 84 shapes hold only group
references or wildcards and declare no element children, so a missing shape there is indistinguishable
AT THE NODE from a type that legitimately has no content model. It emits a valid but content-less type
and is caught by the diff, not by a refusal. Boundary measured at 84, not asserted.

### PUBLISHED SHORTFALLS OF THE RECONSTRUCTION VERSUS SOURCE — ALL PRE-EXISTING

Identical in the pre-6.5 committed reconstruction, therefore not caused by Phase 6.5:

| construct | source | reconstruction | short |
|---|---:|---:|---:|
| xs:sequence | 3,042 | 3,037 | 5 |
| xs:group[ref] | 283 | 282 | 1 |
| xs:element | 17,164 | 17,140 | 24 |
| xs:complexType | 3,216 | 3,211 | 5 |
| xs:documentation | 26,652 | 26,624 | 28 |

The five complexTypes are `OrganizationType` (AdmissionsRecord_v1.0.0) and `SponsorType` declared
**TWICE in the source bytes** of AdmissionsRecord_v1.1.0 through v1.4.0, where the graph and the
reconstruction carry one.

**Of the 28 documentation literals, 5 are the RULED multi-documentation residue** (measured: 26,647
annotations in source, exactly 5 carrying more than one `xs:documentation`, 5 extra literals). **The
remaining 23 are UNATTRIBUTED. No mechanism is offered and none should be invented** — they are
pre-existing, and they belong to Phase 7's evidence accounting.

### CONSERVATION — NOTHING PREVIOUSLY EMITTED MOVED

Old committed reconstruction versus new, same graph: `xs:element`, `xs:attribute`, `xs:complexType`,
`xs:simpleType`, `xs:extension`, `xs:restriction`, `xs:enumeration`, `xs:documentation`,
`xs:complexContent`, `xs:simpleContent` — **all delta 0**. The only movements are the intended
additions: +3,037 `xs:sequence`, +211 `xs:choice`, +282 `xs:group ref`, +25 `xs:any`, +153 xmlns
declarations (64 → **217**, which now matches source exactly).

---

## RECEIPTS — every figure above, on disk

All paths relative to `system/code/educoreForge/forges/pesc260805/`.

| artifact | what it evidences |
|---|---|
| `test/test-artifacts/p65PersistRun.log` | the whole run, in order, with the commands |
| `test/test-artifacts/p65PersistRun.pid` | the detached run's PID |
| `test/test-artifacts/p65RoundTripRun1/roundTripVerdict.json` | roundTripClean, reproduced 173,216, lost 0, invented 0, the rewritten `semanticValidationLimit` |
| `test/test-artifacts/p65RoundTripRun1/roundTrip.report.txt` | the human-readable report with the rewritten limitation text |
| `test/test-artifacts/p65RoundTripRun1/independentXsdCheck.json` | both corpora's per-file compile outcomes (23 MB) |
| `test/test-artifacts/p65RoundTripRun1/independentXsdCheck.report.txt` | the instrument's rendered summary |
| `test/test-artifacts/p65RoundTripRun1/emitted/` | the 64 reconstructed documents this run measured |
| `test/test-artifacts/p65IndependentRefusalAgreement.json` | 55/9 vs 55/9, the nine filenames, both sides' messages, `allCausesIdentical` |
| `test/test-artifacts/p65ContentModelLevers/p65ContentModelLevers.json` | 8 of 8 red, per-lever 6.5-view and OLD-view deltas, old-form total asserted at 142,345 |
| `test/test-artifacts/p65MutationSuiteRerun/p6MutationSuite.json` | Phase 6's suite under 6.5: CAUGHT 5, blind 1 |
| `test/test-artifacts/p65ConservationCensus.json` | the old/new/source construct census and `conservationHolds` |
| `test/probes/p65_contentModelLevers.js` | the levers, re-drivable |
| `test/probes/p65_conservationCensus.js` | the census, re-drivable |

**To re-drive, from the bundle directory** (each command below was executed, not proof-read):

```
node -e "const p=require('path');require('./roundTripValidator.js')().validate({containerName:'DEV_pesc260805',snapshotPath:p.join(process.cwd(),'assets/standardSourceData/01'),outputPath:p.join(process.cwd(),'test/test-artifacts/p65RoundTripRun1')},(e,v)=>console.log(e||v.roundTripClean,v&&v.lostTotal,v&&v.inventedTotal))"

jq -nc '{containerName:"DEV_pesc260805",outputPath:"test/test-artifacts/p65ContentModelLevers"}' \
  | node test/probes/p65_contentModelLevers.js

jq -nc '{reconstructedPath:"test/test-artifacts/p65RoundTripRun1/emitted",outputPath:"test/test-artifacts"}' \
  | node test/probes/p65_conservationCensus.js

jq -nc '{containerName:"DEV_pesc260805",outputPath:"test/test-artifacts/p65MutationSuiteRerun"}' \
  | node test/probes/p6_mutationSuite.js
```

**The bolt port is resolved from the container in every one of these.** A reviewer who takes 7811 from
a document reads the PRE-4.6a graph `DEV_pesc260805_phase45` and will see 522 legitimate children
reported as missing.
