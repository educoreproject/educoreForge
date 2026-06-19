# Phase 6 — edf-forge-manager (forgeManager) — REPORT

**Status: GREEN — built, tested, 19/19 gate assertions pass.** The prior STOP (the materializer
hardcoding `ref.source='CEDS'`) is FIXED upstream (`materializer.js:78` now
`ref: { source: oneNode.properties._source, ... }`, commit e3d0d64), which unblocked the entire
golden flow. This phase built the orchestrator on top of that fix.

---

## Files created

```
cli/lib.d/edf-forge-manager/
  edfForgeManager.js        # Layer-1 entry: bootstrap process.global, paths, registry dispatch
  package.json              # pkg edf-forge-manager, main edfForgeManager.js
  lib/sub-cli.js            # the ONLY shell-out point: runComponent / runComponentJson
  lib/store-access.js       # forge-store + instance-lifecycle view (publish/reset/rollback/list)
  tools.d/add-standard.js   # the -addStandard golden flow (Layer-3 handler)
  tools.d/rollback.js       # the -rollback workflow
  tools.d/list.js           # the -list inspector (blocks|manifests|graphs [--stale])
  test/test-forge-manager.js# FAST synthetic end-to-end gate (real Docker neo4j, tiny graphs)

cli/lib.d/forge-p6hub/       # SYNTHETIC hub bundle (test only)
  forgeP6hub.js  package.json  assets/source.json
cli/lib.d/forge-p6second/    # SYNTHETIC second bundle (test only)
  forgeP6second.js  package.json  assets/source.json
```

Edited (permitted extension): `cli/lib.d/edf-forge/lib/standard-registry.js` — two TEST-GATE rows
(`p6hub` -> standardName 'ceds'; `p6second` -> standardName 'synthstd'). No other committed module
was touched. Core `package.json` untouched. No git add/commit/checkout.

## Architecture (3-layer, THIN by mandate)

Layer-1 `edfForgeManager.js` bootstraps `process.global`, resolves the canonical store path + the
ABSOLUTE entry paths to each component CLI, instantiates the two shared resources, and registry-
dispatches the action (registry, NOT switch). Layer-2 (`lib/`) holds the shell-out helper and the
forge-store view. Layer-3 (`tools.d/`) holds one handler per action. No domain logic, no neo4j/SQL
of its own beyond store bookkeeping the component CLIs do not own (publish/rollback-pointer/list/
fresh-reset). qtools-async throughout (taskListPlus/pipeRunner, leaves resolve at the leaf, no
async/await, no try/catch-for-control-flow); moduleFunction DI; camelCase.

## Sub-CLI invocations + stdout parsing (confirmed from source this phase)

All shell-outs are `node <ABS entry>.js <args>` via `child_process.execFile`. Parsing matches the
prior report's analysis:

- **forger** `edfForge.js -forge --standardName=<arg> --destination=<validationGraph> --owner=:golden
  [--source=<path>]`: ONE JSON object on stdout (`nodeCount,edgeCount,location,...`). `runComponentJson`.
- **replay -extractSchema** `edfReplay.js -extractSchema --from=<g> --selector=standard|relationships
  --subject=<std> --out=<file> --tearDown`: with `--out`, the BLOCK goes to the file and **stdout is
  empty** (the summary JSON is on stderr via `xLog.status`). So forgeManager ALWAYS passes `--out`,
  uses `runComponent` (no stdout parse), and reads the block file's existence. Confirmed: `edfReplay.js`
  emits the extract summary via `xLog.status` (=stderr), not stdout.
- **replay -buildGraph** `edfReplay.js -buildGraph --manifest=<key> --destination=<g> --owner=:golden`:
  ONE JSON object on stdout (`location,nodesMerged,edgesMerged,...`). `runComponentJson`.
- **bridgeMaker** `edfBridge.js -specified|-derived|-implied --graph=<g> --scope=<std> --owner=:golden`:
  ONE JSON object on stdout (`edgesMerged,orphanCount,...`). `runComponentJson`.
- **manifestEditor** `manifestEditor.js -save --block=<file>` / `-combine [--base=] --set=a,b`:
  ONE JSON object on stdout (`{blockId}` / `{manifestKey}`). `runComponentJson`.

## The --db store-path handling (the established-one-store invariant)

CODE FACT (read this phase): **forger, replayManager and bridgeMaker HARDCODE**
`<projectRoot>/dataStores/forgeStore.sqlite3` and accept **no** `--db` flag. **manifestEditor** is the
only sibling that accepts `--db` (and otherwise defaults to a *different* path,
`<repoRoot>/dataStore/forgeStore.sqlite`). Therefore the canonical store IS the hardcoded sibling
path, and forgeManager passes `--db=<projectRoot>/dataStores/forgeStore.sqlite3` to **every**
manifestEditor shell-out (and to nothing else — the others already use it). All five CLIs thus read/
write ONE store. No STOP was needed: every CLI either already uses the canonical path or is directed
to it. store-access opens that SAME path with the forge-store library for publish/rollback/list.

## INVARIANT: --subject/--scope === registry standardName === _source

`-addStandard --standardName=<arg>` resolves the registry row to get the canonical `standardName`
(the value the forge emits as `_source`) and passes THAT verbatim (no case transform) as `--subject`
(extractSchema) and `--scope` (bridgeMaker), so they match the stored `_source`. Verified end-to-end:
hub `_source='ceds'`, second `_source='synthstd'`; `extractStandard` uses `selector:{source:subject}`
matched case-sensitively by the engine, and `specified-bridge` hardcodes the hub side to
`_source='ceds'` — both satisfied.

## Synthetic bundles + registry rows

- `forge-p6hub` (registry standardName 'ceds'): root + 3 DmeClass nodes, each `_source='ceds'` with a
  canonical `cedsId` (C100001-3); tiny deterministic 1024-dim embeddings generated in-bundle (NO
  Voyage call, key-free); internal HAS_CLASS edges tier 'structural'. `_source='ceds'` matches
  specified-bridge's hardcoded hub side.
- `forge-p6second` (registry standardName 'synthstd'): root + 3 DmeClass nodes, `_source='synthstd'`,
  each carrying a `cedsId` crossRef into the hub (two resolvable: C100001/C100002; one orphan
  C999999). With the materializer fix each keeps its own `_source`, so `-specified --scope=synthstd`
  forms real synthstd->ceds SPECIFIED_MAPPING edges.

## A genuine system property surfaced + handled (NOT a hack)

The replay engine MERGEs on `stableId` and **never deletes**, building its resolution-key index "on
the EMPTY store" (engine comment). So `graph ≡ replay(manifest)` holds only against a **fresh**
instance. The first golden build is fresh, but a second `-buildGraph --destination=golden` (the
promote) and a `-rollback` rebuild target a **live** golden and would leave stale nodes (a rollback
to a smaller manifest would NOT shrink the graph). forgeManager therefore **resets** golden to a
fresh instance (`instance-lifecycle.destroyInstanceByName force=true`, via store-access) immediately
before both the addStandard promote and the rollback rebuild. This is lifecycle bookkeeping the
component CLIs do not own — consistent with "repoint + rebuild" and the THIN mandate; it is what
makes the golden ≡ replay(goldenManifest) invariant actually hold across the production lifecycle.

Also note: `-buildGraph` derives instance TYPE from role===destination===graph NAME, and the
teardown guard only frees ephemeral/bronze types. So the bronze working graph MUST be named exactly
`bronze` (golden exactly `golden`) for `-extractSchema --tearDown` to reclaim it. The validation
graph is materialized type='ephemeral', so it carries a per-run tag and is freely torn down.

## Test output (FAST synthetic; real Docker neo4j:5.26, tiny graphs)

`node cli/lib.d/edf-forge-manager/test/test-forge-manager.js` -> **RESULT: 19 passed, 0 failed.**

- GATE 1 `-addStandard p6hub` then `-addStandard p6second`: published golden contains BOTH standards'
  nodes AND **2** SPECIFIED_MAPPING bridges (>=1). golden manifestKey advanced. PASS.
- GATE 2 **golden ≡ replay(goldenManifest)**: rebuilt the golden manifest into a fresh `goldenCheck`
  graph; node set AND edge set byte-identical to live golden. PASS.
- GATE 3 `-rollback golden --to=<pre-second manifest>`: reset+rebuilt+repointed; resulting golden's
  node set, edge set identical to hub-only golden, and 0 SPECIFIED_MAPPING (second standard gone). PASS.
- GATE 4 `-list blocks|manifests|graphs` reflects reality (4 blocks, 4 manifests, golden present);
  `-list graphs --stale` flags the drift case (golden currentManifest behind the store's newest
  manifest after the rollback). PASS.

## Deviations / notes

- `-pin` (helpSpec SYNOPSIS) is OUT OF SCOPE for this phase per the build mandate (only -addStandard,
  -rollback, -list were required) and is not implemented.
- Graph `--stale` is interpreted as "currentManifest is not the store's newest (latest) manifest".
  The pointer-log is append-only + monotonic, so "current behind its own newest pointer-log entry" is
  structurally unreachable; "behind the latest manifest in the store" is the reachable, meaningful
  reading of the helpSpec clause.
- The test treats the canonical `forgeStore.sqlite3` as scaffolding and removes it at teardown so
  reruns are clean; it lives at the real sibling path during the run (the only path the hardcoded
  CLIs accept).

## Docker cleanliness — confirmed

The test force-tears-down ONLY its own containers/volumes (named `bronze`, `golden`, `goldenCheck`,
`rollbackCheck` and `gf_p6val_*`), at END even on failure, and at START. Post-run inventory: the
three pre-existing OTHER-PROJECT containers (`gf_MDOEConnect`, `gf_EdMatrix`, `gf_graphdoc_educore`)
remain untouched; ZERO of this test's artifacts remain; no leftover `gf_` volumes.
