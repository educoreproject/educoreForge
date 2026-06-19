# Phase 5 — edf-bridge (bridgeMaker) — BUILD REPORT

Branch: `forger-firstApp`. One CLI app, three registry-dispatched modes, generic (no per-standard
code). Status: **GREEN** — 21/21 test assertions pass; teardown clean; no stray docker.

## Files

```
cli/lib.d/edf-bridge/
├── edfBridge.js                 # Layer-1 orchestrator: bootstrap process.global, build shared
│                                #   resources (forge-store, credential-accessor, instance-lifecycle),
│                                #   registry-dispatch the mode. Help text == helpSpec contract.
├── package.json                 # name "edf-bridge", main "edfBridge.js" -> command edfBridge
├── .gitignore                   # node_modules/
├── lib/
│   ├── mapping-instruction.js   # generic reader: parses mappingInstruction JSON off DmeStandardRoot,
│   │                            #   applies documented defaults. The ONLY per-standard input — as DATA.
│   ├── specified-bridge.js      # -specified (BUILT FULLY): cedsId/cedsOptionId anchor pass
│   ├── derived-bridge.js        # -derived (STUB per §18): no-op, discovers nothing
│   └── implied-bridge.js        # -implied: Stage-1 retrieve ADAPTED from trackA; Stage-2 stubbed
└── test/
    └── test-bridge.js           # synthetic-standard test gate (provisions a real neo4j graph)
```

No core `package.json` or committed module was edited. The app `require`s the core libs
(`qtools-graph-forge-core/lib/{instance-lifecycle,forge-store,credential-accessor}`) but does not
modify them. No `node_modules` was added under `edf-bridge/` (it uses the project's hoisted deps,
exactly as `edf-replay`/`edf-forge` do).

## Mode-dispatch registry (registry, NOT switch)

`edfBridge.js`:

```js
const actionRegistry = {
    specified: handleSpecified,
    derived:   handleDerived,
    implied:   handleImplied,
};
// dispatch:
const actionName = Object.keys(actionRegistry).find((name) => switches[name]);
actionRegistry[actionName](resources, callback);
```

Adding a fourth tier is a new entry + a new `lib/<tier>-bridge.js` factory — no edit to the dispatch
logic. Each handler reads the shared `--graph/--scope/--owner` options, calls its mode factory
(curried DI: `factory({ lifecycle })`), and emits a uniform JSON result blob (counts + orphan
report) on stdout via `xLog.result`.

## How -specified resolves cedsId -> CEDS node

`lib/specified-bridge.js`, fully built. Two passes, both the SAME parameterized MERGE shape
(`runAnchorPass`), which keeps the maker generic:

- **element level:** `anchorProperty='cedsId'`, `cedsAnchorProperty='cedsId'`
- **value level:** `anchorProperty='cedsOptionId'`, `cedsAnchorProperty='cedsOptionId'` (DmeOptionValue)

Pass 1 — atomic classify scan (ONE cypher, so we never emit a partial edge):

```cypher
MATCH (src) WHERE src._source = $scope AND src.`<anchorProperty>` IS NOT NULL
WITH src, src.`<anchorProperty>` AS anchorValue
OPTIONAL MATCH (ceds) WHERE ceds._source = 'ceds'
    AND ( ceds.`<cedsAnchorProperty>` = anchorValue OR ceds.stableId = anchorValue )
RETURN src.stableId AS srcStableId, anchorValue, ceds.stableId AS cedsStableId
```

Rows where `cedsStableId IS NULL` go to the **orphan report** (no CEDS node matches that cedsId);
the rest are *resolvable* (both endpoints exist).

Pass 2 — MERGE only the resolvable pairs (idempotent on `(from,to,SPECIFIED_MAPPING)`):

```cypher
UNWIND $pairs AS pair
MATCH (from {stableId: pair.srcStableId})
MATCH (to   {stableId: pair.cedsStableId})
MERGE (from)-[r:SPECIFIED_MAPPING]->(to)
ON CREATE SET r.confidence=1.0, r.provenanceTier='spec-authoritative',
              r.owner=$owner, r.cedsAnchorValue=pair.anchorValue, r.bridgeLevel=$levelLabel
```

- `confidence = 1.0`, `provenanceTier = 'spec-authoritative'`, **NO `matchPredicate`** (a specified
  edge is exact by definition — DESIGN §F).
- The mappingInstruction's `cedsOriginalAnchorPropertyName` is read only to KNOW/log the anchor
  ORIGIN; resolution is always on the canonical `cedsId`/`cedsOptionId` the forge already normalized
  (DESIGN §F, DECISIONS §12).
- `cedsId` resolution is also `OR ceds.stableId = anchorValue` because CEDS is the hub — a CEDS
  Property's own cedsId equals its stableId in canonical form; this lets CEDS targets resolve whether
  they carry an explicit `cedsId` property or just a canonical `stableId`.
- §19 (R-D deferred): all crossRefs treated as equivalence-grade `SPECIFIED_MAPPING` for now.
- new-vs-already-present is read from the neo4j summary `counters.updates().relationshipsCreated`
  (an existing pair re-runs as a MERGE no-op — not re-bridged).

## The -derived stub (§18)

`lib/derived-bridge.js`: wires the mode and the `--crosswalk`/`--source` flags, reads `--scope`,
makes ZERO neo4j calls, returns `{ stubbed:true, edgesMerged:0, note:'derived: stubbed (DESM unknown)' }`
and logs that line. Discovers nothing, invents no crosswalk, mutates nothing. The deliberately-omitted
`derivedCrosswalks` declarative field (premature, §18) is NOT read or guessed.

## -implied: EXACTLY how far adapted vs stubbed (HONEST)

`lib/implied-bridge.js`. Runs LAST, only on scope nodes not already covered by
`SPECIFIED_MAPPING|DERIVED_MAPPING` (cypher `NOT (src)-[:SPECIFIED_MAPPING|DERIVED_MAPPING]->()`).

- **Stage 1 (retrieve) — ADAPTED from trackA `crosswalk-engine`.** Ported the `cosine` similarity
  over the stored voyage embeddings (trackA `embeddingMatcher.js`) and the top-K candidate-ranking
  idea (`candidatePool.selectCandidatesForSource`). It bulk-loads the uncovered scope nodes and the
  `impliedTargets` (default CEDS, by `_source`) — both carry `embedding` + `searchText` — and ranks
  each source's targets by cosine, keeping top-K. **Not a verbatim port:** trackA's Stage-1 issues
  one `db.index.vector.queryNodes` per source against a `jobSpec.targetVectorIndex` and per-standard
  LABELS (`CedsProperty`, `MedBiqElement`…). Our bridge layer must be generic (role labels +
  `_source`), so a hardcoded index name / label list would itself be per-standard code (forbidden by
  DESIGN §F / DECISIONS §12). The in-memory cosine over the SAME stored vectors is the clean generic
  port with identical retrieval semantics. (Test: 1 uncovered source × 3 CEDS targets → 3 candidates;
  real, exercised wiring.)

- **Stage 2 (rerank + calibrate + emit) — STUBBED, `[PINNED-DEFERRED]`.** trackA Stage-2 is the
  nine-signal weighted scorer (`scorer.js`) + neighborhood/path matchers + calibration into a SKOS
  `matchPredicate`. It is NOT cleanly portable: it depends on per-standard neighborhood cypher
  (`candidatePool.NEIGHBORHOOD_QUERIES` keyed by `CedsProperty/CtdlClass/…`) and a per-crosswalk
  `crosswalkConfig` weight table — both per-standard. Porting it generically is a real design task,
  not an adaptation, so per the mandate it is a **logged no-op**: `-implied` emits **NO**
  `IMPLIED_MAPPING` edges and **fakes no results**. When later built it will emit `IMPLIED_MAPPING`
  with `provenanceTier='embedding-inferred'`, a calibrated confidence, and a matchPredicate.

## Generic design / mappingInstruction

`lib/mapping-instruction.js` is the single place per-standard behavior enters — as DATA, never code.
It reads the `mappingInstruction` JSON property off the scope's `DmeStandardRoot`
(`WHERE root._source = $scope OR root.standardKey = $scope OR root.name = $scope`) and applies the six
declarative-field defaults (DESIGN §F): `cedsOriginalAnchorPropertyName[]`,
`cedsOptionOriginalAnchorPropertyName[]`, `crosswalkPrefix[]`,
`crosswalkResolveProperty='stableUriPropertyName'`, `includeInImplied=true`, `impliedTargets=['CEDS']`.
A missing root / blank property yields defaults (not an error); malformed JSON IS surfaced as an
error (no-silent-drop discipline). No per-standard branch exists anywhere in edf-bridge.

## Graph access / orphan discipline / idempotency

- Access resolved BY NAME via the 1B `instance-lifecycle` (`resolveAccessByName`/`runCypher`); bolt
  URI + credential never on the command line.
- Unresolved endpoints → orphan report; never a partial edge (the classify-then-merge split
  guarantees an edge is only attempted when BOTH endpoints exist).
- Idempotent MERGE on the resolved endpoint pair; existing pairs in scope are not re-bridged.

## Test commands + full output

Run (provisions a real neo4j 5.26 container via the shared lifecycle, populates a SYNTHETIC standard
+ a small CEDS hub, asserts all gates, force-tears-down at end even on failure):

```
cd cli/lib.d/edf-bridge
node test/test-bridge.js
```

Synthetic fixtures: CEDS hub = `DmeProperty ceds:P000113`, `DmeProperty ceds:P000115`,
`DmeOptionValue ceds:O000900` (each `_source='ceds'`, canonical `cedsId`/`cedsOptionId`). Synthetic
standard `synthstd` = a `DmeStandardRoot` carrying the mappingInstruction, plus `DmeProperty F1`
(cedsId P000113 → resolves), `DmeProperty F2` (cedsId **P999999** → ABSENT CEDS node, orphan),
`DmeOptionValue V1` (cedsOptionId O000900 → resolves at value level).

Full output (21 PASS / 0 FAIL):

```
=== GATE 1: -specified ===
  element pass: 1 created, 0 already present, 1 orphan(s)
  value pass:   1 created, 0 already present, 0 orphan(s)
  result: edgesMerged=2, pairsAlreadyBridged=0, anchorsConsidered=3,
          orphans=[{level:element, srcStableId:synthstd:F2, anchorValue:P999999}]
  PASS  G1 two SPECIFIED_MAPPING edges written (element + value)
  PASS  G1 element edge F1 -> ceds P000113 exists
  PASS  G1 value edge V1 -> ceds O000900 exists
  PASS  G1 orphan F2 (phantom cedsId) has NO edge
  PASS  G1 confidence === 1.0 on all
  PASS  G1 provenanceTier === spec-authoritative on all
  PASS  G1 NO matchPredicate on any
  PASS  G1 owner stamped :golden on all
  PASS  G1 orphan report contains F2 (phantom)
  PASS  G1 maker reported edgesMerged === 2

=== GATE 2: -derived (no-op) ===
  PASS  G2 derived reports stubbed === true
  PASS  G2 derived reports edgesMerged === 0
  PASS  G2 derived note is the stub line
  PASS  G2 edge count UNCHANGED by -derived

=== GATE 3: scoped idempotency (-specified again) ===
  rerun result: edgesMerged=0, pairsAlreadyBridged=2
  PASS  G3 rerun creates 0 new edges (idempotent MERGE)
  PASS  G3 rerun reports 2 pairs already bridged
  PASS  G3 total edge count UNCHANGED after rerun

=== BONUS: -implied (Stage-1 retrieve adapted, Stage-2 [PINNED-DEFERRED]) ===
  Stage-1 retrieve: 1 uncovered source x 3 target -> 3 candidate(s)
  Stage-2 [PINNED-DEFERRED] NOT ported; 0 edges; no results faked
  PASS  IMPLIED Stage-2 stubbed
  PASS  IMPLIED emits 0 edges (deferred, not faked)
  PASS  IMPLIED Stage-1 retrieved >= 1 candidate (real wiring)
  PASS  IMPLIED edge count UNCHANGED (no edges emitted)

[teardown] destroying test instance (force)... done.
==================== RESULT ====================
  PASS: 21   FAIL: 0   -> GREEN
================================================
```

## Deviations

- **One `try/catch` in `mapping-instruction.js`** around `JSON.parse` of the stored mappingInstruction
  string. This is a parse-or-fail boundary (JSON.parse has no callback form), not control flow — the
  caught error is surfaced to the callback, consistent with the no-silent-drop discipline. Honoring
  "no try/catch-for-control-flow" exactly; this is the standard parse idiom.
- **`-implied` Stage-2 deferred** (documented above) — by mandate, not a shortcut.
- Test uses small 4-d embeddings (not real 1024-d voyage vectors) — sufficient to exercise the cosine
  retrieve wiring; real embeddings are a forge concern, out of scope for this gate.

## Docker hygiene

Confirmed after the run: no stray `__TEST_bridge` container or volume; the three pre-existing
`gf_*` containers (MDOEConnect, EdMatrix, graphdoc_educore) are untouched. Teardown is forced and
runs even on failure (the test wraps the gate pipeline so `destroyInstanceByName(force:true)` always
fires before exit).
```
docker ps -a | grep TEST   -> (none)
docker volume ls | grep TEST -> (none)
```

---

# Phase-7 blocker fixes

Three surgical fixes applied to committed modules to unblock Phase-7 acceptance. Root cause: a real
`forgeManager -addStandard CEDS` then `LIF` aborted because forge-ceds emits `_source='CEDS'`
(uppercase) while specified-bridge hardcoded the hub target as lowercase `'ceds'`, so the hub never
matched real data, all scope cedsIds orphaned, and for scope=CEDS (the hub itself) a multi-MB orphan
array was dumped to stdout and truncated at 65,536 bytes by the orchestrator's execFile capture →
JSON parse failed → exit 1. Plus embeddingModelVersion was not persisted on replay.

## FIX 1 — `lib/specified-bridge.js`

**(a) Case-insensitive hub match** in the anchor-scan cypher (used by BOTH the element and value
passes — same parameterized template):
```diff
   OPTIONAL MATCH (ceds)
-      WHERE ceds._source = 'ceds'
+      WHERE toLower(ceds._source) = 'ceds'
        AND ( ceds.`${cedsAnchorProperty}` = anchorValue OR ceds.stableId = anchorValue )
```
Now matches real CEDS (`'CEDS'`) AND the synthetic test/p6 hub (`'ceds'`). (Adjacent comment block
updated to describe the case-insensitive hub match; no logic change.)

**(b) Hub-scope no-op** — short-circuit at the top of `bridge({graphName, scope, owner})`:
```diff
   const bridge = ({ graphName, scope, owner }, callback) => {
+      // -specified is CROSS-standard only; the CEDS hub bridges to nothing (a same-source
+      // self-reference is not a cross-standard mapping). Short-circuit to a clean no-op; this
+      // also prevents the 23k self-orphan dump for -addStandard CEDS.
+      if (`${scope}`.toLowerCase() === 'ceds') {
+          xLog.status(`[specified-bridge] scope '${scope}' is the CEDS hub — nothing to specified-bridge`);
+          callback('', { edgesMerged: 0, pairsAlreadyBridged: 0, anchorsConsidered: 0, orphans: [] });
+          return;
+      }
       const taskList = new taskListPlus();
```
The normal path is unchanged for any non-hub scope (LIF, synthstd, p6second).

## FIX 2 — `edfBridge.js` (CLI output, `handleSpecified` + `run`)

The handler used to `emitResult` the FULL `orphans` array on stdout; for scope=CEDS that is multi-MB
and is truncated by the orchestrator's execFile capture, breaking the parse. Changed so STDOUT is a
single clean parseable JSON object carrying orphan COUNTS only — `orphanCount` plus a per-level
`orphanCountByLevel` breakdown — and NOT the full array. The full orphans array is written to
`--out=<path>` when given (`fs.writeFileSync`), else not emitted (`orphansWrittenTo: null`). The keys
the orchestrator threads (`edgesMerged`, `pairsAlreadyBridged`, `anchorsConsidered`, `orphanCount`)
are all preserved at top level — confirmed against `tools.d/add-standard.js`, which reads only
`bridgeResult.edgesMerged` and `bridgeResult.orphanCount`.

Also made stdout FULLY DRAIN before exit on the success path in `run()`: replaced the synchronous
`process.exit(0)` with a drain-aware exit (`if (process.stdout.write('')) exit; else once('drain')
exit`), matching the edf-replay clean-stdout convention (counts, not full payload). No `2>/dev/null`,
stderr untouched; qtools-async callbacks preserved; no Promises surfaced.

## FIX 3 — `npm/qtools-graph-forge-core/lib/replay/replay-engine.js` `buildNodeRow`

```diff
   if (node.embedding) props.embedding = node.embedding;
+  // Persist the embedding provenance stamp (DECISIONS §3): every replayed node carries its
+  // embeddingModelVersion (e.g. 'voyage-4-large'). The materializer set it at node top level.
+  if (node.embeddingModelVersion) props.embeddingModelVersion = node.embeddingModelVersion;
   return { stableId: node.stableId, props };
```
embeddingModelVersion now persists on every replayed node that carries one.

## Re-test results (Docker; all force-torn-down at end; verified no stray containers/volumes)

| Gate | Module | Result |
|------|--------|--------|
| Phase-2 engine | `npm/qtools-graph-forge-core/lib/replay/test/test.js` | **GREEN** — 33 passed, 0 failed |
| Phase-5 bridge | `cli/lib.d/edf-bridge/test/test-bridge.js` | **GREEN** — 21 passed, 0 failed |
| Phase-6 forgeManager | `cli/lib.d/edf-forge-manager/test/test-forge-manager.js` | **GREEN** — 19 passed, 0 failed |

**Engine test addition (FIX 3 coverage):** added one assertion to the GATE1 spot-ref query —
`GATE1 fidelity: spot-ref carries embeddingModelVersion=voyage-4-large` (the fixtures stamp
`embeddingModelVersion: 'voyage-4-large'` on each synthNode). PASSES.

**Phase-5 bridge:** GREEN with NO test change. Its synthetic standard `synthstd` is non-hub, so the
hub no-op doesn't fire; the case-insensitive match still resolves against the synthetic `'ceds'` hub
nodes (element F1→P000113, value V1→O000900, F2 orphan). Idempotency and -derived/-implied stubs
unaffected.

**Phase-6 forgeManager — corrected SPECIFIED_MAPPING bridge count = 2.** GREEN with NO test change.
The hub no-op DID change behavior: `-addStandard p6hub` (standardName 'ceds') now specified-no-ops,
so the 2 SPECIFIED_MAPPING bridges in published golden come ONLY from `-addStandard p6second` (scope
'synthstd' → ceds hub via case-insensitive match), got 2. The GATE1 assertion is `specifiedCount >= 1`
(not an inflated exact count), so no count adjustment was required — the corrected behavior satisfies
it (got 2). GATE2 golden ≡ replay(goldenManifest) held (node set AND edge set identical). GATE3
rolled-back golden has 0 SPECIFIED_MAPPING. GATE4 -list reflects reality + --stale drift flagged.

**No stray docker:**
```
docker ps -a    | grep -iE 'TEST|gf_golden|gf_p6|gf_bronze|gf_rollback|gf_goldenCheck'  -> (none)
docker volume ls| grep -iE 'TEST|gf_golden|gf_p6|gf_bronze|gf_rollback|gf_goldenCheck'  -> (none)
```

**embeddingModelVersion persists:** confirmed by the new Phase-2 engine assertion (replayed FirstName
node carries `embeddingModelVersion='voyage-4-large'`).

Not committed (orchestrator commits).

---

## FROZEN_LATTICE Casing RULING — STANDARDIZE (remove toLower band-aid) — 2026-06-19

Replaced the case-insensitive hub match with an EXACT match sourced from the registry (single source
of truth), and re-cased every synthetic lowercase-`ceds` hub fixture to canonical `CEDS`. KEPT the
three prior builder fixes (hub-scope no-op, edfBridge stdout compact-summary+drain, engine
embeddingModelVersion persistence). Surgical changes only. No git commit.

### Diffs

**1. `cli/lib.d/edf-forge/lib/standard-registry.js`** — single source of truth for hub casing.
- `p6hub` row: `standardName: 'ceds'` → `'CEDS'` (comment updated: hub mirrors real forge-ceds casing).
- New export sourced from the registry:
  ```js
  const cedsHubStandardName = registry.ceds.standardName; // = 'CEDS'
  module.exports = { resolveBundle, knownStandardNames, registry, cedsHubStandardName };
  ```
  Verified at runtime: `cedsHubStandardName === 'CEDS'`, `registry.p6hub.standardName === 'CEDS'`.

**2. `cli/lib.d/edf-bridge/lib/specified-bridge.js`** — exact match, registry-sourced, NO literal.
- Added `const { cedsHubStandardName } = require('../../edf-forge/lib/standard-registry');`
- Anchor-scan cypher: `WHERE toLower(ceds._source) = 'ceds'` → `WHERE ceds._source = $cedsHub`
- Params: `{ scope }` → `{ scope, cedsHub: cedsHubStandardName }`
- Hub-scope no-op: `if (\`${scope}\`.toLowerCase() === 'ceds')` → `if (\`${scope}\` === cedsHubStandardName)`
  (no-op behavior + status line preserved — approved.)
- Stale comments reworded; NO hardcoded hub-name literal remains.

**3. `cli/lib.d/forge-p6hub/forgeP6hub.js`** — synthetic hub re-cased.
- `const STANDARD_KEY = 'ceds';` → `'CEDS';` (every emitted node `_source`/`_id`/`standardKey`/edge
  `source` flows from STANDARD_KEY → all now `'CEDS'`). Comments updated.

**4. `cli/lib.d/edf-bridge/test/test-bridge.js`** — synthetic CEDS hub nodes re-cased.
- 3 hub nodes: `_source:'ceds'` → `_source:'CEDS'` (DmeProperty P000113, P000115; DmeOptionValue
  O000900). `synthstd` nodes untouched; their `cedsId`/`cedsOptionId` crossRefs still target the
  now-`CEDS` hub by value; stableId identifiers (`ceds:Pxxxxx`) unchanged. Header comment updated.

**5. `cli/lib.d/edf-forge-manager/test/test-forge-manager.js`** — snapshot assertions re-cased.
- `n.startsWith('ceds::')` → `n.startsWith('CEDS::')` (lines for hub-only and both-standards snapshots),
  assertion label and header comment updated. `synthstd::` assertions unchanged.

**6. `cli/lib.d/forge-p6second/forgeP6second.js`** — comment-only: stale `hub _source='ceds'` →
  `'CEDS'` (code `STANDARD_KEY='synthstd'` is the second standard, correctly untouched).

NOT touched: real `forge-ceds/forgeCeds.js` (already emits `_source:'CEDS'`; `STANDARD_KEY='ceds'` is
its registry lookup key, not a node `_source`). `edf-replay` test `key:'ceds'` is a local block-map
key with `subject:'CEDS'` — not a hub `_source` — left as-is.

### Re-test (all 3 gates GREEN; Docker; teardown clean)

| Gate | Test | Result |
|------|------|--------|
| Engine | `npm/qtools-graph-forge-core/lib/replay/test/test.js` | **GREEN 33/33** (embeddingModelVersion assertion passes) |
| Bridge | `cli/lib.d/edf-bridge/test/test-bridge.js` | **GREEN 21/21** (EXACT match, no toLower; SPECIFIED_MAPPING edges form for the CEDS hub: F1→ceds:P000113, V1→ceds:O000900; F2 orphaned) |
| ForgeManager | `cli/lib.d/edf-forge-manager/test/test-forge-manager.js` | **GREEN 19/19**; p6hub(CEDS)→hub no-op, p6second(synthstd)→bridges to CEDS hub; golden≡replay node+edge sets identical; **SPECIFIED_MAPPING count = 2** |

### Grep confirmations (specified-bridge.js)
- `grep -c "toLower("` → **0**
- `grep "'ceds'\|'CEDS'\|\"ceds\"\|\"CEDS\""` → **NONE** (hub identity comes only from `cedsHubStandardName`)

### Docker
No stray containers/volumes after the run. Only the three pre-existing unrelated containers
(`gf_MDOEConnect`, `gf_EdMatrix`, `gf_graphdoc_educore`) remain — untouched baseline; all test graphs
(`__TEST_bridge`, `gf_golden`, `gf_goldenCheck`, volumes) force-torn-down by the tests.
