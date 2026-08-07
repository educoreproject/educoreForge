# PHASE 7 — DEVLOG HANDOFF BLOCK (staged by SCARLET_GARDEN, 2026-08-07, for JADE_PORTAL to place)

> **THIS FILE IS NOT THE CAMPAIGN RECORD.** It is a staged submission for the supervisor to place at
> the top of `DEVLOG-pescForgeRebuild-080526.md`. The DEVLOG is outside this session's working
> directory and the supervisor has previously stated it owns the campaign record; the Phase 6.5
> builder staged its text the same way and that handling was ratified. Nothing was written to the
> DEVLOG without a ruling.

---

## PHASE 7 CLOSING HANDOFF — INTEGRATION, EVIDENCE ACCOUNTING, CLOSEOUT (session SCARLET_GARDEN, 2026-08-07)

> **SUPERSEDED IN PART BY THE REMEDIATION SECTION AT THE FOOT OF THIS FILE.** An independent review
> found four real defects in the first submission, one of them severe. Where a figure below disagrees
> with the remediation section, **the remediation section wins** — it is measured from a single named
> run, which the first submission's figures were not.


**A SUCCESSOR SHOULD BE ABLE TO COLD-START FROM THIS SECTION AND NOTHING ELSE.** Everything below
was RUN from `system/code/educoreForge`, not proof-read. Where a figure here disagrees with the work
order or with an earlier DEVLOG section, this section is the measurement and it says how it was made.

### HEADLINE

**The round-trip stage has RUN INSIDE A REAL BUILD, and GATE 7 passes.**

```
graphBuilder: [goldEvalCheck] PASS — 1 declared validator(s) ran with inventedTotal=0
```

The suites are **57 / 71 / 106 = 234 passed, 0 failed** — the first all-green state in this campaign.
The standing 54/1 failure is closed by re-pinning, not by deletion.

### DELIVERABLE 1 — THE STAGE RAN INSIDE A BUILD, PROVEN BY AN A/B PAIR

**The gap was real and it is documented in the Phase 5 build's own words.** `p5DeclaredBuild.log:28`
reads `[roundTrip] stage OFF (recipe default (roundTripStage absent))`. Phase 5 declared the
validator and watched a build complete, which proved only that DECLARING it breaks nothing. **A
declared-but-never-invoked stage emits no error, no log line and no failing test — it is
indistinguishable from a working one by inspection.**

Two builds of the SAME bundle through the ordinary `graphBuilder -build` recipe path, differing only
in the recipe's `roundTripStage` opt-in, run sequentially (concurrent builds contend for scratch
container ports, which would confound a recipe difference with a resource difference):

| | stage OFF (`pesc260805Only`) | stage ON (`pesc260805OnlyRoundTrip`) |
|---|---|---|
| build log line | `[roundTrip] stage OFF (recipe default (roundTripStage absent))` | `[roundTrip] validating PESC260805 against 'DEV_gb_materialize_6592_2'` |
| stage summary | `stageRan: false`, `disposition: "off: recipe default…"` | `stageRan: true`, `disposition: "ran"` |
| `roundTripVerdict.json` | **absent** | **present** |
| `independentXsdCheck.json` | **absent** | **present** |
| `-goldEvalCheck` | **REFUSED, exit 1** | **PASS, exit 0** |

**EVERY ROW IS A BUILD PRODUCT, NOT A RECIPE PROPERTY.** A diff of two recipe files would prove only
that the recipes differ. The refusal is the load-bearing half:

```
graphBuilder -goldEvalCheck: REFUSED — the round-trip stage did not run for this build
(summary disposition: 'off: recipe default (roundTripStage absent)'). GOLD_EVAL certification
requires every declared validator to have run and reported (doctrine §7.4); rebuild with
roundTripStage: true in the recipe.
```

Run directories: `buildLogs/pesc260805Only_20260807-215206` and
`buildLogs/pesc260805OnlyRoundTrip_20260807-215615`.

**RECIPE NAMING — THE WORK ORDER WAS WRONG AND THE SUPERVISOR RATIFIED THE CORRECTION.** The order
named `pescV2Only` / `pescV2OnlyRoundTrip`. The bundle's token is `pesc260805`, its `standardName` is
`PESC260805` (ruling D-6), `pesc260805Only.recipe.jsonc` already shipped in Phase 4.5, and the house
idiom is `<token>Only` / `<token>OnlyRoundTrip` without exception. A `pescV2*` pair would have been a
THIRD name for one bundle beside `pesc` and `pesc260805` — the exact collision D-6 exists to prevent.
The Phase 7 line of the work order has been corrected in place by the supervisor.

**THE STAGE-OFF SIBLING'S RATIONALE WAS STALE AND IS CORRECTED, NOT DELETED.**
`pesc260805Only.recipe.jsonc` still said the validator was Phase 5's deliverable and that turning the
stage on would ask for a verdict from an instrument that does not exist. Phase 5 falsified that.
Left standing it read as a CURRENT prohibition. The superseded text is preserved verbatim inside the
file per standing rule 4, and the recipe now states its real current purpose: it is the CONTROL half
of the A/B pair, and deleting it would destroy the only proof the opt-in does anything.

### DELIVERABLE 2 — THE VERDICT, FROM INSIDE THE BUILD, ON ITS OWN TERMS

```
roundTripClean true · reproduced 173,216 · inventedTotal 0 · lostTotal 0
contentGapTotal 0 · explicitlyOmittedTotal 0 · whitespaceOnlyDifferenceTotal 0
syntheticReproducible true
```

**These reproduce Phase 6.5's hand-invoked figures exactly, now produced by the builder itself.**

**THE MODELLING QUALIFICATION TRAVELS WITH THE ZERO, and omitting it would be a defect in this
report.** `lostTotal 0` means zero loss **in the dimensions the comparator models**. Type-reference
NAMESPACE (`canonicalTypeRef` still strips the prefix — R-ID-1's fusion surviving in the object
space, the most serious residue), ATTRIBUTE ORDER, and the 2nd..nth `xs:documentation` literal of one
`xs:annotation` remain unmodelled, so they **cannot register as loss**. A dimension unread by the
emitter AND unmeasured by the canonicalizer reports zero on BOTH sides and reads as fidelity.

**NO COMPARISON IS MADE TO THE INCUMBENT'S 732.** Different corpus, different emitter, different
comparator (TQ's ruling, 2026-08-06). The bundle is self-contained in its own manifest (spec §8): one
manifest, one member, `memberCount: 1`.

**THE INDEPENDENT INSTRUMENT, run inside the build** (Python `xmlschema` 4.3.2, `XMLSchema11`):

| | source | emitted |
|---|---:|---:|
| attempted | 64 | 64 |
| clean | 55 | 55 |
| refused | 9 | 9 |
| traversalUnavailableTypes | 28 | 28 |

`sourceRefusalCauseTally` and `emittedRefusalCauseTally` are **identical objects**: 3 × missing group,
6 × unknown type. `compileAgreement`: `sharedFilenames 64`, `bothClean 55`,
`sourceCleanEmittedNotClean 0`, `emittedCleanSourceNotClean 0`. `componentComparison`:
`comparedTypeTotal 25,540` with all six difference totals **0**, `traversalUnavailableTotal 28`.

**A CORRECTION TO THE PHASE 6.5 HANDOFF'S FIELD NAMES, WITH THE SUBSTANCE UNCHANGED.** That section
publishes `sameRefusedFilenameSet true`, `allCausesIdentical true`, and refers to the emitted side as
`reconstructed`. **Those three property names do not exist in `independentXsdCheck.json`** — measured
with `/usr/bin/grep -a`, zero occurrences each. The artifact's keys are `emitted`, `compileAgreement`,
`sourceRefusalCauseTally` / `emittedRefusalCauseTally`. `bothClean`, `sourceCleanEmittedNotClean`,
`comparedTypeTotal` and `traversalUnavailableTotal` DO exist and DO reproduce. **The claim is true;
two of the names it is written in are not the artifact's**, so a successor querying by them gets
`undefined` — which is the absent-property read this campaign has been burned by three times. I hit
it myself on my first query of this file and caught it because the values came back `null` rather
than plausible.

### DELIVERABLE ZERO — THE EVIDENCE ACCOUNTING

Every figure below is COMPUTED by an instrument that runs, and every instrument carries an
accept-control. Where a figure disagrees with the work order, the disagreement is stated.

#### THE CONJUNCTION CLASS — measured, and the denominator now closes arithmetically

| quantity | value | how |
|---|---:|---|
| RAW `check(` occurrences | 241 | counted over unstripped bytes, in the same run |
| comment-resident (stripped before parsing) | 6 | — |
| **shipped assertion rows** | **235** | comment-stripped |
| executed assertions | 234 | from the suite run logs; all labels distinct |
| **carrying a top-level conjunction** | **77** | — |
| **`proven` AND carrying 3+ conjuncts** | **11** | the highest-risk rows |

**235 + 0 + 0 + 6 = 241, checked against an independently counted 241 in the same run.** The
instrument refuses if that arithmetic fails to close.

**The work order's `234 / 79 / 11` is superseded.** The 11 is unchanged; the other two moved as the
suites changed across Phases 5, 6, 6.5 and 7.

**THE 235-VERSUS-234 DIFFERENCE IS FULLY EXPLAINED AND IS NOT A DEFECT:** `source:367` carries
`check(\`INTEGRATION forge run (${err})\`, false)`, an error-branch assertion unreachable on a healthy
build. See the interpolated-label class below.

**THE CLASS IS A SPECIFICATION PROBLEM AND PHASE 7 DID NOT CLOSE IT — deliberately, and this is a
recommendation, not a silent omission.** Evidence is keyed to a LABEL; `A AND B` fails when EITHER
conjunct fails, so a receipt proves only that SOME conjunct can fail. Closing it needs one assertion
per claim, or a lever per conjunct, or a ledger that records evidence per conjunct. That is a change
to the ledger schema and to 77 assertions, and it is larger than this phase should absorb.
**RECOMMENDATION: scope it as its own phase**, and in the meantime adopt the cheap half — write new
assertions with zero top-level conjunctions, which costs nothing and stops the class growing.

#### THE EXPECTATION-LEVER SWEEP — the handed number is replaced by a computed one

| | ledger's recorded figure | **computed by `p7_expectationLeverSweep.js`** |
|---|---|---|
| proven rows total | 114 | **116** |
| resting on expectation levers ALONE | 63 | **65** |
| carrying at least one DATA lever | (not recorded) | **51** |

**51 + 65 = 116, and the instrument prints the closure.** The recorded figure was
`measuredBy: "the third independent adversarial review"` — **handed, not computed**, so nothing
recomputed it and it could not notice the ledger moving underneath it. The two are not strictly
comparable: the ledger has gained and lost rows since that measurement. **What matters is that the
figure is now reproducible and free to disagree with its author.**

Lever classification is a **declared registry**, longest-token-first, and it **REFUSES BY NAME** on a
lever whose opening token matches no declared class — a sweep that skipped what it could not read
would understate itself silently. Live classification of every red-evidence entry on a `proven` row:

```
  63  DATA         productionMutationShippedConfiguration
   3  DATA         productionMutation
   9  DATA         ledgerGateSelfDemonstration      (the LEDGER is that gate's production data)
   6  DATA         ledgerStaleEntryProbe            (a fabricated entry is a data mutation)
 117  expectation  expectationPerturbation
   1  expectation  harnessMutation                  (lands in the harness, not the certified thing)
   3  expectation  inheritedBaseline                (an OBSERVATION, not a lever — nobody moved anything)
```

**65 of 116 `proven` rows do NOT satisfy the standing rule.** The work order requires such a row to
stand as `genuineGap` where a data lever is impossible. **THAT RE-STATEMENT IS NOT APPLIED HERE and
the reason is a specification conflict I will not resolve unilaterally:** the ledger's own `statuses`
block defines `genuineGap` as *"Never demonstrated able to fail, by anyone."* A row with an
expectation lever HAS been demonstrated able to fail — just not by a data lever. Re-labelling all 65
`genuineGap` would make the ledger's own status definition false for 65 rows, which trades one
honest number for a dishonest vocabulary. **RECOMMENDATION: add a fourth declared status** (e.g.
`expectationLeverOnly`) meaning *"observed failing, but only under a lever that moved a test
expectation; the standing rule is NOT satisfied and this row does not count as proven"*, and add a
standing gate asserting `proven ⇒ at least one data lever`. That gate would go red against all 65 on
its first run, which is exactly the red evidence it should have. **This is a decision for the design
authority.**

#### THE RED-EVIDENCE LEDGER AND THE 54/1 STALE ASSERTION — CLOSED

`INTEGRATION roundTripValidator NOT declared yet (declared-and-broken = refusal)` asserted
`descriptor.roundTripValidator === undefined`; Phase 5 falsified it by declaring the validator. It
was the suite's single standing FAIL across Phases 5, 6 and 6.5, carried as a declared debt so a red
suite could not be mistaken for a clean one.

**RE-PINNED TO THE OPPOSITE FACT, NOT DELETED.** The requirement behind it (RT-13.3 — a declared
validator that does not exist or does not load REFUSES every build by name, never downgrading to
absent) is unchanged; only the state of the world moved. Three successors, and **deliberately three
assertions rather than one conjunction**:

1. `roundTripValidator IS declared`
2. `the declared roundTripValidator file EXISTS`
3. `the declared roundTripValidator exports validate()`

The retired entry moved to `retiredAssertions` with its original entry and evidence preserved, and
its evidence **does NOT transfer** — per the ledger's own note, an assertion carrying a predecessor's
receipt is how this campaign's genuine-gap residue was created.

**RED EVIDENCE, BY LEVERS THAT MUTATE PRODUCTION DATA** (`p7_repinnedDescriptorLevers.js` — the
mutated artifact is `parserDescriptor.ini`, the bundle's own self-description, read by `forger.js` on
every build):

| lever | reddened | expected |
|---|---|---|
| `noOpControl` (ACCEPT-CONTROL) | — | — |
| `removeTheDeclarationEntirely` | 1,2,3 | 1,2,3 |
| `pointTheDeclarationAtAMissingFile` | 1,2,3 | 1,2,3 |
| `pointTheDeclarationAtAModuleExportingNoValidate` | **1,3** | 1,3 |

**THE LAST ROW IS WHY THE RE-PIN IS THREE ASSERTIONS.** It reddens the declaration and exports
assertions and leaves the file-existence assertion GREEN. A single conjunction would have hidden a
case its own receipt could not distinguish. The separation was not a style preference; it was
measured.

`parserDescriptor.ini` is restored **byte-for-byte and the restore is verified by comparison**, not
assumed; a failed restore is a refusal by name. The probe also refuses if any lever produces no byte
change (an inert regex certifies nothing) or if the accept-control does not hold (a reader serving a
stale cached parse would make every red uninterpretable).

#### THE INTERPOLATED-LABEL CLASS — a NEW structural finding, 2 members

Recorded as a top-level `interpolatedLabelClass` block in the ledger, **because it cannot be recorded
as a row inside the label-keyed map — the key does not exist as a constant.**

- **`source:367`** `check(\`INTEGRATION forge run (${err})\`, false)` — **PERMANENTLY UNLEDGERABLE.**
  The label has no value until the failure happens and a different value for every distinct failure.
  Also unreachable on a healthy build, which is the 235-vs-234 difference.
- **`derived:378`** `check(\`G3-A regeneration ran without refusal${regenerationError ? …}\`, …)` —
  **THE MORE SERIOUS, AND IT RUNS ON EVERY BUILD.** On success the ternary collapses and the label is
  the constant carried in the ledger. **On FAILURE the label MUTATES.** So at the exact moment the
  evidence matters, the green-path row goes STALE and the mutated label reports UNLEDGERED — the gate
  fails with two findings that are both artifacts of the label and neither of which is the real
  defect.

**STANDING RULE PROPOSED: an assertion label must be a CONSTANT.** This is the conjunction class one
step further out — there the label was the wrong GRANULARITY; here it is not even the same string
twice. Repair is cheap: constant label, interpolated detail into the adjacent `evidence()` line,
which is free-form and is not a ledger key.

#### THE 23 LEAVING THE BACKLOG — accounted for, by inheritance not by re-derivation

Phase 6.5 closed the 23 previously-unattributed documentation literals. Its published decomposition
is **disjoint and its two categories intersect by 3**: 26 self-closing `<xs:documentation/>` + 5
2nd..nth literals in multi-doc annotations − 3 overlap = 28 attributed, 0 unattributed; real content
loss beyond empty literals is **2** (the ruled forge residue, `DocumentCategory` and `DocumentFormat`
in `AcademicRecord_v1.14.0.xsd`). **Phase 7 did not re-derive this and does not claim to have
verified it independently** — it is inherited from a phase that was independently reviewed and signed
off. The `species: phase4Unevidenced` count of 23 in the ledger is a DIFFERENT 23 (Phase 4
unevidenced rows) and the two must not be conflated; that is stated here because the coincidence of
the number is exactly the sort of thing that gets silently merged.

#### THE COUNTER'S OWN BOUND — applied to every figure in this report

Phase 6.5's finding governs how these numbers read: **any counter fed by a fail-fast reporter measures
what failed FIRST, not what is wrong, so a cause tally is a LOWER BOUND on distinct defects.**

- `sourceRefusalCauseTally` / `emittedRefusalCauseTally` (3 + 6) come from a schema processor that
  reports the FIRST fault per component. **These are LOWER BOUNDS**, and they are equal on both sides,
  which is the claim being made — not that nine is the total number of defects in PESC's bytes.
- The suite counts (57 / 71 / 106) are NOT fail-fast: `pipeRunner` runs every task and `check()`
  records every assertion, so those are exact.
- The conjunction and lever figures are exact: both instruments enumerate to completion and refuse
  rather than stopping at a first failure.

#### PHASE 5'S DECLARED GAPS AND PHASE 6'S — carried forward unchanged, NOT re-litigated

R-VAL-5 covers only S-1 (109 of 632 synthetic nodes, kind/name identity; S-1c's 522 children and S-2
unchecked; the qualification travels with the boolean). The R-VAL-1 scoping check is an unfailable
`genuineGap` by construction. `countUnmodeled` is unreachable inside a `complexType` and says so.
The MUTUAL BLIND SPOT stands: `substitutionGroupAsWritten` (113) and `abstract` (28) are unread by
the emitter AND unmeasured by the canonicalizer, so they report ZERO loss on BOTH sides. Phase 6's
gaps stand: the two python-side R-P5-1 pins as `genuineGap`, the cross-namespace repoint blind spot,
P6-D1's laundering path. The emitter's refusal guard still has its measured boundary at 84
group-reference/wildcard-only shapes.

### WHAT PHASE 7 FOUND IN ITS OWN INSTRUMENTS

**A FAIL-OPEN IN `mp_auditConjunctiveAssertions.js`, inherited and trusted by three phases.**
`if (splitIndex !== -1) { assertions.push(...) }` had no `else`: a call site whose label/condition
split failed was discarded in total silence. Its own join-integrity self-check inspects only the
CONJUNCTIVE subset, so a dropped non-conjunctive site was invisible to the instrument built to
measure completeness — **an instrument exempting itself from its own standard.** And
`buildRedEvidenceLedger.js` CONSUMES that function, so an undercount would have become a published
ledger number nobody could check.

**TWO OPPOSITE CONDITIONS ARRIVED AT THAT BRANCH AND WERE HANDLED IDENTICALLY, BY SILENCE** — a
benign zero-argument `check()` written in prose, and a real parser failure. **A branch that cannot
tell them apart is not a filter, it is a shrug.** Now classified: a parser failure REFUSES BY NAME, a
zero-argument call is counted and reported, and a comment-resident call is stripped and counted.

**AND THE STRIPPER'S CONTROLS INCLUDE AN OVER-STRIPPING CASE**, because a stripper that blanked the
whole file would score zero on both rejection specimens and look like a working filter. 7 specimens,
each requiring a different score: parse / benign / REFUSE / strip-line-comment / strip-block-comment /
**do-not-strip a label containing `//` inside a string literal** / do-not-strip code after a comment.

### DOCTRINE THIS PHASE PAID FOR

1. **KNOWING ABOUT THE F-3 TRAP DOES NOT DISARM IT.** I counted `check(` occurrences over RAW BYTES,
   got 237 against the auditor's 233, formed a confident mechanism for four dropped call sites, and
   was **REFUTED BY OPENING THE FILES** — all four were `check()` inside comments. This was committed
   in the phase whose amendment warns about it, by someone who had read the warning an hour earlier.
   **The failure mode is not ignorance; it is that raw-byte counting FEELS like rigour.**
2. **AN INSTRUMENT THAT RUNS BEATS AN INTENTION THAT DOES NOT.** Having just measured the conjunction
   class, I wrote the three re-pinned assertions as three-conjunct guards and **added two members to
   the class on the day I measured it.** I did not notice; the auditor did, reporting conjunctive rows
   78 → 80 and risk rows 11 → 13. The guard logic is now lifted into named intermediates and every
   new assertion carries ZERO top-level conjunctions.
3. **A COMMENT QUOTING CODE IS CODE TO A BYTE PARSER.** My own re-pin comment quoted the retired
   assertion verbatim with both arguments; the auditor counted it as shipped and reported it
   UNJOINED. The instrument found its author's phantom twice in one phase, which is the entire
   argument for building instruments that can disagree with you.
4. **REFUSING IS STRONGER THAN RESTORING.** The descriptor-lever probe verifies its restore by
   comparing bytes and refuses by name if the restore failed, naming the recovery command — because a
   probe that mutates the bundle's self-description and exits without restoring leaves every
   subsequent build refusing.

### PRE-EXISTING STATE THIS PHASE INHERITED AND DID NOT CREATE

- `recipes/fourRoundTripNoBridges.recipe.jsonc` is UNTRACKED and never committed, dated 2026-08-05.
  **Not created by Phase 7.** Left exactly where it is; noted so the closeout accounts for it rather
  than inheriting it silently.
- `cli/lib.d/edf-bridge-maker/edfBridgeMaker.js` and `cli/lib.d/edf-rekey/edfRekey.js` are modified in
  the working tree, MODE-ONLY (644→755, zero line changes), last touched 2026-07-18. Confirmed stale;
  there is no concurrent campaign.
- Six `DEV_gb_materialize_*` scratch containers from prior phases were up for 24–28 hours. **The
  first stage-ON build FAILED on resource contention** (`neo4j at bolt://localhost:7827 never
  authenticated within 90s`) and succeeded on retry. **Nothing was stopped or removed** — no
  destructive operation was performed on shared resources without authorization. A successor should
  expect this and may want a ruling on scratch-container hygiene.

### FILES

```
ADDED    recipes/pesc260805OnlyRoundTrip.recipe.jsonc          the stage-ON certification recipe
CHANGED  recipes/pesc260805Only.recipe.jsonc                   stale rationale corrected, superseded
                                                               text preserved; now the A/B control
CHANGED  forges/pesc260805/test/test-pesc260805SourceTier.js   the 54/1 re-pin, as three
                                                               zero-conjunction assertions
CHANGED  forges/pesc260805/test/redEvidenceLedger.json         retirement + 3 successors +
                                                               interpolatedLabelClass block
CHANGED  forges/pesc260805/test/probes/mp_auditConjunctiveAssertions.js
                                                               fail-open classified + comment
                                                               stripper + 7 accept-controls +
                                                               arithmetic denominator closure
ADDED    forges/pesc260805/test/probes/p7_expectationLeverSweep.js
ADDED    forges/pesc260805/test/probes/p7_repinnedDescriptorLevers.js
ADDED    forges/pesc260805/test/probes/p7_applyLedgerRepin.js  idempotent, refuses partial states
```

### HOW TO RUN EVERYTHING — from `system/code/educoreForge`

```
# the A/B pair (sequential; ~2 min each, vectorize OFF)
bash forges/pesc260805/test/test-artifacts/p7/runStageAbPair.sh

# GATE 7 — and its negative control
jq -nc '{switches:{goldEvalCheck:true},values:{buildLogDirPath:["<runDir>"]}}' \
  | node apps/graph-builder/graphBuilder.js     # PASS on the stage-ON dir, REFUSES the stage-OFF dir

# the suites — 57 / 71 / 106, all green
cd forges/pesc260805
node test/test-pesc260805SourceTier.js
node test/test-pesc260805DerivedTier.js
node test/test-pesc260805SyntheticTier.js

# the evidence accounting
node test/probes/mp_auditConjunctiveAssertions.js   # 7/7 controls; denominator closes 235+0+0+6=241
node test/probes/p7_expectationLeverSweep.js        # 5/5 controls; 51 + 65 = 116
node test/probes/p7_repinnedDescriptorLevers.js     # 3 levers + 1 accept-control; restore verified
```

**RESOLVE THE BOLT PORT FROM THE CONTAINER, NEVER FROM A DOCUMENT.** Confirmed again this phase:
bolt **7811** is `DEV_pesc260805_phase45`, the STALE pre-4.6a graph; the live `DEV_pesc260805` is on
**7821**. A reviewer taking 7811 from a document sees 522 legitimate children reported as missing.

### RETAINED EVIDENCE — `forges/pesc260805/test/test-artifacts/p7/`

`p7BuildA_stageOff.log`, `p7BuildB_stageOn.log`, `p7GoldEvalCheck_stageOff.log`,
`p7GoldEvalCheck_stageOn.log`, `runStageAbPair.sh`, `p7BaselineSourceTier.log` (the inherited 54/1,
before any change), `p7RED_conjunctionParseIntegrity.log`, `p7RED_classifierAcceptControl.log`,
`p7RED_ledgerAfterRepin.log`, `p7RepinnedDescriptorLevers.{log,json}`,
`p7ExpectationLeverSweep{,Final}.log`, `p7ExpectationLeverSweep.json`,
`p7ConjunctionAudit{Baseline,Repaired,Final}.log`, `p7FinalSuite{Source,Derived,Synthetic}.log`,
`p7ApplyLedgerRepin.log`.

### WHAT PHASE 7 DID NOT DO, AND WHY

1. **The conjunction class is NOT closed.** Measured and reported; closing it is a ledger-schema
   change plus 77 assertions. Recommended as its own phase.
2. **The 65 expectation-only rows are NOT re-statused.** Blocked on a vocabulary decision the design
   authority owns: `genuineGap` as currently DEFINED would be false for them. A fourth status and a
   `proven ⇒ data lever` standing gate are recommended.
3. **The interpolated-label repair is NOT applied** — 2 sites, cheap, but it changes assertion labels
   and therefore ledger keys, which should not ride along with a phase that is already re-keying one.
4. **Nothing is committed.** Awaiting sign-off, per the hold instruction.


---

## PHASE 7 REMEDIATION — ONE ROUND, AFTER INDEPENDENT REVIEW (SCARLET_GARDEN, 2026-08-07)

**ALL FIGURES BELOW COME FROM ONE RUN** — pair run stamp `20260807-173607`, stage-ON build directory
`buildLogs/pesc260805OnlyRoundTrip_20260807-223703`, captured together in
`test/test-artifacts/p7/p7SingleRunFigures.log`. The first submission paired a PRE-repin figure with
POST-repin figures in a single table; that is what this discipline exists to prevent.

### THE RULINGS, ADOPTED

**`expectationLeverOnly` is now a declared status**, and 65 rows moved to it from `proven`. The work
order said `genuineGap`; the ledger DEFINES `genuineGap` as *"never demonstrated able to fail, by
anyone"* and these rows HAVE failed, just not under a data lever — re-labelling them would have been
**an honest number bought with a dishonest vocabulary**. The supervisor adopted the recommendation
and is correcting the work order.

**Ledger status distribution, measured:** `proven 54 · expectationLeverOnly 65 · genuineGap 78 ·
recordsGap 40` (237 rows).

**THE NEW STANDING GATE — `proven` IMPLIES AT LEAST ONE DATA LEVER — WAS SHIPPED BEFORE THE
RE-STATEMENT IT MOTIVATES, DELIBERATELY.** Its first run was RED in all three suites simultaneously
against the SHIPPED ledger, naming 25 derived + 6 source + 34 synthetic = **65** rows by label. No
mutation was needed: the real ledger content was already the defect. Retained at
`p7RED_provenImpliesDataLever.log`. Had the re-statement landed first, the gate would have been green
on its first run and would have been a gate nobody had ever seen fail.

**WHAT THE TWO INSTRUMENTS SHARE, stated rather than implied** (the F-3 doctrine): the suite gate and
the standalone sweep agree at 65, and they share the `LEVER_CLASS_REGISTRY` and `classifyOneLever` —
imported, never copied. They do NOT share the enumeration, the bucketing or the totals. **The
agreement corroborates the row selection, not the classification judgment.**

**AND THE 65 IS PUBLISHED BY THE SWEEP EVEN THOUGH THOSE ROWS ARE NO LONGER `proven`**, because every
proven-row figure now reports them as zero — which is exactly how a residue disappears into a status
rename. A backlog that shrinks without a per-item disposition is indistinguishable from one that was
truncated.

### F-1 (SEVERE) — MY SWEEP'S "CLOSES: 51 + 65 = 116" WAS AN ALGEBRAIC IDENTITY

Every `proven` row incremented the total and was pushed into **exactly one** of two arrays, so the
sum held BY CONSTRUCTION. There was no comparison and no failure branch. The reviewer demonstrated it
empirically: with every lever doctored, it still printed `CLOSES: 0 + 116 = 116`.

**THE PART THAT MATTERS IS NOT THE BUG.** In my own polyArch2 self-audit I had found this exact class
as item 7a, named it *"a tautology wearing a measurement's clothes"*, fixed it properly in
`mp_auditConjunctiveAssertions.js` — **and did not look at the sibling probe I had written the same
afternoon, carrying the same shape.** I repaired the disease and shipped it next door in the same
diff. **A fix feels like it discharges the whole class. The class is a PATTERN, not a location.**

**REPAIRED** into two independent passes that are COMPARED, not partitioned: a census pass that
counts `proven` rows and classifies nothing, a classification pass that records which rows it
actually reached, and three comparisons that can each be nonzero — rows in the census never
classified, rows classified but absent from the census, and classified rows landing in no bucket.
**OBSERVED RED** with the self-test passing 5/5 (so the gate itself fired, not a shadow):
`5 proven row(s) counted by the census were NEVER CLASSIFIED`. Retained at
`p7RED_sweepReconciliation.log`.

### F-2 — STALE FIGURE PAIRING. Fixed; see the single-run note above.

### F-3 — `source:367` WAS `source:403`, moved by my own +38-line edit to that file

Repaired, and repaired so it cannot recur: the site line numbers in the interpolated-label block are
now **RECOMPUTED FROM THE FILES** by `p7_applyRemediationLedgerEdits.js`, which refuses if the literal
it searches for matches zero or several lines. A hand-corrected number would have gone stale on the
next edit with nothing to notice. **A line number in a published finding is a promise that someone can
open it, and a promise nothing recomputes decays silently.**

### F-4 — THE PROVENANCE CLAIM WAS FALSE AND A FAILED RUN WAS DESTROYED

**RETRACTED:** *"both builds ran sequentially through the ordinary graphBuilder -build recipe path."*
What happened: the pair script's stage-ON run **failed early** (`neo4j at bolt://localhost:7827 never
authenticated within 90s`, resource contention from six 24–28-hour-old scratch containers), and I
re-ran it BY HAND **to the same fixed log path, overwriting the failure log.** It is gone. The
reviewer caught it from the artifacts alone — log B carried neither of the script's own markers and
no exit code, and `p7BuildPair.done` was stamped two minutes BEFORE the build its log describes.

`p7LostFailureRecord.md` records what happened, labelled **reconstruction, not receipt**, with the
failure text quoted from the session transcript and an explicit statement of what is NOT established:
nothing about the failed run can be checked, because there is no artifact.

**REPAIRED SO IT CANNOT RECUR:** every attempt now writes to a path carrying the run stamp and label,
the script REFUSES to write to a path that exists, the exit code is recorded in both the log and a
manifest even when the build dies before the closing marker, and the pair's exit status reflects both
attempts. **A fixed output path turns a retry into a deletion**, and the artifact destroyed was
precisely the one telling a successor the instrument is unreliable under container pressure.

**RE-RUN CLEAN through the repaired script:** both attempts carry both markers and `exit=0`
(`p7BuildPair_20260807-173607.manifest.txt`).

### F-6 — `lostTotal: 0` APPEARED BARE WHERE A PROMOTER READS IT

`semanticValidationLimit` lived only in `roundTripVerdict.json` while `roundTripStageSummary.json` and
the `-goldEvalCheck` PASS payload both stated `lostTotal: 0` unqualified. **A qualification that lives
only in the artifact nobody opens is not a qualification.** Both now carry it, so the sentence naming
the type-reference NAMESPACE residue as *"the more serious of the residue"* is now in the promoter's
own payload.

**THE ABSENT CASE IS MARKED, NEVER SILENTLY OMITTED**, and both branches were OBSERVED against real
artifacts rather than simulated: the fresh run carries the declaration; the genuinely stale pre-F-6
summary (`pesc260805OnlyRoundTrip_20260807-215615`, which really does lack the key) produces
`ABSENT FROM THIS STAGE SUMMARY — it was written before the builder carried this field…`. Retained at
`p7RED_semanticLimitAbsentMarker.log`. Files touched: `apps/graph-builder/lib/round-trip-stage.js`
and `apps/graph-builder/lib/actions.js` — shared builder code, so this benefits every standard.

### F-7 — THE PROBES ARE NOW DECLARED

`p7_expectationLeverSweep.js` is **wired into all three suites** (they import its classifier for the
standing gate), so the 65-row finding cannot come untrue unnoticed. The rest are declared one-shot in
the ledger's new `phase7ProbeDispositions` block WITH the reason —
`p7_repinnedDescriptorLevers.js` most importantly: it mutates the shipped `parserDescriptor.ini`, and
a suite crashing mid-probe would leave the bundle refusing every build. **An unexplained one-shot is
the silence that declaration exists to prevent.**

### F-5 — DISMISSED by the supervisor (untracked is expected while holding). The recipe is in the commit list.

### FIGURES, ALL FROM RUN `20260807-173607`

```
suites .................... 58 / 72 / 107 = 237 passed, 0 failed
ledger .................... proven 54 · expectationLeverOnly 65 · genuineGap 78 · recordsGap 40
GATE 7 .................... goldEvalCheck PASS exit 0 on stage-ON; REFUSED exit 1 on stage-OFF
verdict ................... roundTripClean true · invented 0 · lost 0 · contentGap 0
                            explicitlyOmitted 0 · whitespaceOnlyDifference 0 · syntheticReproducible true
                            (lost 0 = zero loss IN THE DIMENSIONS THE COMPARATOR MODELS)
independent instrument .... source 64/55/9, emitted 64/55/9, traversalUnavailableTypes 28 both sides,
                            cause tallies IDENTICAL {missing group 3, unknown type 6},
                            compileAgreement bothClean 55, divergence 0 in BOTH directions,
                            comparedTypeTotal 25,540 with all six difference totals 0
conjunction class ......... 238 shipped rows · 77 conjunctive · 8 proven-with-3+ (was 11; three were
                            re-stated expectationLeverOnly) · comment-resident 6 · denominator closes
                            238 = 238 against occurrences actually present in the stripped text
lever sweep ............... 54 proven, 54 carrying a DATA lever, 0 expectation-only among proven;
                            65 re-stated expectationLeverOnly, published so it cannot vanish
```

**THE FAIL-FAST BOUND STILL APPLIES:** the 3 + 6 refusal cause tallies come from a schema processor
that reports the FIRST fault per component, so they are LOWER BOUNDS. The claim is that they are
EQUAL on both sides, not that nine is the number of defects in PESC's bytes. The suite counts are not
fail-fast and are exact.
