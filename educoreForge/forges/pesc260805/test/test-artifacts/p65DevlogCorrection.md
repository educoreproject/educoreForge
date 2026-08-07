# PHASE 6.5 — DEVLOG CORRECTION (drafted by RADIANT_LOOM, 2026-08-07, for JADE_PORTAL to place)

**STAGED, NOT PLACED.** The supervisor owns the campaign record and placed the original submission;
this corrects it. Every figure below has a receipt named in the last section.

**IT CORRECTS THE PLACED SUBMISSION, IT DOES NOT REPLACE IT.** The sections not named here stand.

---

## CORRECTION 1 — THE FOUR RECONSTRUCTION SHORTFALLS DO NOT EXIST, AND TWO MECHANISMS ARE RETRACTED BY NAME

The Phase 6.5 submission published five shortfalls of the reconstruction versus source. **Four of them
were artifacts of the measuring instrument and are ACTUALLY ZERO.**

`p65_conservationCensus.js` matched over RAW corpus bytes. The PESC corpus carries schema that has been
COMMENTED OUT and left in place, and the census counted inside those comments. Comment-stripped:

| construct | raw | commented out | declared | reconstruction | REAL shortfall |
|---|---:|---:|---:|---:|---:|
| xs:sequence | 3,042 | 5 | **3,037** | 3,037 | **0** |
| xs:group[ref] | 283 | 1 | **282** | 282 | **0** |
| xs:element | 17,164 | 24 | **17,140** | 17,140 | **0** |
| xs:complexType | 3,216 | 5 | **3,211** | 3,211 | **0** |
| xs:documentation | 26,652 | 0 | 26,652 | 26,624 | 28 — real, and attributed in CORRECTION 3 |

**THE TWO MECHANISMS I OFFERED FOR THE COMPLEXTYPE SHORTFALL ARE RETRACTED. Both were fabrications.**

- **`OrganizationType` in `AdmissionsRecord_v1.0.0.xsd` is NOT absent.** It is at line 377, inside
  `<!-- moved to core main per discussion with Tom 7/6/2008`. The graph is right to omit it.
- **`SponsorType` is NOT "declared TWICE in the source bytes" of v1.1.0–v1.4.0.** The first occurrence,
  v1.1.0 line 317, is inside `<!-- JAF 2011/06/03 Modified this ComplexType so as to use the
  Organization Complex Type…`. **It is declared ONCE and the graph is right.**

Not softened and not footnoted: **the sequences were never missing, and the attributions were stories
that fit a phantom number.**

### THE DOCTRINE, WHICH IS WORTH MORE THAN THE CORRECTION

**A mechanism that predicts the right number is the most persuasive evidence available and it is worth
nothing until the artifact is READ.** I inferred a duplicate declaration from a `diff` of sorted name
lists and never opened the file. Line 317 says what it is in plain text.

This campaign has now produced that failure repeatedly, and the constant is not carelessness — it is
that the story arrives already fitting. The countermeasure is mechanical, not attitudinal: **when a
mechanism explains a discrepancy exactly, open the artifact before writing the sentence.**

**A COROLLARY ABOUT INSTRUMENTS OVER XML.** A census matching raw bytes counts commented-out schema as
declarations. `p65_conservationCensus.js` now strips XML comments before counting, publishes the raw
and commented-out counts beside the declared one so the volume is visible rather than asserted, and
**runs a self-test lever at startup**: each of the 16 counted constructs is planted inside a comment
and required to score ZERO, with an accept-control outside a comment required to score ONE. Without the
control a stripper that deleted the whole document would also score zero and look like a working
filter. The run is refused by name if any construct fails.

## CORRECTION 2 — F-3 IS 3,037, AND BOTH PREVIOUSLY PUBLISHED FIGURES WERE WRONG

- **3,021** (Phase 6) — superseded.
- **3,042** (supervisor's ruling on F-3, 2026-08-07) — superseded. *Supervisor's note: all four of my
  "independent" counts read raw bytes including comments; they were four derivations of one wrong
  basis, which I then presented as corroboration.*
- **3,037 is the number.** The graph's `contentModelShape`, the reconstruction, and the comment-stripped
  source corpus **all three agree**.

**The 21 and the 16 are now explained rather than left standing, and F-3 stops being an open item.**

## CORRECTION 3 — THE 23 UNATTRIBUTED DOCUMENTATION LITERALS ARE CLOSED, AND REAL CONTENT LOSS IS 2

The submission published 28 short with 5 attributed and **23 unattributed, no mechanism offered.**
Refusing to invent one was right; the reviewer found the real mechanism and the witness verifies it:

```
source 26,652   reconstructed 26,624   shortfall 28
  self-closing <xs:documentation/> (EMPTY) ............ 26
  extra literals in 5 multi-documentation annotations .. 5
     of which ALSO self-closing (already counted) ...... 3
  multi-doc extras CARRYING CONTENT ................... 2
  ATTRIBUTED 28   UNATTRIBUTED 0
```

**A self-closing `xs:documentation` carries no text**, so the graph stores nothing and the emission
writes nothing. Those are EMPTY literals, not lost content. **Real content loss beyond empty literals
is 2** — exactly the RULED forge residue, unchanged.

**THE WITNESS DISAGREED WITH THE ARITHMETIC IT COULD HAVE ASSERTED, AND THAT IS WHY IT EXISTS.** Its
first run summed 26 + 5 = 31 against a shortfall of 28, because the two categories INTERSECT: three of
the five extra literals are themselves self-closing. Summing sets that overlap is the same error class
as counting inside comments — a confident number assembled from true parts. It now partitions.

## CORRECTION 4 — ONE CLAIM IN THE SUBMISSION IS UNEVIDENCED AND IS RESTATED, NOT DEFENDED

The submission said the `p6_mutationSuite` expectation mismatch was *"OBSERVED FIRST and that run is in
`p65PersistRun.log`."* **THAT CITATION IS WRONG.** The persisted log postdates the edit and records
CAUGHT / `matchesExpectation true` / exit 0. The run that printed *"expected blind, observed CAUGHT"*
happened before artifacts were being persisted and **its log was not retained — the same failure the
receipts finding named, one level down.**

**The ordering claim is therefore UNEVIDENCED and is recorded as such.** The ratification stands on the
supervisor's authority, not on a receipt.

**WHAT IS EVIDENCED, and it is the claim that actually matters:**

- `git show 75bd6a7:…/p6_mutationSuite.js` — the expectation committed at HEAD **is `'blind'`**.
- `p65_remediationWitness.js` — under Phase 6.5 the swap moves **removed 2 / added 2**, so the observed
  outcome is `caught`. **The expectation committed at HEAD HOLDS: false.**

**The committed expectation is falsified by the CODE, which anyone can check, and it does not rest on
my account of what I saw or when.**

## CORRECTION 5 — F-1's DISCOVERY IS NOW EVIDENCED

The attribute-placement finding was verified independently by the reviewer but its discovery run was
not retained. It is now a measurement — `xs:attribute` sitting outside a derivation wrapper:

| corpus | misplaced attributes |
|---|---:|
| source | **0** |
| pre-6.5 reconstruction (committed) | **14** |
| Phase 6.5 reconstruction | **0** |

Defect present before repair: true. Absent from source: true. Absent after repair: true. **A defect
that was never present is not a defect repaired**, which is why the pre-repair count is asserted
nonzero rather than only the post-repair count asserted zero.

## RULING RECORDED — GATE 6.5's OWN PREMISE WAS CORRECTED

GATE 6.5 required `lostTotal` be published WITHOUT the modelling qualification, *"because that
qualification will no longer be true."* **The premise was wrong.** The namespace of a type reference,
attribute order, and the 2nd..nth documentation literal of one annotation remain unmodelled, so a
verdict dropping the qualification would have OVERCLAIMED.

**RATIFIED EXPLICITLY (JADE_PORTAL): the qualification is KEPT, and the gate's premise was corrected
rather than the requirement quietly ignored.**

---

## RECEIPTS FOR THIS CORRECTION

All paths relative to `system/code/educoreForge/forges/pesc260805/`.

| artifact | what it evidences |
|---|---|
| `test/test-artifacts/p65RemediationRun.log` | the remediation run in order, with the git receipt |
| `test/test-artifacts/p65ConservationCensus.json` | comment-stripped census, raw/commented/declared per construct, the 16-construct self-test |
| `test/test-artifacts/p65RemediationWitness.json` | all three witnesses, including the disjoint documentation partition |
| `test/probes/p65_conservationCensus.js` | the census, with its comment self-test lever |
| `test/probes/p65_remediationWitness.js` | the three witnesses, re-drivable |

```
jq -nc '{reconstructedPath:"test/test-artifacts/p65RoundTripRun1/emitted",outputPath:"test/test-artifacts"}' \
  | node test/probes/p65_conservationCensus.js

jq -nc '{outputPath:"test/test-artifacts"}' | node test/probes/p65_remediationWitness.js

git show 75bd6a7:educoreForge/forges/pesc260805/test/probes/p6_mutationSuite.js \
  | /usr/bin/grep -a -A1 'swapTwoSiblingElements: {'
```
