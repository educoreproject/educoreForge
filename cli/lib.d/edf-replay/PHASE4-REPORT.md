# Phase 4 — `edf-replay` (replayManager) CLI — Build Report

**Status:** GREEN — 34/34 gate assertions pass; no stray docker.
**Branch:** `forger-firstApp`. Nothing committed (per hard rules — no git add/commit/checkout).

## Files

All under `cli/lib.d/edf-replay/` (a new CLI package; its own `package.json`, main `edfReplay.js` → command `edfReplay`, matching the `edfForge` precedent):

- `package.json` — package name `edf-replay`, main `edfReplay.js`.
- `edfReplay.js` — Layer-1 orchestrator. Bootstraps the `process.global` triad (xLog/getConfig/commandLineParameters), opens forge-store + builds credential-accessor + 1B instance-lifecycle once, registry-dispatches the two actions, emits the schemaBlock to stdout (default) or `--out`, runs the guarded success-path `--tearDown`. `-help` reproduces the helpSpec control surface.
- `lib/graph-builder.js` — Layer-2 `-buildGraph` engine: forge-store manifest→blocks read path → instance provision (1B) → Phase-2 engine replay → ownerStamp.
- `lib/schema-extractor.js` — Layer-2 `-extractSchema` engine: selector-dispatched (registry, not switch) serialization of exactly one PG-JSONL block via the Phase-2 engine's `extractBlock` (+ an N-source cross-edge gather for the >2-source `relationships` case).
- `test/test-replay-manager.js` — the fast synthetic Phase-4 gate.

No core `package.json` or any committed Phase-1/2/3 or manifest-editor module was edited. The CLI **requires** forge-store, credential-accessor, instance-lifecycle, replay-engine, replay-block.

## How `-buildGraph` reads via forge-store + replays

`graph-builder.resolveOrderedBlockTexts({manifestKey})` is the confirmed **forge-store** manifest→blocks READ path (no raw SQL in the CLI; never shells out to manifestEditor, which stays the writer):

1. `forgeStore.getManifest({manifestKey})` → member list.
2. For each member, `forgeStore.getBlock` to load `{type, subject, requires, position}` meta.
3. `forgeStore.deriveBuildOrder(memberBlocks)` → CEDS-first topological order (explicit `position` honored; cycle → error).
4. `forgeStore.getBlock` again per ordered member to pull the block `text` (BLOB→utf8), preserving order → the ordered PG-JSONL `blockTexts[]`.

Then:
5. `lifecycle.resolveAccessByName` (resolve-or-create) — provisions + registers the destination instance via 1B; `type` derives from the **role** token (bronze→`bronze`, golden→`golden`, else `user`).
6. `replayEngine.replay({manifest: blockTexts, boltUri, password, graphName})` — the Phase-2 engine (index-first, MERGE on stableId, two-endpoint orphan collection, vector index last). Returns `{nodesMerged, edgesMerged, danglingRefs, indexesBuilt}` — the danglingRefs report is surfaced in the CLI output.
7. **ownerStamp** (`stampOwner`): post-replay cypher pass. Owner token → node **label** (`MATCH (n:ForgedNode) SET n:\`golden\``) and edge **`owner` property** (relationships can't carry labels). Idempotent.

`--owner` defaults from the role (golden→`:golden`, otherwise `:user`); override allowed. **Never tears down on error** — a failed replay leaves the instance in place (DECISIONS §14).

Atomic golden promote (DECISIONS §17) is exactly `buildGraph(manifestKey, destination=golden, role=golden)`; the integrity invariant **golden ≡ replay(goldenManifest)** is what the gate's rebuild comparison verifies.

## The `-extractSchema` selectors

`schema-extractor.extractSchema({access, from, selector, subject})` dispatches via a selector registry, each serializing **exactly one** PG-JSONL block via the engine's `extractBlock`:

- **`standard`** (`--subject` required): engine selector `{source: subject}`, header `blockType:'standard'`, `standardKey:subject` → that standard's nodes + intra-source edges.
- **`relationships`**: cross-standard bridge edges ONLY, **0 nodes**. Discovers distinct `_source` values: exactly two → the engine's bridge path (`{pairA,pairB}`, header `blockType:'bridge'`); more than two → an all-cross-source-edge gather serialized as one bridge block. (This is what keeps the consolidated relationships block from duplicating standard content — helpSpec INVARIANTS.)
- **`overlay`** (`--subject` = overlay owner): single-source extraction, header `blockType:'overlay'` (the first-app form; richer inherited-node-edit deltas are downstream per helpSpec NOTES).

Output: stdout by default, `--out=<path>` optional. `--tearDown` runs only on the success path, guarded by 1B `destroyInstanceByName` (refuses golden/non-ephemeral unless `--force`). No credentials on the command line — access resolved BY NAME.

## Test commands + full output

```
cd cli/lib.d/edf-replay
node test/test-replay-manager.js
```

Fast + synthetic: two tiny standards (CEDS-like hub + CIP-like) + one bridge block, all carrying `:ForgedNode` + `stableId(=uri)` + `provenanceTier`. Embeddings omitted (small `embeddingDims:8`, no node embedding → trivial empty vector-index build on neo4j:5.26). Setup uses real `forgeStore.saveBlock`/`saveManifest`; builds drive the real `graph-builder`/`schema-extractor`; instances via real 1B.

**RESULT: GREEN (34 passed, 0 failed).** Every gate:

- **GATE 1 (standard extract + round-trip):** standard block = 3 CEDS nodes + 2 internal edges; deserializes cleanly; persisted via `forgeStore.saveBlock` → blockId; `getBlock` text byte-identical. PASS.
- **GATE 2 (relationships = bridge edges only):** block has **0 nodes**, only the 1 cross-standard edge; deserializes with 0 nodes; every edge cross-source. PASS.
- **GATE 3 (golden ≡ replay(goldenManifest)):** bronze build then golden build then a second golden rebuild from the SAME manifest → node count (5==5), edge count (4==4), and the full `stableId` set identical (spot ref `ceds://class/student` present). PASS.
- **GATE 4 (--owner stamping):** golden build → all 5 nodes carry `:golden`, none carry `:user`; user build → all 5 carry `:user`, none `:golden`, all 4 edges carry `owner=':user'`. PASS.
- **GATE 5 (teardown guard):** `--tearDown` refuses golden (non-ephemeral) without `--force` and golden stays queryable; succeeds on bronze (ephemeral) without `--force`; a malformed-block build FAILS at replay (provenanceTier enforcement) and the instance is LEFT IN PLACE (never torn down on the error path). PASS.

All test containers/volumes force-torn-down at the END (even on failure path) via `finish()`; verified post-run: zero `__TEST_replay*` containers or volumes; only the three pre-existing unrelated `gf_*` containers remain.

## Deviations + rationale

1. **ownerStamp is a post-replay cypher pass (node label + edge property).** The Phase-2 engine explicitly writes data only and defers the ownerStamp to replayManager (`replay-engine.js` line ~96: "graphName-aware ownerStamp is the replayManager's concern"). Neo4j relationships cannot carry labels, so the owner token becomes a node **label** and an edge **`owner` property**. Idempotent (`SET`), so re-runs are safe and deterministic. The owner token is validated as an identifier before use in the (non-parameterizable) label position.

2. **`buildGraph` accepts an optional `role` distinct from `destination`.** helpSpec's `--destination=<bronze|golden|user>` is a ROLE token that also names the graph for the first app. To support distinct tenant graph names (and to let the test use collision-safe unique names while still exercising true type/owner derivation), `role` drives instance-type + default-owner and **defaults to `destination`**. The CLI passes `role: destination` — identical behavior to a pure-token surface for the first app, with headroom for named tenant graphs. No spec contradiction.

3. **`relationships` selector is graph-wide, not pair-named on the command line.** helpSpec's `--selector=relationships` takes no pair args but means "cross-standard bridge edges". The extractor discovers the sources present and uses the engine's two-source bridge path when exactly two exist (the first-app bronze cohort), with an all-cross-source gather for N>2. Still exactly one block, 0 nodes.

## No stray docker

Confirmed: `docker ps -a` / `docker volume ls` show **no** `__TEST_replay*` artifacts after the run. The only `gf_*` containers present (`gf_MDOEConnect`, `gf_EdMatrix`, `gf_graphdoc_educore`) pre-date this work and are unrelated.
