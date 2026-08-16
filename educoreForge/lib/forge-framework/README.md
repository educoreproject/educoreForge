# lib/forge-framework — the EDUcore Forge Framework

ONE shared library that satisfies the EDUcore Forge Profile (`SPEC-educoreForgeProfile-v1.0.md`,
v1.0.2) for every forge bundle, so that each of the Profile's choices is made once and observed red
once. Specification: `system/management/zNotesPlansDocs/forgeDefinitionV2/SPEC-forgeFramework-v1.md`
(v1.1, CLEARED 2026-08-16). Built F3a 2026-08-16 (SHADOW_GATE under SABLE_RIVER); DEVLOG:
`forgeDefinitionV2/DEVLOG-forgeFramework.md`.

```js
const forgeFramework = require('<lib>/forge-framework/forge-framework')({ embedder, xLog? });
const bundle = forgeFramework.injectStandardHooks({ forgeDeclaration, hooks });   // synchronous
bundle.forge({ sourcePath, owner, embedNodeLimit, skipEmbedding }, callback);      // the seam, unchanged
```

A forge author writes a **declaration object** (H1, data — `forgeDeclarationContract.js`), a **hook set**
(H2–H4 — `standardHookContract.js`: `sourceLoaderList`, `describeSource`, `emitContractGraph`,
`describeRoot`; the round-trip pair lives in the bundle's `roundTripValidator.js`), and nothing else.
The framework owns the pipeline (cheap refusals → checksum verification → load → describe + stamp →
the pure layer under the ONE adapter → embed → return), the kit (`contractGraphKit.js`, the only
door for creation), the root (`rootNode.js`), the embed pass (`embedPass.js`), source verification
(`sourceVerification.js`), the stamp adapter (`provenanceStamp.js`), the census and the PROXY
fingerprint (`census.js`, `fingerprint.js`), the refusal shape (`refuse.js`), the roster gate
(`roster.js`), and the closed compatibility-declaration registry (`migrationAllowanceRegistry.js`).

The round-trip **harness** is a SEPARATE module — `roundTripHarness/roundTripHarness.js`
(`validatorFrom`, `graphDoubleFrom`), required DIRECTLY by a bundle's `roundTripValidator.js` and
never by an entry module or a hook. `graphReader.js` is the ONE bolt-facing file.

The hermetic fixture forge — the **Toy Standard** — lives under `test/fixtures/toyForge/` and satisfies
every Profile MUST a new forge owes; the unit-gate suite (`test/test-*.js`, one file per gate family)
runs over it with no licensed bytes and no container. Every gate has a twin registered in DATA
(`gateId` + conjunct, `leverKind`) and is OBSERVED RED by the sweep on every run.

## Control flow (DOCTRINE, Profile §2.2)

Callback error-first on the orchestration side (`taskListPlus`/`pipeRunner`); the kit THROWS named
`Error`s inside the pure layer; the ONE `try/catch` in the framework is the pure-layer ADAPTER in
`forge()` step 5. The harness's bolt reads resolve `.then().catch()` to the callback at the leaf, in
`graphReader.js` alone. No `async`/`await`; no Promise surfaced past a leaf.

## `CORE_VERSION` — what it means (SPEC §4.3)

`constants.CORE_VERSION` is `'2.0.0'`. It is stamped on the root as `coreVersion` and names the version
of the **shared forge core** that stamped the node: the universal property set (`_id`, `_source`,
`name`, `role`, `searchText`, `[stableUriPropertyName]`, `parentId`, `depth`, `path`, `crossRefs`), the
label triple, the root's provenance block, and the structural-contract semantics of `depth`/`parentId`.
It is `'2.0.0'` in the three forges that stamp it today (`forgeCeds.js:495`, `forgeSif.js:399`,
`forgeEdfiContractGraph.js:490`) and STAYS `'2.0.0'` under the framework, because the framework
reproduces that core. It is bumped ONLY when the universal set or the root schema changes — never for
a framework release, a bug fix, or a new forge — and a bump is a deliberate change that moves every
root line and every block id. The framework's OWN version lives in `package.json` and the DEVLOG,
never in the block. `constants.EMBED_BATCH_SIZE` (128) is likewise an exported constant, not a settable
with a default behind it — byte-invisible.

## Refusal doctrine

No default for an absent declaration key, hook, seam argument, `describeSource` key, `warn` channel
or `xLog`; no `a || b` identity chain; no coerced `name`/`description` except through a NAMED
compatibility declaration visible in `complianceReport`; no do-nothing logger; no "newest snapshot"
resolution. Every refusal is built with `refuse.byName` — `<module> REFUSED: <what> — <where>`. Two
named carve-outs (SPEC §11.5): `owningName || standardSource` inside the search-text ladder and the
finalizer's `crossRefs: '[]'` are BYTE MANDATES that reproduce today's blocks, not substitutions.

## Compatibility declarations (migration allowances)

`MIGRATION_ALLOWANCE_REGISTRY` is a CLOSED table keyed by Profile §13.1 punch ids. A migrating bundle
(one of `MIGRATING_BUNDLE_LIST`: ceds, edfi, sif, pesc260805) declares rows so the framework
reproduces its pre-migration bytes at ONE named step; declared-but-unneeded and needed-but-undeclared
are both refused; every active allowance is reported and census-counted; retirement is one commit per
allowance with a deliberately new block id. Retire PROMPTLY: the session that bumps a snapshot or changes a
loader retires every row it obsoletes; the active registry is expected to shrink (spec §7.1). F3a ships ONLY the rows F3b/F3c need — the `sourceUrl ''`
row keyed three ways (E6 / S4 / P16), S2, S3, S6, S7; PESC and CEDS rows arrive as data with their own
migrations.

Loader names (`sourceLoaderList[].loaderName`) are each forge's own logical names for its inputs; the
CONVENTION is uniform and enforced by `standardHookContract.js`: lowerCamelCase, letters and digits,
unique within the bundle, `metadata` reserved — refused by name otherwise (G-HOOK).

## Running the suite

```
node lib/forge-framework/test/test-gSeam.js            # one family; -verbose for every assertion
node lib/forge-framework/roundTripHarness/test/test-gRt.js
node test/runAllTests.js                                # the fleet — discovers both modules by the lib/ rule
```

Nothing a test runs writes into the tree: scratch copies live in `os.tmpdir()`, framework doubles are
compiled in memory (`test/testSupport/moduleDouble.js`), and the fixture under `test/fixtures/` is
immutable.
