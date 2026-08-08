# Validation certificate — Ed-Fi

**This is not a victory lap. Its job is to let you decide how far to trust this graph, which means the
limits below carry the same weight as the results above them.**

One of four, written to the same five headings so the four can be read side by side:
`forges/{ceds,edfi,sif,pesc260805}/README_ValidationCertificate.md`.

**Ed-Fi is the only one of the four that is NOT clean, and that is the honest state of unfinished
enrichment work — not a failure.** It also carries a defect that was found, named, and **deliberately
left unfixed**. Both are below.

---

## 1. WHAT WAS VALIDATED

| | |
|---|---|
| **standard** | Ed-Fi Data Standard **5.2.0** — 849 MetaEd constructs, 1,904 properties, 3,522 descriptor code values |
| **corpus** | the committed MetaEd package snapshot under `forges/edfi/assets/standardSourceData/`, plus descriptor code-value XML and authored-crosswalk CSV |
| **recipe** | `recipes/fourWithNewPescRoundTripNoBridges.recipe.jsonc` — `roundTripStage: true`, `hubs: []`, `bridges: []` |
| **run** | `system/dataStores/buildLogs/fourWithNewPescRoundTripNoBridges_20260808-001444/` |
| **date** | 2026-08-07, session VIOLET_STONE |
| **commit** | branch `architecture-improvement`; the recipe is committed at `a0a4a90` |
| **graph** | `DEV_FourWithNewPesc` (built as `DEV_gb_materialize_82136_5`, renamed) |

```bash
docker inspect DEV_FourWithNewPesc --format \
  '{{range $p,$c := .NetworkSettings.Ports}}{{if eq $p "7687/tcp"}}{{(index $c 0).HostPort}}{{end}}{{end}}'
```

**Resolve the port from the container, never from this document.** On the evening this ran, one bolt
port served three different graphs in a few hours.

**THIS IS A FOUR-STANDARD GRAPH AND Ed-Fi IS ONE ISLAND IN IT.** 100,979 nodes total — **EdFi 6,336**,
CEDS 25,202, SIF 27,069, PESC260805 42,372 — with **zero cross-standard edges** by design.

---

## 2. WHAT THE VALIDATOR PROVES

```
roundTripClean ..... FALSE
reproduced ......... 25,374
INVENTED ........... 0
LOST ............... 349
contentGap ......... 349
explicitlyOmitted .. 0
```

**`roundTripClean: false` is the correct and expected state.** The build passed.

### INVENTED > 0 FAILS A BUILD. LOST > 0 IS TOLERATED. THIS IS WHY Ed-Fi PASSES.

**An invented statement is a lie the graph tells. A lost statement is a truth it fails to tell.**

A fabrication is an assertion about Ed-Fi that Ed-Fi never made, and no amount of coverage elsewhere
excuses one — so invention fails a build unconditionally. A gap is a coverage problem, so it is
**tolerated, logged, and enumerated** as the enrichment meter. **Ed-Fi's 349 is a measured backlog,
reported honestly. It is not a target to hit and it is not a build failure.**

```
graphBuilder: [goldEvalCheck] PASS — 4 declared validator(s) ran with inventedTotal=0     exit 0
```

**The gate certifies on `inventedTotal = 0`, not on `roundTripClean`.** That is deliberate and it is
the doctrine's whole shape.

### The mechanism, and the independence claim it rests on

`lib/roundTripMetaEdCanonical.js` reduces MetaEd source text, descriptor XML and crosswalk CSV to a
canonical statement set — the **answer-key** side — while the graph side is emitted from the
materialized graph scoped to Ed-Fi.

**It shares ZERO code with the Phase 1 parser** (`metaEdLexer.js` / `metaEdSyntaxParser.js` /
`metaEdParser.js`) and the Phase 2 loaders. The strategy differs on purpose — a masking scanner plus a
flat keyword-phrase extractor, no token-type registry, no recursive descent, no resolved model.

**Because if the instrument reused the forge's parser, a parser bug would cancel on both sides of the
diff and a dropped statement would read as REPRODUCED.**

---

## 3. WHAT IT DOES NOT PROVE

> ⚠️ **THE QUALIFICATIONS IN THIS SECTION ARE MINE, NOT THE BUNDLE'S.**
>
> **This bundle declares no `semanticValidationLimit`.** The builder's `-goldEvalCheck` payload says
> so: *"NONE DECLARED BY THIS BUNDLE… what this round-trip does and does not model is UNSTATED — read
> the validator before treating lostTotal as a measure of fidelity."*
>
> **So I read the validator.** Everything below was derived from
> `forges/edfi/lib/roundTripMetaEdCanonical.js` on **2026-08-07**, cited to line. **A derived
> qualification is far more useful than a bare number and far less trustworthy than a declared one** —
> it drifts silently the moment someone edits the module.
>
> **RECOMMENDED (not implemented — outside this pass's authorization): this bundle should declare a
> `semanticValidationLimit` in its verdict, the way `pesc260805` now does.**

**Ed-Fi is better placed than most here**, because the canonicalizer states a **DECLARED EQUIVALENCE
POLICY** in its own header — *all stated, none silent.*

### The declared equivalences (R-WO-15)

- **(a) `//` COMMENT LINES ARE EXCLUDED** from the statement domain — non-semantic by the publisher's
  own grammar (`LINE_COMMENT -> skip`). **Each one is censused with file:line**, so the material is
  visible rather than silently dropped. **19 comment lines** in this run.
- **(b) THE DECLARED ITEM KEYWORD IS EXCLUDED FROM STATEMENT IDENTITY**, uniformly, for domain-item
  and interchange-component statements — which carry the item NAME only. The source itself uses the
  keyword loosely (**3 censused drift cases**). An embedded exception list would be data inside the
  serializer, an RT-5 violation.
- **(c) OPTION-VALUE SUBJECTS USE THE TRIMMED VALUE TEXT** while the statement OBJECT carries the
  source-verbatim string — *trimmed identity, verbatim value.*
- **(e) DECLARATION ORDER WITHIN A CONSTRUCT IS NOT MEASURED.** Set semantics. **A reordering of
  declarations inside a construct cannot register as a difference.** *(Contrast SIF, where order IS
  part of statement identity — the four bundles do not agree on this and a reader comparing them
  should not assume they do.)*
- **DOCUMENTATION PROSE IS WHITESPACE-COLLAPSED** on both sides identically
  (`roundTripMetaEdCanonical.js:72`).

**A DOCUMENTATION GAP I FOUND WHILE READING, REPORTED NOT FIXED: there is no policy (d) in that
lettered list** — it runs (a), (b), (c), (e) — **yet `R-WO-15(d)` is referenced in the code at
`roundTripMetaEdCanonical.js:799`, and all 349 lost statements are labelled against it** (§4). The
policy is load-bearing and its statement is missing from the block that enumerates the policies.

### The honest limit the module states about ITSELF

> **the independence is of CODE PATH and FAILURE MODE, not of MIND — same author, same reference
> grammar.**

That is the module's own sentence, and it is the right one. The bounding instruments are the
adversarial-pair fixtures (cosmetic variants MUST collapse; semantic variants MUST NOT) and a
two-independent-readers census cross-check against the Phase 1 census of record — **disagreement being
a finding either way.**

### Scope and refusal boundaries

- **The reducer accepts the published packages' bare `topLevelEntity` file form** (all 849 corpus
  files). **An explicit `Begin Namespace` wrapper is a REFUSAL BY NAME, not a skip** — if a future
  snapshot ships wrapped files, the refusal surfaces for adjudication instead of quietly measuring
  less.
- **Any text the reducer cannot classify is a CANONICALIZATION FAULT — fatal, never advisory**,
  because a half-reduced document must not produce a verdict someone might believe.

### Out of scope entirely

**Mapping and cross-standard content.** Ed-Fi is base-only in this graph — **zero cross-standard
edges by design.** The authored crosswalk is stashed, not mapped (§4).

---

## 4. KNOWN GAPS AND BACKLOGS

### The 349, enumerated by name from this run's verdict

```
interchangeComponentKind (R-WO-15d) ............. 205
itemMetaEdId (R-WO-15d extension) ............... 130
itemNamespaceQualifier (R-WO-15d extension) ..... 14
                                                 ---
                                                 349
```

Read from `lostByBacklogLabel` in `<runDir>/roundTrip/edfi/roundTripVerdict.json`, **not** from the
recipe header — the recipe's PESC figures turned out to be superseded, so none of its numbers were
taken on trust. **These three reproduce the header's decomposition exactly.**

### Explicitly omitted, censused rather than dropped

| item | count | policy |
|---|---:|---|
| `//` comment lines | **19** | R-WO-15(a) — lexer-skipped by the publisher's grammar |
| item-keyword drift cases | **3** | R-WO-15(b) — forge-report provenance, not re-measured by the instrument |

### The crosswalk guard

The authored-crosswalk CSVs are a **declaredContext** input (R-WO-12) — authored data stashed for a
later bridge phase, **never Layer 1 statements** — and are guarded against invention by raw-value set
membership. From this run: `stashRawValueCount 3,076`, **`violationCount 0`**, `csvRowCountTotal
9,976`, `csvDistinctGlobalIdCount 452`, `csvDistinctOptionCodeCount 2,129`.

**Why it is stashed rather than mapped:** 1,147 Ed-Fi nodes carry an authored `cedsId`. **That is the
answer key, not an input.** Loading the authored bridge and then scoring against it would be marking
our own homework.

### THE GATE-2 ATTRIBUTION DEFECT — FOUND, NAMED, AND DELIBERATELY LEFT UNFIXED

**A certificate that reported the 349 and hid this would be the wrong document.**

Gate 2 compares **materialized graph entities** against **block-derived literals** and, on a mismatch,
its message says the mismatch means *"the loader dropped or added something."*

**That is one of at least two possible causes, stated as if it were the only one.** The replay engine
MERGEs edges (`lib/replay/replay-engine.js:288`), so two identical `(fromRef, type, toRef)` triples in
a block collapse into ONE graph relationship — and **gate 1 checks only the COUNT of the edges array,
never its uniqueness.** So a block carrying 8,171 edges of which two were identical would PASS gate 1,
materialize 8,170, and trip gate 2 **with a message blaming the loader for what is actually a
block-side duplicate.** The gate would still correctly FAIL; **its stated diagnosis would send the
next person to the wrong file.**

**IS IT REACHABLE OR THEORETICAL? MEASURED, NOT REASONED.** The forge emits **8,171 declared edges and
8,171 distinct `(fromRef, type, toRef)` triples — zero duplicates, collapse exposure 0.**

**So the hazard is LATENT, NOT FIRING — and it is recorded as latent rather than asserted safe.** The
two sides agree *by circumstance in this corpus*, which is exactly why a cross-measurable comparison
can sit unnoticed. Nothing is currently wrong with the numbers.

**The recommended remedy, not applied** (it is a gate-semantics change): have **gate 1 assert triple
UNIQUENESS as well as count**, so a block-side duplicate is caught on the block side where it belongs,
and **narrow gate 2's message to the causes it can actually distinguish.**

> **A LINE-NUMBER CORRECTION, BECAUSE A CITATION IS A PROMISE SOMEONE CAN OPEN IT.**
> `DEVLOG-edfiRoundTripForge-080326.md` cites this gate at `test/runEdfiMaterialize.js:155`.
> **Measured 2026-08-07 with `/usr/bin/grep -a`, the `"the loader dropped or added"` message is at
> `test/runEdfiMaterialize.js:199`.** The file has grown since the finding was written and the
> citation drifted. **A hand-typed line number in a published finding decays silently** — the same
> class the PESC campaign repaired by recomputing site citations from the files rather than retyping
> them.

### Summary of what is open

| item | status |
|---|---|
| 349 lost statements | **open**, enumerated by name above |
| no declared `semanticValidationLimit` | **open** — §3 is derived by reading code |
| missing policy **(d)** in the lettered header list | **open** — referenced at `:799` and carrying all 349 labels |
| gate-2 attribution defect | **open, LATENT, deliberately unfixed**, remedy recommended |
| stale DEVLOG citation `:155` → `:199` | **reported here**; the DEVLOG is outside the git repo |
| mapping / bridge content | **absent by design in this graph** |

---

## 5. HOW TO REPRODUCE IT

**Every command below was run from
`/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge` on 2026-08-07.**

```bash
# the build that produced this certificate (nohup-detached; SIF in the same recipe needs the heap)
jq -nc --arg recipePath "$PWD/recipes/fourWithNewPescRoundTripNoBridges.recipe.jsonc" \
       --arg storePath  "<a throwaway>.standardsDatabase.sqlite3" \
  '{switches:{build:true},values:{recipePath:[$recipePath],standardsDatabaseFilePath:[$storePath],vectorize:["false"]}}' \
  | node --max-old-space-size=5510 apps/graph-builder/graphBuilder.js

# the certification gate — PASSES despite roundTripClean false, because invented is 0
jq -nc '{switches:{goldEvalCheck:true},values:{buildLogDirPath:["<the run dir>"]}}' \
  | node apps/graph-builder/graphBuilder.js       # PASS, exit 0

# this standard's verdict and its named backlog
jq '{roundTripClean,reproduced,lostTotal,contentGapTotal,inventedTotal}' \
  <runDir>/roundTrip/edfi/roundTripVerdict.json
jq '.lostByBacklogLabel' <runDir>/roundTrip/edfi/roundTripVerdict.json
jq '.crosswalkGuard'     <runDir>/roundTrip/edfi/roundTripVerdict.json
```

**The Ed-Fi gate suite and its fault-injection twins were NOT run in this pass** — named rather than
omitted. They live in `forges/edfi/test/`.

---

**Written 2026-08-07 by session VIOLET_STONE, from a build it ran and artifacts it opened. Section 3
is derived from the validator's source and is labelled as such throughout. The gate-2 defect and the
line-number correction are reported, not fixed — this pass's authorization was additive documentation
only.**
