# Validation certificate — PESC260805

**This is not a victory lap. Its job is to let you decide how far to trust this graph, which means the
limits below carry the same weight as the results above them.**

Four of these certificates exist, one per round-trip-declaring standard, written to the same five
headings so they can be read side by side:
`forges/{ceds,edfi,sif,pesc260805}/README_ValidationCertificate.md`.

> **CONFIRMED A THIRD TIME, IN A FOUR-STANDARD GRAPH (2026-08-07, run
> `fourWithNewPescRoundTripNoBridges_20260808-001444`).** Built alongside ceds, edfi and sif into one
> graph with all four validators running against that combined product, PESC260805 reported
> **173,216 reproduced · invented 0 · lost 0 · contentGap 0 · explicitlyOmitted 0** — **identical to
> the figures below in every field.** `goldEvalCheck` PASS, *"4 declared validator(s) ran with
> inventedTotal=0"*. A difference would have been a finding outranking this document; there was none.
>
> **AND THAT RUN SURFACED SOMETHING ABOUT THE OTHER THREE THAT BELONGS HERE.** The gate's payload
> reports, for **ceds, edfi AND sif**: *"NONE DECLARED BY THIS BUNDLE. Its verdict carries no
> semanticValidationLimit, so what this round-trip does and does not model is UNSTATED."*
> **`pesc260805` is the only one of the four that declares what its round trip models** — the F-6
> remediation was applied to this bundle alone. So the qualification in §3 below, which reads like an
> admission of weakness, is in fact the thing this bundle has and its siblings do not. **Their
> certificates carry a DERIVED qualification, read out of their validators' source and labelled as
> derived. This one carries a DECLARED one.** The difference matters: a declared limit travels with
> the number into every payload that restates it; a derived one drifts the moment someone edits the
> module.

---

## 1. WHAT WAS VALIDATED

| | |
|---|---|
| **standard** | `PESC260805` (bundle `forges/pesc260805/`) |
| **corpus** | `assets/standardSourceData/01/` — 64 XSD artifacts, 9,733,713 bytes |
| **corpus digest** | `92e9a6326ff1edda465db3d704632491a7b5bb39469edfee883f366840688984` (combined; the verdict also pins all 64 per-file sha256 sums) |
| **commit** | `dfe97d3`, branch `architecture-improvement` |
| **recipe** | `recipes/pesc260805OnlyRoundTrip.recipe.jsonc` (`roundTripStage: true`, `hubs: []`, `bridges: []`) |
| **run** | `system/dataStores/buildLogs/pesc260805OnlyRoundTrip_20260807-235125/` |
| **date** | 2026-08-07, session VIOLET_STONE |
| **product container** | `DEV_gb_materialize_68855_2` — **removed after certification** (scratch hygiene) |
| **canonical graph** | `DEV_pesc260805`, bolt port resolved from the container as **7821** |

**The aggregate version `01` is OURS, not PESC's.** PESC publishes no coherent whole-family release.
The manifest says so in its own words: *"THIS VERSION NUMBER IS OURS… this aggregate is our
fabrication and must never be read as a PESC edition."*

**This run reproduces Phase 7's certification figures exactly, from an independent invocation.** The
manifest it composed — `f17896a4a89c70a3034fd33f097833f69398bdbebcdf71e0f666d58512dd8acf` — is
byte-identical to the one the canonical graph was built from.

**Resolve the bolt port from the container, never from this table.** Names are stable; ports are
minted per build.

```bash
docker inspect DEV_pesc260805 --format \
  '{{range $p,$c := .NetworkSettings.Ports}}{{if eq $p "7687/tcp"}}{{(index $c 0).HostPort}}{{end}}{{end}}'
```

---

## 2. WHAT THE VALIDATOR PROVES

```
roundTripClean ................. true
reproduced ..................... 173,216
INVENTED ....................... 0
LOST ........................... 0
contentGap ..................... 0
explicitlyOmitted .............. 0
whitespaceOnlyDifference ....... 0
syntheticReproducible .......... true   (109 definitions — S-1 IDENTITY ONLY)
```

**The mechanism.** The validator re-emits XSD from the materialized graph, canonicalizes both the
emission and the ingested corpus into statement sets, and compares by set membership. It reads the
**SOURCE tier only** — the derived and synthetic tiers are excluded by a stated predicate, because
emitting them would fabricate statements PESC never made.

**The graph it read**, from the verdict's own `graph` block: 41,676 source-tier nodes —
`PescNamedDefinition` 12,909 · `PescElementDecl` 16,969 · `PescDerivation` 10,848 ·
`PescAnonymousType` 720 · `PescImportDecl` 82 · `PescAttributeDecl` 84 · `PescArtifact` 64.

### INVENTED > 0 FAILS A BUILD. LOST > 0 IS TOLERATED.

**An invented statement is a lie the graph tells. A lost statement is a truth it fails to tell.**

That asymmetry is the doctrine, not a convenience. No amount of coverage elsewhere excuses a
fabrication, so invention fails unconditionally; a gap is a work order, so loss is logged and carried
as the enrichment meter. **No percentage participates in acceptance** — this project has watched a
tampered emission carrying four fabricated statements report 71.9% fidelity.

### The gate that certifies the run actually happened

```
graphBuilder: [goldEvalCheck] PASS — 1 declared validator(s) ran with inventedTotal=0     exit 0
```

**And its negative control, run against the stage-OFF sibling's directory:**

```
graphBuilder -goldEvalCheck: REFUSED — the round-trip stage did not run for this build
(summary disposition: 'off: recipe default (roundTripStage absent)')                      exit 1
```

**This matters more than it looks.** Before Phase 7 the validator was DECLARED and never INVOKED — and
a declared-but-uninvoked stage emits no error, no log line and no failing test. It is
indistinguishable from a working one by inspection. **The refusal is what makes the PASS mean
something.**

### The independent instrument

A third-party Python XSD component-model implementation (`xmlschema`, `XMLSchema11`) reading both
sides, sharing no code with our emitter or canonicalizer.

| | source | emitted |
|---|---:|---:|
| attempted | 64 | 64 |
| compiled clean | 55 | 55 |
| refused | 9 | 9 |
| traversalUnavailableTypes | 28 | 28 |

`compileAgreement`: `sharedFilenames 64`, `bothClean 55`, `sourceCleanEmittedNotClean 0`,
`emittedCleanSourceNotClean 0`. Refusal cause tallies are **identical objects** on both sides —
3 × missing group, 6 × unknown type.

### The suites

**58 / 72 / 107 = 237 passed, 0 failed.** Re-run in this pass, not read from a log. The campaign's
first all-green state, and it holds.

---

## 3. WHAT IT DOES NOT PROVE

**Read this section before quoting anything from §2.**

> **THE AUTHORITY FOR THIS SECTION IS THE VERDICT, NOT THIS DOCUMENT.** The normative statement is the
> `semanticValidationLimit` field shipped in every verdict, declared at
> `roundTripValidator.js:636`; **Appendix A** below reproduces it verbatim. This section is a reading
> of it. **If the two ever disagree, the verdict wins and this document is stale** — which is the same
> rule the validator's own header comment applies to itself (*"the verdict … is the authority and this
> comment is the summary"*).
>
> That ordering exists for a reason recorded in the code: Phase 6 declared four constructs unmodelled,
> Phase 6.5 closed three of them, and the declaration was **rewritten rather than footnoted** because
> *"a limitation that quietly becomes false is its own defect, and it is the one nobody goes back to
> check."* A stale limitation understates the instrument exactly as badly as a missing one overstates
> it.
>
> **This section covers two different kinds of limit and they should not be conflated.** The
> unmodelled dimensions below are a statement about SCOPE — outside the boundary, nothing is claimed.
> The named defect at the end of this section is different and worse: it is a way the number can be
> wrong **inside** the boundary, in the instrument's own favour.

### `lostTotal 0` means zero loss IN THE DIMENSIONS THE COMPARATOR MODELS

Three dimensions are unmodelled. They cannot register as loss, because nothing on either side looks
at them.

- **TYPE-REFERENCE NAMESPACE — the most serious.** `canonicalTypeRef` strips the prefix, so a
  reference repointed to a same-named type in a *different namespace* canonicalizes identically.
  **This is the exact defect class the bundle was commissioned to eliminate, surviving in the object
  space.** It is fixed in the subject space — the graph carries 33 distinct `TransmissionDataType`
  nodes — and the comparator has not followed.
- **ATTRIBUTE ORDER.** Not modelled.
- **THE 2nd..nth `xs:documentation` LITERAL.** The forge keeps the first.

**Any restatement of `lostTotal 0` that omits this qualification is a defect.** The qualification is
carried in `roundTripVerdict.json`, `roundTripStageSummary.json` AND the `-goldEvalCheck` payload,
because a qualification that lives only in the artifact nobody opens is not a qualification.

### THE MUTUAL BLIND SPOT — 141 facts nothing has ever looked at

**Measured in this pass, not inherited:**

| property | nodes carrying it | read by the emitter | read by the canonicalizer |
|---|---:|---:|---:|
| `substitutionGroupAsWritten` | 113 | **0** | **0** |
| `abstract` | 28 | **0** | **0** |

The parser captured them faithfully. **Neither the emitter nor the comparator reads them, so they
report ZERO LOSS ON BOTH SIDES.** A one-sided omission shows as loss and gets investigated; one shared
by both sides is invisible by construction and reads as fidelity.

### `syntheticReproducible: true` is narrower than the boolean suggests

It covers **S-1 identity only** — 109 merged definitions checked by kind and name. **S-1c's 522
children and S-2 are unchecked.** The qualification travels with the boolean.

### `roundTripClean` is not "identical"

Semantic validation cannot detect a change that is semantically null but byte-visible. **"Semantically
clean" must never be reported as "identical."**

### Nothing here speaks to completeness with respect to PESC

The verdict measures fidelity **to the ingested snapshot**. It cannot see what was never ingested.
That is precisely the criticism that retired the incumbent's `contentGap 732`, and it applies here
too.

### The 9 refusals are a LOWER BOUND

They come from a fail-fast processor that reports the FIRST fault per component. **The claim is that
the two sides refuse the same files for the same causes — not that nine is the number of defects in
PESC's bytes.**

### P6-D1 — a blind spot in the loss counter, covering six kinds of schema housekeeping

**THE SHORT VERSION, BEFORE ANY DETAIL.** The number `lostTotal 0` could, in principle, be too low —
but only for **six specific kinds of statement, all of them file-level schema housekeeping.** Not
types. Not elements. Not documentation. Not enumeration values. **Nothing that describes the data
model itself.** Today the count of statements that could hide there is **zero**, so nothing is
actually hidden. This does not mean "the round trip doesn't work"; it means one narrow drawer in the
filing cabinet is unlocked, and the drawer is currently empty.

**HOW THE COUNTING WORKS.** The round trip compares the source schemas against the schemas rebuilt
from the graph. Statements that fail to match are sorted into two piles:

| pile | meaning | counted in `lostTotal`? |
|---|---|---|
| `contentGap` | **real loss** — the graph should carry this and does not | **YES** |
| `explicitlyOmitted` | **deliberate** — the graph is designed not to carry this | **no** |

`lostTotal` counts only the first pile. That is correct behaviour: you do not want a design decision
inflating a loss figure.

**THE DEFECT IS HOW A STATEMENT GETS SORTED.** The sort looks at **the statement's field name and
nothing else.** Six field names are on a hard-coded "deliberate" list:

    targetNamespace           which namespace this schema file declares itself to be
    schemaVersionAttribute    the version attribute on the schema element
    elementFormDefault        whether local elements are namespace-qualified
    attributeFormDefault      whether local attributes are namespace-qualified
    importsNamespace          which other namespaces this file imports
    importsSchemaLocation     where those imported files live

**Nothing checks whether the omission actually was deliberate.** If the forge genuinely BROKE and
dropped one of those six, it would be filed as "we meant to do that" and would not appear in
`lostTotal`. The report would call it *"declarations the graph deliberately does not carry — CHOSEN,
never lost"*, and that sentence would be false.

**CONCRETELY, THE BEFORE AND AFTER.** Suppose a future forge change accidentally stops recording which
files a schema imports:

- **What should happen:** 40 `importsNamespace` statements go missing → `lostTotal` rises by 40 → the
  build reports real loss and somebody investigates.
- **What would happen:** those 40 land in the `explicitlyOmitted` pile because their field name is on
  the list → **`lostTotal` stays 0** → the build looks clean.

**HOW BIG IS THE BLIND SPOT.** The comparison handles **27 kinds of statement. Six are on the list.**
The other 21 — including `declaresComplexType`, `declaresSimpleType`, `declaresRootElement`,
`documentation`, `enumerationValue`, `derivesFrom`, `restrictionBase`, the compositor statements and
the type references — **cannot be routed this way at all.** Everything that carries the actual content
of the standard is outside the blind spot.

**IT WAS DEMONSTRATED, NOT REASONED.** On 2026-08-06 a single character was altered inside one
`xs:documentation` string in `TestScoreReport_v1.1.0.xsd` of a scratch corpus copy — one differing
byte by `cmp`, with `SHA256SUMS` regenerated so the checksum gate was satisfied and the comparator
actually reached. Because the file label is content-addressed, the whole file decoupled and all EIGHT
of its statements went unmatched: **three filed `contentGap`, five filed `explicitlyOmitted`.** The
raw unmatched count rose 293 → 301 while `lostTotal` rose only 293 → 296. **Five real losses became
invisible.** Reproduce with `test/probes/p6_explicitlyOmittedLaundering.js`.

**WHAT IS AND IS NOT CLAIMED — read this before quoting the defect anywhere.** In that same
demonstration `inventedTotal` ALSO moved 0 → 8, and **`inventedTotal > 0` fails a build**, so that
particular breakage does **not** escape; a different gate catches it loudly. **What is proven is that
the mis-sorting path is real and reachable.** The genuinely dangerous case — a breakage that hides in
that pile WITHOUT also creating invented statements — **has not been demonstrated and is not claimed
to exist.**

**WHERE IT STANDS TODAY.** `explicitlyOmittedTotal` is **0** in the current build. Nothing is hidden,
because nothing is in the pile. The verdict is blunt about what that is worth: *"luck rather than
safety: the path is live and was demonstrated, not inferred."*

**THE FIX, IF SOMEONE TAKES IT UP.** Sorting a statement into the deliberate pile should require
evidence that the omission was designed — the design ruling that authorises it — rather than the field
name alone. Until then, a reader who cares about those six housekeeping fields should read
`explicitlyOmittedTotal` alongside `lostTotal` rather than trusting `lostTotal` by itself.

**OWNERSHIP.** NOT repaired. Phase 6 was anti-cheat work: it finds and reports rather than fixes.

> **A CORRECTION TO THE VERDICT'S OWN DESCRIPTION, found 2026-08-08 while writing the plain-language
> version above.** The `namedDefectList` entry lists **five** field names. The registry
> (`lib/roundTripXsdCanonical.js:103`) holds **six** — the entry omits **`schemaVersionAttribute`**,
> which appears nowhere in `roundTripValidator.js`. The list above is the registry's, read from the
> code. **The defect's own description understated the defect**, which is a small instance of exactly
> the thing this section is about: a hand-maintained list that drifts from the thing it describes, with
> nothing to notice. Reported and not repaired — the fix belongs with the defect.

---

## 4. KNOWN GAPS AND BACKLOGS

Full detail in `README_KnownIssues.md`. Enumerated here so a reader of this certificate alone is not
misled by omission.

| gap | count | status |
|---|---:|---|
| unmodelled comparator dimensions | 3 | open; type-reference namespace is the serious one |
| mutually-blind properties | 141 nodes (113 + 28) | open; invisible to the verdict by construction |
| assertions carrying a top-level conjunction | 77 of 238 | open; recommended as its own phase |
| …of those, `proven` with 3+ conjuncts | **8** | **the fall from 11 is NOT progress — see below** |
| rows re-stated `expectationLeverOnly` | 65 | open; each needs a data lever or a reasoned move to `genuineGap` |
| ledger rows never demonstrated able to fail (`genuineGap`) | 78 | open |
| ledger rows red in an unretained log (`recordsGap`) | 40 | open; not to be re-run here |
| interpolated assertion labels | 2 | repair deferred — it re-keys the ledger |
| real enumerated content loss (documentation literals) | **2** | `DocumentCategory`, `DocumentFormat` in `AcademicRecord_v1.14.0.xsd` |
| emitter refusal-guard boundary | 84 shapes | declared: group-reference/wildcard-only content models |
| CONCEPT COLLAPSE (Phase 8) | 217 → 15 → 7 hits | **chartered, not started, deliberately deferred by TQ** |

**Ledger status distribution: `proven 54 · expectationLeverOnly 65 · genuineGap 78 · recordsGap 40`
(237 rows).**

### THE 11 → 8 IS NOT PROGRESS

**Three rows LEFT the proven population by re-statement. No conjunction was repaired, no assertion was
split, and the underlying risk is exactly what it was.** The population the metric counts got smaller;
the thing the metric measures did not. Anyone skimming a falling number will read it as improvement,
which is why it is spelled out here.

### And one defect found in this pass, whose cause turned out to be the opposite of its symptom

**`test/redEvidenceLedger.json`'s stored `conjunctionEvidenceMeasurement` block is SUPERSEDED** — it
reads 233 / 78 / 11 where the live instrument computes **238 / 77 / 8**.

**The obvious repair — regenerate the ledger — DESTROYS IT.** `buildRedEvidenceLedger.js` is a
generator; the Phase 7 remediation was applied by three migrations that run *after* generation; there
is no reassembly step. Running the generator alone deletes three top-level blocks and **silently
reverts 65 rows from `expectationLeverOnly` back to `proven`**, exiting 0 with well-formed JSON.
Observed in this pass, halted, restored, and verified byte-identical to committed.

**So the block is not stale through neglect — it is stale because refreshing it is unsafe, and
whoever last touched it was right not to.** It now carries `supersededFigures` and `doNotRegenerate`
annotations in place. Full detail and the real fix in `README_KnownIssues.md` §10.

---

## 5. HOW TO REPRODUCE IT

**Every command below was run in this pass, from
`/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge`.**

```bash
# 1. the corpus is what it claims to be
cd forges/pesc260805/assets/standardSourceData/01 && shasum -a 256 -c SHA256SUMS
#    observed: 64 files OK, 0 failures

# 2. the acquisition gates, no network
cd forges/pesc260805/assets/acquisition && node acquirePescCorpus.js -selfTest
#    observed: 3 red / 4 green / 0 unexpected, VERDICT: SELF-TEST PASS

# 3. build with the stage ON  (run nohup-detached; ~2 min)
jq -nc --arg recipePath "$PWD/recipes/pesc260805OnlyRoundTrip.recipe.jsonc" \
       --arg storePath  "<a throwaway>.standardsDatabase.sqlite3" \
  '{switches:{build:true},values:{recipePath:[$recipePath],standardsDatabaseFilePath:[$storePath],vectorize:["false"]}}' \
  | node apps/graph-builder/graphBuilder.js

# 4. the promotion gate, and its negative control
jq -nc '{switches:{goldEvalCheck:true},values:{buildLogDirPath:["<the stage-ON run dir>"]}}' \
  | node apps/graph-builder/graphBuilder.js      # PASS, exit 0
jq -nc '{switches:{goldEvalCheck:true},values:{buildLogDirPath:["<a stage-OFF run dir>"]}}' \
  | node apps/graph-builder/graphBuilder.js      # REFUSED, exit 1

# 5. the suites
cd forges/pesc260805
node test/test-pesc260805SourceTier.js       # 58 passed, 0 failed
node test/test-pesc260805DerivedTier.js      # 72 passed, 0 failed
node test/test-pesc260805SyntheticTier.js    # 107 passed, 0 failed

# 6. the evidence instruments
node test/probes/mp_auditConjunctiveAssertions.js    # 238 / 77 / 8; denominator closes 238 = 238
node test/probes/p7_expectationLeverSweep.js         # 54 proven, 54 data-levered; reconciliation 0/0/0
node test/probes/p7_repinnedDescriptorLevers.js      # ONE-SHOT: mutates parserDescriptor.ini, restores it
git status --short forges/pesc260805/parserDescriptor.ini   # must be EMPTY afterwards
```

**Do not add `< /dev/null` to any invocation receiving JSON on the pipe.** It overrides the pipe,
graphBuilder gets no input, prints its help page and **exits 0** — which looks exactly like success. I
did it once in this pass.

---

**Certificate written 2026-08-07 by session VIOLET_STONE, from a build it ran, against artifacts it
opened. Where a figure is inherited rather than measured here, the surrounding text says so.**

---

## APPENDIX A — the `semanticValidationLimit`, verbatim

This is the normative statement, shipped in **every** verdict this bundle produces. It is reproduced
here so a reader of the certificate need not open a source file to see it, and so that any drift
between the two is visible. **It is the authority; §3 is the reading.** Source:
`forges/pesc260805/roundTripValidator.js:636` (line-wrapped here from the emitted single string;
otherwise unaltered).

> SEMANTIC round-trip: statement-set equality, not byte equality, and the statement set is the one
> THIS INSTRUMENT CHOOSES TO MODEL. WHAT IS MODELLED AS OF PHASE 6.5, each on BOTH sides: (1) THE
> COMPOSITOR — kind, effective occurrence, nesting, and the ORDERED particle list, as
> `declaresContentModel` / `compositorKind` / `compositorMinOccurs` / `compositorMaxOccurs` /
> `particleAt:N` statements; (2) PREFIX BINDINGS — `declaresNamespacePrefix` and `boundNamespace` per
> xmlns declaration; (3) ELEMENT ORDER within a content model, which the ordinal in `particleAt:N`
> makes visible. THE PHASE 6 DECLARATION THAT ELEMENT ORDER IS UNDETECTABLE IS RETRACTED ON EVIDENCE:
> a driven sibling swap in a graph row moves 2 statements and moved 0 under the previous form
> (`test/probes/p65_contentModelLevers.js`). WHAT REMAINS UNMODELLED, and is therefore invisible as
> loss rather than merely hard to see: (a) THE NAMESPACE OF A TYPE REFERENCE — `canonicalTypeRef`
> strips the prefix, so a reference repointed to a same-named type in a DIFFERENT namespace
> canonicalizes identically; this is R-ID-1 fusion surviving in the object space and it is the more
> serious of the residue; (b) ATTRIBUTE ORDER; (c) SEVERAL `xs:documentation` children of one
> `xs:annotation`, of which the forge keeps the first (see `knownResidue`). ALSO DECLARED, a measured
> boundary of the emitter rather than of this comparison: a container whose content model holds ONLY
> group references or wildcards declares no element children, so a missing `contentModelShape` there
> cannot be refused by name and shows up as ordinary loss in this diff instead. **"Semantically clean"
> MUST NEVER be reported as "identical".**

**Why it reads as a rewrite rather than an amended list**, from the comment immediately above it in
the source: Phase 6 correctly named the compositor, prefix bindings and element order as unmodelled;
Phase 6.5 made the emitter write all three and the canonicalizer model them on both sides, so a
declaration that still listed them *"would be the same defect Phase 6 was penalised for, running in
the opposite direction. **A LIMITATION THAT QUIETLY BECOMES FALSE IS ITS OWN DEFECT, and it is the one
nobody goes back to check.** Rewritten rather than footnoted."*

---

**APPENDIX A and the P6-D1 subsection in §3 added 2026-08-08 by session JADE_PORTAL**, on TQ's
question, after the certificate was committed at `d7cae21`. Nothing else in this document was
changed.

**THE GAP WAS REAL AND IS WORTH RECORDING AS ONE.** P6-D1 was put into the validator's VERDICT — the
JSON every build emits — on the reasoning that a defect belongs *"in the verdict rather than in a
document nobody opens."* When this certificate was written months later, **whoever wrote it did not
copy P6-D1 across.** Nothing blocked it and nothing lost it; it was simply not carried over.

So the defect was sitting in the machine-readable output the whole time, and absent from the
human-readable document a person consults **precisely because they do not already know what to look
for.** The verdict is where you find something if you know it exists. The certificate is where you go
when you don't.

**Putting a fact in the output is not the same as putting it in front of a reader**, and the first one
feels enough like the second that nobody checks.
