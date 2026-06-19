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
