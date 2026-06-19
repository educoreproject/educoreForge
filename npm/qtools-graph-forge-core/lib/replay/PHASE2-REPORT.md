# Phase 2 — PG-JSONL Replay Engine — BUILD REPORT

**Session:** SILENT_STONE programmer sub-agent · **Branch:** `forger-firstApp` · **Verdict: GREEN (32/32)**

The single block⇄graph boundary of educoreForge: serialize a graph subset to a durable
PG-JSONL block, and rebuild any graph by replaying an ordered manifest of blocks.

---

## Files created

- `lib/replay/replay-block.js` — pure synchronous codec + (de)serializer.
  `serializeBlock({header,nodes,edges})→blockText`, `deserializeBlock(blockText)→{header,nodes,edges}`.
  Base64↔float32-LE embedding codec (`Buffer.writeFloatLE`/`readFloatLE`, asserts
  `byteLength === embeddingDims*4`). Embedding is a single base64 scalar string, never a value-array.
  Deterministic output (sorted property keys, sorted labels, single trailing newline). Edge-type
  validation `/^[A-Za-z_][A-Za-z0-9_]*$/`; provenanceTier validation against the four-value set.
- `lib/replay/replay-engine.js` — `extractBlock({boltUri,password,selector,header},cb)` and
  `replay({manifest,boltUri,password,graphName?},cb)`. Connects to bolt directly via neo4j-driver
  (dependency-light; the CLI resolves access and passes boltUri+password).
- `lib/replay/test/test.js` — runnable test gate (see below).

## What was adapted from the prototype vs. changed for greenfield

Harvest source: `educoreForge-worktrees/trackB-replayEngine/.../lib/replayBlock.js` + `replayEngine.js`
(validated prototype). **Kept (adapted):** the PG-JSONL structure, the base64-LE embedding codec,
deterministic serialization, the batched-UNWIND/label-grouped node MERGE, the by-type edge MERGE with
the two-endpoint orphan `RETURN` pattern, the three-phase index ordering, and the taskListPlus/pipeRunner
async shape (each neo4j call resolves at the leaf with `.then().catch(err=>next(err))`; no async/await,
no try/catch-for-control-flow, camelCase only).

**THE GREENFIELD RESOLUTION SWITCH — `(_source,_id)` → `stableId` (the core correctness change):**
- Node MERGE key changed from `MERGE (n {_source,_id})` to **`MERGE (n {stableId: row.stableId})`**.
- Edge endpoints resolved by `OPTIONAL MATCH (from {stableId: e.fromStableId})` / `(to {stableId})`,
  globally (no `_source` scoping), so cross-source bridge edges resolve.
- The resolution-key index changed from composite `ON (n._source,n._id)` to **`ON (n.stableId)`**.
- Edge `fromRef`/`toRef` **externalize the stableId value** (carried in `ref.id`); `extractBlock`
  reads each node's stableId from the standard's own property (header `stableUriPropertyName`, e.g.
  `uri`), falling back to the engine-stored `stableId` so a re-extract of an already-replayed graph
  round-trips byte-identically. `_source`/`_id` are retained as ordinary stored properties (provenance),
  NOT the merge key.
- `serializerVersion:"1"` is stamped and read; **no version-dispatch logic** (§20).

**Added for greenfield (new):**
- **provenanceTier ENFORCEMENT (§21):** a pre-write scan (`findProvenanceViolations`) rejects the whole
  run with a descriptive ERROR if any edge lacks a valid `provenanceTier` ∈
  {spec-authoritative, embedding-inferred, structural, user-asserted}. This is a distinct
  malformed-edge case — surfaced as an audit-style error, NOT a dangling/partial case — and runs
  BEFORE phase 1, so nothing (no node, no edge) is written when a block is malformed.
- **Vector-index name** is `<graphName>_vector` (schemas §4) instead of the prototype's constant.

## Test gate

Provisions disposable Neo4j graphs by REUSING the Phase-1 `instance-lifecycle` wired to the REAL
`forge-store` + `credential-accessor` (so this also integration-tests Phase 2 ↔ 1B). Synthetic
greenfield fixtures: nodes with `stableId`, Dme* labels, a `uri` standard property, and a base64
1024-dim embedding; edges with `provenanceTier`. All five test graphs are torn down (force) even on
failure via `cleanupAndExit` (verified: no stray container/volume after GREEN or RED runs).

**Run command:** `node lib/replay/test/test.js`  (from the package root)

**Full output:** `RESULT: GREEN  (32 passed, 0 failed)`. The five gating assertions:
1. **Round-trip fidelity** — seed 5 nodes/4 edges → extractBlock CEDS (3 nodes/2 edges, stableIdCoverage
   unique) → replay into a FRESH graph → 3 nodes / 2 edges, 0 dangling; spot-ref `ceds://prop/firstName`
   has `name=FirstName`, `depth=2`, stableId preserved, labels `DmeProperty`+`ForgedNode`. **PASS**
2. **Idempotent replay** — replay the same 3-block manifest twice → identical reported counts, graph
   still 5 nodes / 4 edges (MERGE, not CREATE). **PASS**
3. **Two-endpoint orphan report** — replay `[CEDS, bridge]` with the CIP standard ABSENT → exactly 1
   danglingRef (`MAPS_TO`, `missingEndpoint:'from'`, fromRef.id `cip://class/program`), the 2 CEDS edges
   merge but the bridge edge does NOT, and an edge count of 2 proves NO partial edge was written. **PASS**
4. **Incremental add** — the source graph already carries CIP + bridge; re-extracting CEDS yields a
   **byte-identical** block (SHA-256 equal to the GATE-1 extraction); the new (bridge) block differs.
   **PASS**
5. **provenanceTier enforcement** — replaying a block whose edge lacks `provenanceTier` makes the engine
   ERROR (message names `provenanceTier`), returns no result, and leaves 0 edges in the graph (not
   silently written, not merely dangling). **PASS**

## Deviations + rationale

- **Vector index — capability-gated, not unconditional (the one deviation).** SPEC §4.5 / schemas §4
  mandate the production GA Cypher `CREATE VECTOR INDEX … OPTIONS {vector.dimensions:1024,
  vector.similarity_function:'cosine'}`, built LAST. **CODE FACT (probed live):** the Phase-1
  `instance-lifecycle` pins `neo4j:5.5.0 community`, which has **no vector-index support in any
  syntax** — neither the GA Cypher (introduced ~5.13) nor the older `db.index.vector.createNodeIndex`
  procedure (verified absent on 5.5). Since I must not modify the forbidden Phase-1 module (which owns
  the image pin), Phase 3 now probes `dbms.components()` for the kernel version: on a server ≥ 5.13 it
  emits the production index per spec; on an older server it records `<graphName>_vector:skipped(...)`
  in `indexesBuilt` rather than erroring. Replay correctness (idempotent MERGE, global resolution,
  orphan reporting, the resolution-key index, all data) is unaffected; the production golden runs a
  modern Neo4j where the index is built exactly per spec. The validated prototype passed its
  vector-index experiment because it ran against an external newer Neo4j (`bolt://localhost:7706`), not
  the 5.5 instance-lifecycle substrate. **This is the correct production behavior plus a substrate
  guard, not a weakening of the spec.**
- `extractBlock` reads stableId from the standard property (`stableUriPropertyName`) first, then the
  stored `stableId` — an additive robustness so re-extraction of an already-replayed graph is
  byte-stable. The contract is unchanged.

## Stray docker resources

Confirmed CLEAN after the final GREEN run and after the intermediate RED runs:
`docker ps -a --filter name=gf___TEST` and the matching volume filter both return empty; the version-probe
container (`verProbe`) used to diagnose the 5.5 vector gap was removed. Nothing left stray.
