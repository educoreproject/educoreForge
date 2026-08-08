# How to forge PESC

**What it does:** reads 64 XSD artifacts that PESC actually published and produces a graph of the
PESC schema family — every definition, in every version, without fusing any two of them.

```
nodes ......................  42,372
edges ......................  70,628
statements reproduced ......  173,216
INVENTED ...................        0
LOST .......................        0
```

**That `LOST 0` carries a qualification and the qualification is not optional.** Read
`README_KnownIssues.md` before you quote the zero. It means zero loss *in the dimensions the
comparator models*, and three dimensions are not modelled.

**EVERY COMMAND IN THIS FILE WAS RUN, in the directory it names, on 2026-08-07 (session
VIOLET_STONE), against commit `dfe97d3` on branch `architecture-improvement`.** Where a command was
NOT run in that pass it says so in the same breath. A command proof-read into existence is the
documentation equivalent of a gate that has only ever passed.

Unless a block says otherwise, the working directory is:

```
/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge
```

---

## The four tiers

Everything in this graph carries a `pescTier`, and the tier is the first question to ask about any
node. **Derived and synthetic look alike and are opposites.**

| tier | what it means | nodes | what they are | emitter reads it? |
|---|---|---:|---|---|
| **source** | a file literally says this | 41,676 | definitions, element declarations, derivations, anonymous types, imports, attributes, the 64 artifacts | **YES — and only this** |
| **derived** | computed from source, fully recoverable from it, disposable | 63 | `PescNamespace` — the namespaces resolved out of the import declarations | no |
| **synthetic** | a DECISION, not recoverable from source, must be defended | 632 | the merged AcademicRecord v1.6.0 and its children, plus the `CoreMain v1.6.0` stand-in namespace | no |
| **meta** | the standard's own root node | 1 | `pesc260805:root` — labelled `DmeStandardRoot` / `Pesc260805Root`; this is what the DME hangs the standard from | no |

*(Tier counts and label composition from a Cypher census of `DEV_pesc260805` run in this pass. The 63
derived and 1 synthetic `PescNamespace` nodes sum to the 64 namespaces — one per artifact.)*

**Why the emitter reads only `source`.** The round trip re-emits XSD from the graph and compares it
to the ingested corpus. A derived or synthetic node has no counterpart in any published file, so
emitting one would *invent* a statement PESC never made — the worst category, and the one that fails
a build unconditionally.

Census run in this pass, resolving the port from the container:

```bash
docker inspect DEV_pesc260805 --format \
  '{{range $p,$c := .NetworkSettings.Ports}}{{if eq $p "7687/tcp"}}{{(index $c 0).HostPort}}{{end}}{{end}}'
# observed: 7821
```

---

## The corpus, and why it is reproducible

**The corpus is in git, in this bundle, at `assets/standardSourceData/01/`.** 64 XSD artifacts,
9,733,713 bytes, plus `manifest.json`, `README_PROVENANCE.md` and `SHA256SUMS`.

**The `01` is OURS, not PESC's.** PESC publishes no coherent whole-family release. The manifest says
so in its own words — `aggregateVersionOwner` reads *"THIS VERSION NUMBER IS OURS… this aggregate is
our fabrication and must never be read as a PESC edition."*

### Verify the snapshot

```bash
cd forges/pesc260805/assets/standardSourceData/01
shasum -a 256 -c SHA256SUMS
```

**Observed: 64 lines in `SHA256SUMS`, 64 files reporting `OK`, zero failures.**

### The acquisition story

PESC publishes no repository, no index and no filenames. The artifacts sit on a GoDaddy asset CDN
behind opaque 32-hex URLs serving `application/octet-stream` with no `content-disposition`. **The
anchor text on the linking page is the only human-readable identity a file has.**

`assets/acquisition/acquirePescCorpus.js` re-derives the corpus from that. It guarantees four things,
each of which cost a failed run to learn:

- **Nothing reaches disk unless it parses as XML AND declares a `urn:org:pesc:*` targetNamespace.**
  A prior ad hoc harvest saved four 27-byte `{"error":"asset-not-found"}` bodies under schema
  filenames.
- **Filenames derive from the targetNamespace, never from anchor text.** The file names itself.
- **Hrefs carry entity-encoded ampersands.** Left as written, the CDN's `AccessKeyId` query string
  arrives malformed and every request returns HTTP 401.
- **When PESC publishes two different files under one namespace, BOTH are kept**, discriminated by
  content hash, and the collision recorded as a fact. Acquisition chooses neither; resolution is a
  forge decision. (See `README_identityRules.md`.)

Run its gates without touching the network:

```bash
cd forges/pesc260805/assets/acquisition
node acquirePescCorpus.js -selfTest
```

**Observed: `red demonstrations observed failing : 3 (expected 3)`,
`green assertions observed passing : 4 (expected 4)`, `unexpected outcomes : 0`,
`VERDICT: SELF-TEST PASS`, exit 0.**

A live re-acquisition takes `--outDir=<path>` instead. **That was NOT run in this pass** — it reaches
the network, and the point of `SHA256SUMS` is that you do not have to.

---

## Forge and load — one command

`-build` forges the bundle, harvests it into a schema block, composes a manifest, and materializes it
into a fresh Docker graph. **The bundle itself never touches a graph;** replayManager owns all graph
I/O.

```bash
jq -nc \
  --arg recipePath  "$PWD/recipes/pesc260805OnlyRoundTrip.recipe.jsonc" \
  --arg storePath   "/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/myRun.standardsDatabase.sqlite3" \
  '{switches:{build:true},values:{recipePath:[$recipePath],standardsDatabaseFilePath:[$storePath],vectorize:["false"]}}' \
  | node apps/graph-builder/graphBuilder.js
```

**Observed in this pass** (store `vsClosetVerify_20260807-185125.standardsDatabase.sqlite3`):

```json
{ "manifestId": "f17896a4a89c70a3034fd33f097833f69398bdbebcdf71e0f666d58512dd8acf",
  "boltUrl": "bolt://localhost:7811",
  "memberCount": 1,
  "roundTripSummaryPath": ".../buildLogs/pesc260805OnlyRoundTrip_20260807-235125/roundTrip/roundTripStageSummary.json" }
```

**That manifest id is byte-identical to the one the canonical graph was built from.** Determinism is
not decoration here: the build proves `graph == replay(manifest)`, and an id that varied between runs
would make every rebuild read as a change.

**FOUR THINGS THAT WILL COST YOU AN HOUR IF NOBODY TELLS YOU.**

- **`graphBuilder` reads JSON from stdin.** A foreground pipe-driven invocation with stdin redirected
  away — `... | node graphBuilder.js < /dev/null` — silently discards the JSON, prints the help page
  and **exits 0**. I did that in this pass. Exit 0 plus a help page looks exactly like success.
- **Run long builds nohup-detached**, writing the log to a path carrying a run stamp. A fixed output
  path turns a retry into a deletion; that is how Phase 7 destroyed the only record of a failed build.
- **`--vectorize=false` is deliberate, not a shortcut.** No round-trip assertion reads an embedding.
  The build default is `true` and spends real Voyage credit.
- **`--standardsDatabaseFilePath` has no default, deliberately.** A build that does not say where it
  writes is one edit away from writing the canonical store.

### Reproduce a graph from a stored manifest

```bash
jq -nc \
  --arg storePath "/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/myRun.standardsDatabase.sqlite3" \
  '{switches:{replay:true},values:{standardsDatabaseFilePath:[$storePath],manifestRefId:["f17896a4a89c70a3034fd33f097833f69398bdbebcdf71e0f666d58512dd8acf"]}}' \
  | node apps/graph-builder/graphBuilder.js
```

**Observed: same manifest id, `memberCount 1`, exit 0 — and this log line, which matters:**

```
[roundTrip] stage not applicable to -replay (the round trip runs at build time, against the build that composed the manifest)
```

**A replayed graph carries no fresh verdict.** If you need a verdict, you need a build.

---

## The two recipes, and when to use each

| | `pesc260805Only` | `pesc260805OnlyRoundTrip` |
|---|---|---|
| `roundTripStage` | absent (OFF) | `true` (ON) |
| `roundTripVerdict.json` | **not written** | written |
| `independentXsdCheck.json` | **not written** | written |
| `-goldEvalCheck` | **REFUSED, exit 1** | **PASS, exit 0** |

**Use the stage-ON recipe for anything you intend to certify. Use the stage-OFF recipe when you are
iterating and do not want to pay for a validation you are about to invalidate.**

**DO NOT DELETE THE STAGE-OFF RECIPE.** It is the control half of an A/B pair, and it is the only
proof the opt-in does anything. A declared-but-never-invoked stage emits no error, no log line and no
failing test — it is indistinguishable from a working one by inspection. That was the real state of
this bundle from Phase 5 until Phase 7, and nothing complained.

Both carry `hubs: []` and `bridges: []` deliberately. A hub or a bridge adds nodes this bundle did not
emit, which makes a conservation-by-set comparison unreadable.

---

## Run the round-trip validator

**The ordinary way is to build with the stage-ON recipe** (above). The stage runs the validator
declared in `parserDescriptor.ini` against the finished product graph and lands the verdict beside
the build outputs.

Read the verdict:

```bash
jq '{reproduced,inventedTotal,lostTotal,contentGapTotal,explicitlyOmittedTotal,syntheticReproducible,whitespaceOnlyDifferenceTotal}' \
  /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/<runDir>/roundTrip/pesc260805/roundTripVerdict.json
```

**Observed on this pass's own build:**

```json
{ "reproduced": 173216, "inventedTotal": 0, "lostTotal": 0, "contentGapTotal": 0,
  "explicitlyOmittedTotal": 0, "syntheticReproducible": true, "whitespaceOnlyDifferenceTotal": 0 }
```

### How to read a verdict

**`inventedTotal` and `lostTotal` are not symmetric and the asymmetry is the whole doctrine.**

- **`inventedTotal > 0` FAILS the build, unconditionally.** An invented statement is an assertion
  about PESC that PESC never made — a lie the graph tells.
- **`lostTotal > 0` is TOLERATED and logged.** It is the enrichment meter — a truth the graph fails
  to tell, which is a gap rather than a falsehood.

**`roundTripClean: true` is not "identical."** The comparison is statement-set equality over the
statements *this instrument chooses to model*. The verdict carries its own limits in a
`semanticValidationLimit` field; read that field, not just the numbers. It is deliberately also
stamped into `roundTripStageSummary.json` and into the `-goldEvalCheck` payload, because **a
qualification that lives only in the artifact nobody opens is not a qualification.**

**`syntheticReproducible` answers a different question from the rest of the verdict.** Synthetic
content matches no source file by construction, so it cannot be round-trip validated. It is checked
by re-running the documented synthesis rule over the preserved inputs and requiring exactly what is in
the graph. Observed: `syntheticReproducibilityTotal 109` — the merged AcademicRecord v1.6.0's named
definitions. **That check covers S-1's identity only** (see `README_KnownIssues.md`).

### The independent instrument

A third-party Python XSD component-model implementation reads both sides and shares no code with our
emitter or canonicalizer. **A tool cannot audit the assumption it is built on.**

```bash
jq '{source,emitted,compileAgreement}' \
  /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/<runDir>/roundTrip/pesc260805/independentXsdCheck.json
```

**Observed:** source `attempted 64, clean 55, refused 9, traversalUnavailableTypes 28`; emitted
**identical in all four**; `compileAgreement` `sharedFilenames 64, bothClean 55`,
`sourceCleanEmittedNotClean 0`, `emittedCleanSourceNotClean 0`.

**The 9 refusals are the same nine files for the same nine causes on both sides.** That is the claim —
not that nine is the number of defects in PESC's bytes. See `README_KnownIssues.md`; those tallies
come from a fail-fast processor and are lower bounds.

---

## The promotion gate — `-goldEvalCheck`

```bash
jq -nc '{switches:{goldEvalCheck:true},values:{buildLogDirPath:["<absolute path to the build run directory>"]}}' \
  | node apps/graph-builder/graphBuilder.js
```

**Observed, both halves, in this pass:**

```
# against pesc260805OnlyRoundTrip_20260807-235125  (stage ON)
graphBuilder: [goldEvalCheck] PASS — 1 declared validator(s) ran with inventedTotal=0        exit 0

# against pesc260805Only_20260807-223607          (stage OFF)
graphBuilder -goldEvalCheck: REFUSED — the round-trip stage did not run for this build
(summary disposition: 'off: recipe default (roundTripStage absent)'). GOLD_EVAL certification
requires every declared validator to have run and reported (doctrine §7.4); rebuild with
roundTripStage: true in the recipe.                                                          exit 1
```

**WHY A DEV GRAPH IS NEVER PROMOTED WITHOUT THIS.** Under GNC-001 a `DEV_` graph becomes
`GOLD_EVAL_<YYMMDD>` by a `docker rename` of the exact bytes you evaluated — never by a rebuild.
Renaming without this check would bless a graph whose validator may never have run, and the failure
is silent by construction: a stage that did not run produces no error to notice.

**The gate is on PROMOTION ONLY and must never gate CREATION.** Build as many `DEV_` scratch graphs
as the work needs; none of them consults this check.

*(The `docker rename` promotion step itself was NOT run in this pass — nothing here was promoted.)*

---

## The three suites

```bash
cd forges/pesc260805
node test/test-pesc260805SourceTier.js
node test/test-pesc260805DerivedTier.js
node test/test-pesc260805SyntheticTier.js
```

**Observed: 58 / 72 / 107 = 237 passed, 0 failed.** Re-run in this pass, not read from a log.

The suites read the canonical graph `DEV_pesc260805`. **Resolve its bolt port from the container, not
from this document.**

### The evidence instruments

```bash
cd forges/pesc260805
node test/probes/mp_auditConjunctiveAssertions.js   # measures the conjunction class
node test/probes/p7_expectationLeverSweep.js        # census vs classification, reconciled
node test/probes/p7_repinnedDescriptorLevers.js     # ONE-SHOT — see the warning below
```

**Observed in this pass:**

- **auditor** — 238 shipped rows, 77 carrying a top-level conjunction, 8 `proven` with 3+ conjuncts;
  `raw occurrences 244 - stripped 238 = 6 comment-resident`; `DENOMINATOR CLOSES: 238 … against 238
  occurrences actually present in the stripped text`; join integrity 0 unjoined.
- **lever sweep** — 54 proven, 54 carrying a DATA lever, 0 expectation-only among proven; 65 rows
  published as `expectationLeverOnly`; reconciliation 0 / 0 / 0 across its three comparisons.
- **descriptor levers** — accept-control held; three levers reddened `[0,1,2]`, `[0,1,2]` and `[0,2]`,
  each matching expectation; `parserDescriptor.ini restored byte-for-byte: true`.

**`p7_repinnedDescriptorLevers.js` MUST STAY ONE-SHOT.** It mutates `parserDescriptor.ini` — the
bundle's own self-description, read by `forger.js` on every build. It verifies its restore by byte
comparison and refuses by name if the restore failed, but **a suite that crashed mid-probe would leave
the descriptor mutated and every subsequent build reading it.** After running it, confirm the restore
independently:

```bash
git status --short forges/pesc260805/parserDescriptor.ini   # empty output = byte-identical to committed
```

**Observed: empty.** I checked it that way as well as trusting the probe's own comparison.

---

## Container hygiene

A build mints `DEV_gb_forge_<pid>_<seq>` (destroyed automatically) and
`DEV_gb_materialize_<pid>_<seq>` (kept — it is the product). Accumulated scratch containers cause
real failures: Phase 7's first stage-ON build died with `neo4j at bolt://localhost:7827 never
authenticated within 90s` under contention from six of them.

```bash
docker ps -a --format '{{.Names}}' | /usr/bin/grep -a '^DEV_gb_'
docker rm -f <your own container name>
```

**Remove only containers you created.** `DEV_pesc260805`, `GOLD_260718`, `neoBrainV2`,
`neoBrain_Milo`, `rag_CareerStoryGraph` and anything `usr_*` are not scratch.

---

## The other documents, and when you need them

| read this | when |
|---|---|
| **README_KnownIssues.md** | **before you quote any number from this file to anyone.** It is the honest ledger of what is not done |
| **README_ValidationCertificate.md** | when you need to decide how far to trust this graph, with the run and the limits in one place |
| **README_identityRules.md** | before touching ids. One decision here is the whole reason this bundle exists |
| **README_roundTripContract.md** | before changing what "faithful" means, or before believing a fidelity number |
| **README_NotesToMilo.md** | before you start work. It is the judgment that reading the code will not give you |

The campaign record is `system/management/zNotesPlansDocs/DEVLOG-pescForgeRebuild-080526.md`.
**It lives OUTSIDE this git repository** — `system/management` is not versioned.
