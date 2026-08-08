# What is NOT done

**This is the honest ledger. Nothing in it is a secret and nothing in it is softened.**

The bundle reports `inventedTotal 0` and `lostTotal 0` against a 173,216-statement reproduction, and
that result is real and was hard to get. **It is also narrower than it sounds, and a reader who takes
the bare zero away from this bundle has been misled by it.** Everything below is a reason to qualify
a number, an unclosed class of risk, or a decision somebody still owes.

Measured or re-measured in this pass on 2026-08-07 (session VIOLET_STONE), commit `dfe97d3`.

---

## 1. THE MODELLING QUALIFICATION — what `lostTotal 0` actually says

**`lostTotal 0` means zero loss IN THE DIMENSIONS THE COMPARATOR MODELS.** Three dimensions are not
modelled. They are not "hard to see" — they **cannot register as loss at all**, because nothing on
either side of the comparison looks at them.

**ANY RESTATEMENT OF `lostTotal 0` THAT OMITS THIS QUALIFICATION IS A DEFECT.** That is not a style
preference; it was ruled after a review found the bare zero sitting in the artifact a promoter reads.
The qualification now travels in `roundTripVerdict.json`, in `roundTripStageSummary.json` AND in the
`-goldEvalCheck` payload, because **a qualification that lives only in the artifact nobody opens is
not a qualification.**

### (a) TYPE-REFERENCE NAMESPACE — the most serious residue

`canonicalTypeRef` **strips the prefix from a type reference.** So a reference repointed to a
same-named type in a *different namespace* canonicalizes identically to the original, and the diff
reports nothing.

**This is R-ID-1's fusion, surviving in the object space.** The whole reason this bundle exists is
that a version-free key would fuse CoreMain 1.10.0's `PersonType` with 1.19.1's. R-ID-1 fixed that in
the SUBJECT space — the graph really does carry 33 distinct `TransmissionDataType` nodes, one per
declaring namespace (see `README_identityRules.md`). **The comparator did not follow.** Two files can
carry the byte-identical string `core:DocumentIDType` and denote different types; to this
canonicalizer they are the same statement.

**Consequence, stated plainly: the single defect class this rebuild was commissioned to eliminate is
still invisible to the instrument that certifies the rebuild.**

### (b) ATTRIBUTE ORDER

Not modelled. A reordering of attributes on an element is not detected.

### (c) THE 2nd..nth `xs:documentation` LITERAL

Where one `xs:annotation` carries several `xs:documentation` children, **the forge keeps the first.**
The rest are not carried and cannot register as loss.

### And one measured boundary of the emitter, not of the comparison

A container whose content model holds **only** group references or wildcards declares no element
children, so a missing `contentModelShape` there **cannot be refused by name** and appears as ordinary
loss instead. The refusal guard's measured boundary is **84 group-reference/wildcard-only shapes**.

---

## 2. THE MUTUAL BLIND SPOT — zero on both sides, and that reads as fidelity

**A one-sided omission shows up as loss and gets investigated. An omission shared by BOTH sides is
invisible by construction and reads as perfect fidelity.**

Two properties are in this category. **Re-measured in this pass rather than inherited:**

| property | nodes carrying it | written by | read by the emitter | read by the canonicalizer |
|---|---:|---|---:|---:|
| `substitutionGroupAsWritten` | **113** | `lib/parser.js` | **0** | **0** |
| `abstract` | **28** (all `"true"`) | `lib/parser.js` | **0** | **0** |

Node counts from a Cypher census of `DEV_pesc260805`; the read counts from
`/usr/bin/grep -ac` over `lib/roundTripSourceEmitter.js` and `lib/roundTripXsdCanonical.js`.

**The parser faithfully captured 141 facts that no downstream instrument has ever looked at.** They
contribute nothing to the verdict in either direction. The verdict is not wrong; it simply has never
been asked the question.

**This is the shape to watch for generally.** When an emitter and its comparator are built by the same
hands in the same campaign, the dimensions they forget are the *same* dimensions — and the resulting
zero is the most convincing wrong answer available.

---

## 3. THE CONJUNCTION CLASS — 238 rows, 77 conjunctive, 8 at highest risk

Measured in this pass by `test/probes/mp_auditConjunctiveAssertions.js`:

```
shipped check() calls: 238; carrying a top-level conjunction: 77
recorded "proven" AND carrying 3+ conjuncts: 8
raw occurrences 244 - stripped 238 = 6 comment-resident
DENOMINATOR CLOSES: 238 ... against 238 occurrences actually present in the stripped text
auditor join integrity: 0 shipped label(s) failed to join the ledger
```

**The defect:** evidence is keyed to a LABEL. `A AND B` fails when EITHER conjunct fails, so a
retained red log proves only that **SOME** conjunct can fail. It does not prove every conjunct can.
A three-conjunct assertion with one receipt is one third proven and reads as fully proven.

### THE DROP FROM 11 TO 8 IS NOT PROGRESS

**Say it in those words, because a skimming reader will read a falling number as improvement.**

**Three rows LEFT the proven population by re-statement.** They were moved to `expectationLeverOnly`
(§4). **No conjunction was repaired. No assertion was split. The underlying risk is exactly what it
was.** The population the metric counts got smaller; the thing the metric measures did not.

**Recommended as its own phase.** Closing it needs one assertion per claim, or a lever per conjunct,
or a ledger that records evidence per conjunct — a ledger-schema change plus 77 assertions, which is
larger than a closeout should absorb. **The cheap half is already adopted: write new assertions with
zero top-level conjunctions.** That costs nothing and stops the class growing.

### The ledger's stored measurement is SUPERSEDED — and it must stay that way

`test/redEvidenceLedger.json` carries a `conjunctionEvidenceMeasurement` block reading
**`shippedAssertions 233`, `carryingATopLevelConjunction 78`, `provenWithThreeOrMoreConjuncts 11`**,
with an 11-row `riskRows` list. **The live instrument computes 238 / 77 / 8.** The three surplus
`riskRows` are precisely the three that moved to `expectationLeverOnly`.

**The block is now annotated in place** with `supersededFigures` and `doNotRegenerate` fields naming
the live figures and forbidding the obvious repair. **Run the probe for current numbers; do not quote
the block.**

**DO NOT "FIX" THIS BY REGENERATING THE LEDGER.** The reason is §10, and it is the more important
finding.

---

## 4. THE 65 `expectationLeverOnly` ROWS

**A fourth status, adopted in Phase 7.** Ledger distribution, measured in this pass:

```
proven 54 · expectationLeverOnly 65 · genuineGap 78 · recordsGap 40   (237 rows)
```

**What the status means.** The row HAS been observed failing in a retained log — **but only under a
lever that moved a test EXPECTATION or the harness, not production data.** It does not count as
proven.

**Why not just call them `genuineGap`.** The work order originally instructed exactly that, and the
instruction was **withdrawn as wrong**. The ledger defines `genuineGap` as *"never demonstrated able
to fail, by anyone"* — and these rows HAVE failed. Re-labelling them would have bought **an honest
number with a dishonest vocabulary**, making the ledger's own status block false for 65 rows.

**Why the distinction has teeth, mechanically.** An expectation lever reddens an assertion whether or
not its predicate can *ever* be satisfied by real data — so it will happily certify a **vacuous** gate
as proven. A data lever cannot, because a vacuous check does not respond to data at all.

**What closing one requires:** build a lever that mutates the input, the corpus, or the graph, and
retain the red. Where that is genuinely impossible, say so **on the row** and move it to `genuineGap`
with the reason. Neither is a documentation act.

**The standing gate `proven ⇒ at least one data lever` now runs in all three suites.** Its first run
was RED in all three simultaneously against the shipped ledger, naming 25 + 6 + 34 = 65 rows with no
mutation required — the real ledger content was already the defect. **The 65 is still published by
the sweep even though those rows are no longer `proven`,** because every proven-row figure now reports
them as zero, and **a backlog that shrinks without a per-item disposition is indistinguishable from
one that was truncated.**

---

## 5. TWO INTERPOLATED-LABEL SITES — repair deferred

**The standing rule: an assertion label must be a CONSTANT.** A label assembled at runtime cannot be
joined to a ledger row.

| site | shape | failure mode |
|---|---|---|
| `test-pesc260805SourceTier.js:403` | `` check(`INTEGRATION forge run (${err})`, false) `` | **permanently unledgerable** |
| `test-pesc260805DerivedTier.js:378` | `` check(`G3-A regeneration ran without refusal${regenerationError ? …}`, …) `` | **ledgered only in its GREEN state** |

**THE DANGEROUS ONE IS THE SECOND, AND IT IS NOT THE OBVIOUS ONE.** The first is honestly hopeless —
the label has no value until a failure happens and a different value for every distinct failure — and
it is unreachable on a healthy build, which is the 238-versus-237 difference.

**The second runs on every build.** On success the ternary collapses and the label is the constant the
ledger carries. **On FAILURE the label MUTATES.** So at the exact moment the evidence matters, the
green-path row goes STALE and the mutated label reports UNLEDGERED — **the gate fails with two
findings that are both artifacts of the label, and neither of which is the real defect.**

**A conditional that collapses to a constant on the green path is worse than one that is obviously
broken, because it looks correct for as long as nothing is wrong.**

**Repair is cheap** — constant label, interpolated detail moved into the adjacent free-form
`evidence()` line — **and it is deferred because it re-keys the ledger**, which should not ride along
with a pass that is already re-keying one.

*(Those line numbers are recomputed from the files by `p7_applyRemediationLedgerEdits.js`, never
retyped. The first publication of this block cited `source:367`; a +38-line edit to the same file in
the same phase moved the call and the citation went stale within the hour.)*

---

## 6. THE 9 REFUSED FILES — a lower bound, not a defect total

The independent Python instrument refuses **the same nine files on both sides, for the same nine
causes**: 3 × missing group, 6 × unknown type. `sourceRefusalCauseTally` and
`emittedRefusalCauseTally` are identical objects.

**THAT IS THE CLAIM — that they are EQUAL on both sides. It is NOT a claim that nine is the number of
defects in PESC's bytes.**

**These tallies come from a FAIL-FAST processor.** It reports the FIRST fault per component and stops.
**A counter fed by a fail-fast reporter measures what failed first, not what is wrong, so every cause
tally is a LOWER BOUND on distinct defects.** A file refused for a missing group may also carry four
unknown types nobody will ever see.

Also declared: `traversalUnavailableTypes 28`, identical on both sides.

**Which figures in this bundle are exact rather than bounded:** the suite counts (`pipeRunner` runs
every task and `check()` records every assertion — nothing stops early), and the conjunction and lever
figures (both instruments enumerate to completion and refuse rather than stopping at a first
failure).

---

## 7. CONCEPT COLLAPSE — chartered, NOT started, deliberately deferred

**Phase 8. It is the only remaining item that answers a complaint a real user actually made.**

**The problem, measured:** a search for "grade point average" returns **217 raw hits**. Under the
`SAME_DEFINITION` cluster-representative rule that drops to **15**. Under a further concept collapse
it drops to **7**. A query that should match one concept matches 217.

**Why the cluster rule does not fix it.** A `SAME_DEFINITION` cluster **breaks at every content
change**, so `GPAType` is 14 versions but **4 clusters**. The version fan is reduced, not eliminated.
The cluster is the right unit for *churn* and the wrong unit for *search*. **Search must collapse by
(family, kind, name)** — the concept — and use `SAME_DEFINITION` for the "also in N earlier versions"
expansion.

**TQ's refinements, which are the shape of the work:**

- **A concept NODE, not a concept property.** A property can only be grouped by; a node can be
  **mapped to, embedded, and described**. Given that this graph exists for cross-standard mapping, a
  concept that cannot be a mapping endpoint is half a concept.
- **The real question is what carries a semantic vector.** *"What is discoverable — and thereby
  mappable — is governed by the decision of what gets a semantic vector."* If all 14 `GPAType`
  versions carry vectors, all 14 match a semantic query no matter how results are grouped afterwards.
  **That ruling is TQ's and it has embedding cost attached.**

**Deferred by TQ, not blocked. It is chartered and unstarted.**

---

## 8. PROBE DISPOSITIONS — and why one must stay one-shot

**A one-shot script cannot regress-detect, so a finding it produced can silently come untrue.** Every
Phase 7 probe is therefore declared in the ledger's `phase7ProbeDispositions` block **with its
reason** — an unexplained one-shot is exactly the silence that declaration exists to prevent.

| probe | disposition |
|---|---|
| `p7_expectationLeverSweep.js` | **wiredIntoSuite** — all three suites import its classifier for the standing gate, so the 65-row finding cannot come untrue unnoticed |
| `mp_auditConjunctiveAssertions.js` | **oneShot** — a MEASUREMENT, not a gate; there is no threshold it could assert against without inventing a policy nobody has set |
| `p7_repinnedDescriptorLevers.js` | **oneShot, and it must stay that way** — see below |
| `p7_applyLedgerRepin.js` · `p7_applyExpectationLeverOnly.js` · `p7_applyRemediationLedgerEdits.js` | **oneShotMigration** — idempotent, refuse on a state they did not create, retained so the edit is reviewable as intent rather than as a diff of 195 KB of JSON |

### WHY `p7_repinnedDescriptorLevers.js` MUST STAY ONE-SHOT

**It MUTATES `parserDescriptor.ini` — the bundle's own self-description, read by `forger.js` on every
single build — and restores it.**

The restore is verified by byte comparison and a failed restore is a refusal by name. **That is not
enough to make it safe in a suite.** A suite that crashed, was interrupted, or was killed mid-probe
would leave the descriptor mutated, **and every subsequent build would read the mutated version.**
Under RT-13.3 a declared validator that does not exist refuses every build by name — so the blast
radius of an interrupted probe is *the bundle stops building*.

**And running it in the suite would buy nothing.** The three assertions it proves are shipped in the
source-tier suite and run on every pass. **It trades a real hazard for a regression check that already
exists.**

*(Run in this pass, by hand, deliberately. Accept-control held; the three levers reddened `[0,1,2]`,
`[0,1,2]` and `[0,2]` exactly as expected; restore verified byte-for-byte by the probe AND
independently by `git status`, which reported the file unchanged.)*

**The third lever is why the re-pin is three assertions rather than one.** Pointing the declaration at
a module that exports no `validate()` reddens assertions 0 and 2 and leaves **1 — file existence —
GREEN**. A single conjunction would have hidden a case its own receipt could not distinguish. The
separation was measured, not preferred.

---

## What this bundle does NOT prove

**That the graph is complete with respect to PESC.** It proves the graph reproduces **the ingested
snapshot**. A round-trip verdict cannot see what was never ingested — which is precisely the criticism
that retired the incumbent's `contentGap 732`, and it applies here too.

**That synthetic content is right.** `syntheticReproducible: true` covers **S-1 identity only** — 109
of the merged AcademicRecord v1.6.0's named definitions, by kind and name. **S-1c's 522 children and
S-2 are unchecked**, and that qualification travels with the boolean.

**That the emitter handles every shape.** The refusal guard's measured boundary is 84
group-reference/wildcard-only shapes (§1).

---

## 10. THE LEDGER IS GENERATED AND THEN POST-PROCESSED, AND THE GENERATOR IS A LOADED GUN

**`test/buildRedEvidenceLedger.js` will silently destroy `test/redEvidenceLedger.json` if you run it
on its own. It exits 0.**

### The mechanism

The ledger is **generated** by `buildRedEvidenceLedger.js`. The Phase 7 remediation then applied its
changes **after** generation, through the three one-shot migrations declared in the ledger's own
`phase7ProbeDispositions` block — `p7_applyLedgerRepin.js`, `p7_applyExpectationLeverOnly.js` and
`p7_applyRemediationLedgerEdits.js`.

**The generator does not know those migrations exist, and there is no reassembly step.** So the
shipped ledger is a generated file that has been post-processed, and regenerating it throws the
post-processing away.

### The consequence — measured, not reasoned

Running the generator alone against the shipped tree produces:

| | shipped | after regeneration |
|---|---|---|
| top-level blocks | 14 | **11** |
| `conjunctionEvidenceMeasurement` | present | **DELETED** |
| `interpolatedLabelClass` | present | **DELETED** |
| `phase7ProbeDispositions` | present | **DELETED** |
| status distribution | `proven 54 · expectationLeverOnly 65 · genuineGap 78 · recordsGap 40` | **`proven 113 · genuineGap 78 · recordsGap 41`** |

**Sixty-five rows silently return to `proven`** — rows whose entire purpose is to record that they
are NOT proven. Three analysis blocks vanish. **Exit code 0. No error, no warning.** The result is
well-formed JSON, and the builder prints a confident risk-row list while doing it.

**AND THE FAILURE IS INVISIBLE TO THE OBVIOUS CHECK.** `jq` on a deleted block returns `null` — the
absent-property read this campaign has been burned by repeatedly, arriving here in a new costume. Not
a misspelled property; **a generated artifact quietly missing a section**, indistinguishable from one
where the section is legitimately empty. A regenerated ledger looks *freshly correct*, which is worse
than looking stale.

### The evidence

Observed 2026-08-07 (session VIOLET_STONE) under an explicit instruction to diff before shipping.
Retained beside the ledger:

- `test/test-artifacts/vsLedgerPreRebuild_20260807-191131.json` — the pre-rebuild copy, written to a
  stamped path *before* the generator ran, because **a fixed output path turns a retry into a
  deletion.**
- The shipped ledger was restored and verified two ways: sha256 back to `23861e65…`, and
  `git status` reporting it byte-identical to committed.

**A NOTE ON HOW THIS WAS FOUND, because the method is the transferable part.** The rebuild was
authorized as a fix for a stale figure. It was authorized **with a constraint**: diff old against
new, prove nothing but the measurement block changed, and STOP if anything else did. **Without that
constraint this would have been committed** — well-formed, exit 0, nothing anywhere failing.

**And the original diagnosis was wrong in its cause, which is worth more than the finding.** The
stale block was reported as stale *because nobody had rebuilt the ledger*. **The truth is the
opposite: rebuilding is destructive, and whoever last touched that ledger was right not to re-run the
generator.** What looked like neglect was discipline.

### The real fix, for whoever takes it up

**A reassembly step** — run the generator, then the three migrations in order — **with the result
REQUIRED to reproduce the committed status distribution
`proven 54 · expectationLeverOnly 65 · genuineGap 78 · recordsGap 40`, refusing by name if it does
not.**

**Without that assertion the reassembly is just a longer way to lose the same receipts.** The
migrations are idempotent and refuse on a state they did not create, which helps — but nothing
currently checks that the reassembled whole matches what shipped, and an unchecked pipeline that
happens to work is the shape this whole campaign exists to distrust.

---

## 9. THE 293 — closed by the emitter, and STALE IN TWO PLACES

TQ ruled the 293-statement omission ACCEPTED as of 2026-08-06 — the forge did not ingest
`xs:group ref` or `xs:any` — *"as long as it is documented, omitting the xs: items is acceptable."*
The work order records `lostTotal 293` as the expected, ruled figure and says not to re-open it.

**It has since been closed by Phase 6.5's emitter completion, and I checked rather than assumed it.**
Counting the emitted output of this pass's own build against the source corpus:

| construct | raw source bytes | commented out | declared | **emitted** |
|---|---:|---:|---:|---:|
| `<xs:group … ref=` | 283 | 1 | **282** | **282** |
| `<xs:any` | 25 | 0 | **25** | **25** |

**The emitter now emits them. The 293 was not laundered into `explicitlyOmitted` — that field also
reads 0.** `lostTotal 0` is a real closure of this class.

**And note the 283-versus-282: one `xs:group ref` in the corpus is inside an XML comment.** If you
count raw bytes you will find a one-statement shortfall that does not exist and go looking for a
mechanism. This campaign lost a day to exactly that arithmetic. **Any corpus count must state whether
XML comments were stripped and by what instrument.**

**TWO ARTIFACTS STILL CARRY THE SUPERSEDED FIGURE:**

- **`parserDescriptor.ini`'s comment** describes the verdict as `lost 293`. True at Phase 5, wrong now.
- **The work order's standing ruling** still names 293 as the expected figure.

Neither is load-bearing — no code reads either — but both are the kind of stale prose that gets
quoted. **Trust the verdict artifact.**

---

## What remains as real, enumerated content loss

**Two literals.** The forge parser keeps only the FIRST `xs:documentation` child of an
`xs:annotation`. Measured and carried in the verdict's own `knownResidue` block:

```
multiDocumentationAnnotations ............ 5
multiDocumentationLiteralsDiscarded ...... 5
multiDocumentationNonEmptyLiteralsLost ... 2
```

**Three of the five discarded literals are empty. The real content loss is 2** — `DocumentCategory`
and `DocumentFormat`, both in `AcademicRecord_v1.14.0.xsd`, enumerated in
`test/test-artifacts/p5ParserDocumentationResidue.json`.

**This is a FORGE finding, not a validator finding**, and it cannot register as loss because the
dimension is unmodelled (§1c). **Subtract it by name before reading any future nonzero `lostTotal` as
a regression.**
