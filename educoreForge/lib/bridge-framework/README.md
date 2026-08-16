# lib/bridge-framework — the EDUcore Bridge Framework

ONE shared library that satisfies the EDUcore Bridge Profile (`SPEC-educoreBridgeProfile-v1.0.md`, v1.0.6) for
every mapping bridge plugin, so that each of the Profile's choices — tuple addressing, the multimap, cardinality
classification, the judge and its double, the frozen decision block and its replay, SSSOM export, every refusal
and the census — is made ONCE and observed red ONCE. Specification: `system/management/zNotesPlansDocs/
forgeDefinitionV2/SPEC-bridgeFramework-v1.md` (v1.1.2). Built in B2 (FROZEN_STREAM, 2026-08-16) under SABLE_RIVER;
`DEVLOG-bridgeFramework.md` beside the spec carries the red-observation table, the deviations and the B3 handoff.

```
const bridgeFramework = require('<lib>/bridge-framework/bridge-framework')({ graphReaderFactory, graphWriterFactory, pluginRegistry, xLog?, conflictDetector? });
bridgeFramework.run(spec, callback)      // EXACTLY as apps/graph-builder/lib/build.js Phase C calls bridgeMaker.run
```

The seam face `apps/graph-builder/apps/bridge-maker/bridgeMaker.js` is zero-argument for `build.js`: it builds the
discovery registry over `forges/<standardKey>/bridges/*.js`, constructs this framework with the two bolt files
(`graphReader.js`, `graphWriter.js` — named in `apps/graph-builder/DOCTRINE.md`) and the store-side conflict detector,
and forwards `run` unchanged. Test injection goes through the FRAMEWORK factory only (a fixture registry, the graph
double) — never the seam face.

## A plugin is a declaration + a walk + a subject rule

`forges/<standardKey>/bridges/<name>.js` exports `{ bridgeDeclaration, bridgeHooks }`: the declaration is DATA
(`bridgePluginContract.js` `BRIDGE_DECLARATION_CONTRACT`, validated by a table walk at registration — coverage of every
header column, closed values, the label table, the transform names, the blinding list); the hooks are exactly
`walkSourceAssertions` (every assertion, RAW, once per run) and `subjectStableIdFor` (once per run with the distinct
subject list), plus optional evidence hooks only when declared. A plugin never mints an edge, addresses a card, sees a
judge, a store, a writer or a driver: its hooks receive a closed argument object and a purpose-scoped reader
(`forWalk()` unblinded for the channel's declared properties only; `forEvidence()` blinded). The toy fixture under
`test/fixtures/toyBridge/` is the first instance of the shape — two plugins (crosswalk and standard) on one pairing.

## The kitchen (what `run` does, in order)

Refusals before anything runs (unregistered bridge listing the registered names; unknown `config` key; absent hub /
versions / store) → cards read and re-widened at the read boundary → the multimap `cardListByCanonicalKey` → subject
nodes (no embeddings, blinded) → document channels verified against `SHA256SUMS`, digested → the walk → sentinel drop and
transforms (an empty cell is ABSENT) → consistency checks → the label census (a label with no table row refuses the RUN)
→ group by subject → window → `subjectStableIdFor` ONCE → verify against the subject nodes, merge many-to-one, refuse
`subjectCollision` → per (leaf, target group): remodel BEFORE resolution, filter on every supplied tuple field, sort the
pool by `stableId`, classify through the ordered `CLASSIFICATION_REGISTRY` → the judge component over the rendered pool
(ordinal → `renderedPoolStableIdList`; the debug double reads and writes no cache) → FREEZE (canonical text, header with
census and `frameworkFingerprint`, content-addressed) → `saveDecisionBlock` → the store-side sibling lookup for cross-
plugin conflict → materialise from the block JUST FROZEN through the writer only (pair-scoped label on both endpoints;
the closed `MAPPING_PROPERTIES` set; producer-derived `provenanceTier`) → SSSOM/TSV export → the run report with
`blocks: [ONE block]` and `producer` ALWAYS explicit. A plain build (`rebridge: false`) reads the block, re-verifies
its digests / versions / declaration against the run, and materialises VERBATIM — zero judge calls.

## What the framework MUST NOT offer (SPEC §15)

No card lookup by join key; no plugin write path; no plugin judge / cache / store / embedder access; no predicate
override and no predicate from the judge in v1; no silent default of any kind (`[]`/`{}` are answers, absence is
refused); no per-standard branch (every dispatch is a registry lookup — BG-COMPOSE c); no `matchBasis: derived`; no
structural bridging; no value-tier resolution (refused and counted); no timestamps, run ids or version stamps in the
block (the content-derived fingerprint is the only self-reference); no re-embedding; no `cacheMode`/`pinBlockId` and no
`config` key outside `RUN_CONFIG_KEY_LIST`; no touch of the seam; no second reader; no composite / keep-first index; no
subject composition in the framework; no CSV library in the framework; no escape hatch.

## Running the suite

```
node lib/bridge-framework/test/test-<family>.js [-verbose]     # one file per family; every conjunct observed red by the sweep
node test/runAllTests.js                                       # the fleet discovers lib/bridge-framework by the .js-presence rule
```
Nothing a test runs writes into the tree: scratch copies, worktrees and forensics live in `os.tmpdir()`; framework
doubles are compiled in memory (`lib/forge-framework/test/testSupport/moduleDouble.js`); the fixture is immutable.
