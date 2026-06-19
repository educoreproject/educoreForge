# Phase 1A Report — forge-store + content-address + credential-accessor

- **Builder:** programmer sub-agent (orchestrator: SILENT_STONE)
- **Branch:** `forger-firstApp` (no git operations performed)
- **Verdict:** GREEN — 35/35 assertions pass.

## Files created

```
npm/qtools-graph-forge-core/lib/
  content-address/content-address.js
  credential-accessor/credential-accessor.js
  forge-store/forge-store.js
  forge-store/test/test.js
  forge-store/PHASE1A-REPORT.md   (this file)
```

No other directories touched. `package.json` not modified; no `npm install` run.

## How to run the tests

From `system/code/`:

```bash
node npm/qtools-graph-forge-core/lib/forge-store/test/test.js
```

The test creates a temp sqlite db under the OS temp dir
(`$TMPDIR/__TEST_forgeStore_<pid>_<ts>.sqlite` plus `-wal`/`-shm`), runs the full
gate, and deletes all three files on exit (verified: no stray files remain). Exit
code 0 on all-pass, 1 otherwise. Named rows use `__TEST_` prefixes.

## Full test output (final run)

```
  PASS  blockId: identical bytes => identical blockId
  PASS  blockId: any change => different blockId
  PASS  blockId: is 64-hex sha256
  PASS  manifestKey: identical membership => identical key (order-independent)
  PASS  manifestKey: position change => different key
  PASS  init: creates db + 5 tables without error
  PASS  saveBlock: returns blockId
  PASS  saveBlock: identical bytes dedup to same blockId
  PASS  getBlock: round-trips type/subject/text
  PASS  getBlock: requires parsed back to array
  PASS  orphan: unreferenced block is collectible (tolerated until referenced)
  PASS  saveManifest: returns manifestKey
  PASS  saveManifest: identical membership dedups to same manifestKey
  PASS  getManifest: round-trips label + members
  PASS  GC: block referenced by a retained manifest is NOT collectible
  PASS  upsertGraph: inserts a graph row
  PASS  getGraphByName: round-trips name/location/type
  PASS  credential: generate returns reference + value
  PASS  credential: storeForGraph persists onto the graph row
  PASS  credential: resolveForGraph returns stored reference + value
  PASS  credential: stored in graphs.credentialReference + credentialValue
  PASS  setCurrentManifest: advances pointer + logs
  PASS  setCurrentManifest: graphs.currentManifest now set
  PASS  saveManifest: a different membership yields a NEW manifestKey
  PASS  rollbackPointer: repoints without error
  PASS  rollbackPointer: currentManifest is the prior manifestKey
  PASS  rollbackPointer: prior manifest row is NEVER deleted
  PASS  rollbackPointer: original manifest still present
  PASS  closure: well-formed manifest (required subject present + earlier) => wellFormed
  PASS  closure: rel block ordered before its required subject => NOT wellFormed
  PASS  closure: required subject absent from manifest => NOT wellFormed
  PASS  listGraphs: returns the graph row
  PASS  dropGraph: removes the registry row without error
  PASS  dropGraph: graph row is gone
  PASS  dropGraph: manifests retained (retain-all)

RESULT: 35 passed, 0 failed
```

## Gating assertions (contract §1A test gate) — all covered

| Gate requirement | Assertion(s) |
|---|---|
| content-addressing determinism (block) | identical bytes => identical blockId; any change => different; 64-hex sha256 |
| content-addressing determinism (manifestKey) | identical membership (order-independent) => identical key; position change => different key |
| insert/lookup round-trip every table | saveBlock/getBlock; saveManifest/getManifest (incl. manifestBlocks members); upsertGraph/getGraphByName; setCurrentManifest writes manifestPointerLog; credential columns on graphs |
| orphan block tolerated until referenced | unreferenced block IS collectible; once in a manifest it is NOT |
| retain-all GC | collectible iff no retained manifest references it (both directions asserted) |
| rollback repoints + appends log + never destroys prior | currentManifest set to prior key; prior + original manifest rows still present after rollback; dropGraph retains manifests |
| bridge-closure validation | well-formed (present + ordered earlier) => wellFormed; rel-before-subject => order violation; required subject absent => missing violation |

## Implementation notes

- **Built ON sqlite-instance.** `forge-store` requires
  `../../../../server/data-model/lib/sqlite-instance/sqlite-instance` (verified to
  resolve). It uses `initDatabaseInstance` to open a managed better-sqlite3 db, then
  acquires one table handle and issues fully-formed SQL through that handle's
  callback-style `runStatement`/`getData` with `{noTableNameOk:true,
  suppressStatementLog:true}`. better-sqlite3 is never required directly.
- **qtools paradigm honored:** all async work is callback-style wrapped in
  `taskListPlus` + `pipeRunner` (constructed via
  `new require('qtools-asynchronous-pipe-plus')()`, matching the verified local
  pattern). No async/await, no Promises, no try/catch-for-control-flow,
  no EventEmitter. camelCase throughout. Curried moduleFunction DI signature
  `({moduleName}={}) => (deps={}) => ({...api})`.
- **credential-accessor** receives `forgeStore` by injection and is the single path
  for credential generate/store/resolve; storage delegates to the `graphs` row
  (`credentialReference` + `credentialValue`). The resolved value is never logged.
- **The five tables match schemas.md §1 exactly**, plus the DECISIONS §5
  reconciliation: `graphs.credentialReference TEXT` and `graphs.credentialValue TEXT`.
- **Dedup:** blocks dedup on `blockId` (skip insert when present); manifests dedup on
  identical membership (skip insert when `manifestKey` present). Both use the
  pipe's `'skipRestOfPipe'` short-circuit, normalized to a non-error result.
- **Build order** for closure validation: explicit `position` first (ascending), then
  a topological sort over each block's `requires` (a block sorts after blocks whose
  `subject` it requires). Cycles are detected and reported as a `cycle` violation.

## Deviation from the contract (one, with rationale)

- **`manifestPointerLog.fromTime` is supplied explicitly (ms-resolution, monotonic)
  rather than relying on the column's `CURRENT_TIMESTAMP` default.** The schema PK is
  `(graphId, fromTime)` and SQLite's `CURRENT_TIMESTAMP` has only 1-second resolution,
  so two pointer moves on the same graph within the same second collide on the PK
  (this surfaced as a real test failure: `UNIQUE constraint failed:
  manifestPointerLog.graphId, manifestPointerLog.fromTime`). The table DEFINITION is
  unchanged (default still present); the store just writes a distinct `fromTime` per
  move via a per-process monotonic clock. This preserves the append-only,
  never-delete pointer-log semantics the contract requires. **Flag for the
  orchestrator:** this guard is per-process; if multiple processes advance the same
  graph's pointer within the same millisecond, a collision is still theoretically
  possible — a future hardening could append a sub-ms counter or a uniquifier column,
  but that would change the schema and was out of scope for 1A.

## Not done (out of scope, by instruction)

- No git add/commit/checkout. No `package.json` edits / `npm install`.
- Sibling modules (instance-lifecycle 1B, search-text/embedding 1C) untouched.
