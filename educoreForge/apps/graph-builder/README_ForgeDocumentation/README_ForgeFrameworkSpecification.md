# EDUcore Forge Framework — specification v1.1

> **v1.1, 2026-08-16 00:55–01:40** — remediated after the independent adversarial review
> (`reviews/REVIEW-forgeFramework-adversarial-081626.md`, verdict NOT-BUILDABLE: architecture sound,
> five byte-fatal defects) under the supervisor's batched rulings FR1–FR20
> (`RULINGS-supervisor-forgeFramework.md`, addendum 00:55). Sections touched: header; §1 (terms:
> `probeEvidence`, harness); §3.2 (require exception re-attributed); §3.3 (harness moved off the
> forge-time object; `verifySnapshotChecksums` semantics; `census.complianceReport` shape;
> `roster` in the surface; same-tick sentence); §3.4 (`name` optional; `stableIdPattern` data;
> `carriedProperties` filter; `cedsAnchorValue` rename; S6 translation table; `emitOptionValue`);
> §4.1 (`stableIdPattern`, `additionalSourceInputList`, `compatibilityDeclarationList` entries with
> `probeEvidence`); §4.2 (`_id` as a Profile v1.0.2 amendment); §5.1 (`describeSource` two version
> keys; `sourceFiles`; `sequenceGroups` shape; `describeRoot` I/O; loaders' additional inputs); §6.1
> (`owner` never read; step-4 refusals; step-7 return + `complianceReport`); §6.2 (post-mutation
> re-check; `finalizeSequence` shape); §6.3 (filter then slice); §6.4 (`mergeDirectives`); §6.5
> (P5 four fields; `sourceFiles`/`sourceUrl` sentence); §6.6 (harness required directly); §7.1
> (offline-precondition rows; `declarableBy`; the sourceUrl row keyed three ways); §7.2 (P4 seven,
> S7, C10, S6 in the kit (S3 RETIRED 2026-09-01, versionFromStamp order), P13 re-filed, P5 four); §7.3 (single frozen counts + conditional rows);
> §8.3 (SIF declared second input, patterns, PESC `pescTier`); §8.4 (probes 9–13); §8.5 (P1 discharge;
> C7/E5/P15 withdrawn); §9.1–9.2 (compare like with like; measured ids; explicit paths); §10
> (per-conjunct twins; G-CHECKSUM, G-REFERENT, G-SEAM-UNTOUCHED; G-ORDER/G-COMPAT/G-ROOT/G-SHARE/
> G-ID-CHEAP/G-RT-LIVE/G-CENSUS twins; RED-TODAY table; licence-gated by name); §11 (carve-outs;
> harness reachability); §12.1–12.2 (flattened tree; discovery rule); §14 (D1 as a Profile
> amendment); Appendix A (P4 seven). Line references re-verified at HEAD `ae41a89` with `grep -a`.
>
> Written 2026-08-16 by ONYX_VALLEY (F2 SYNTHESIZER) under SABLE_RIVER, from the three F2 position papers
> — `drafts/F2-architect.md` (GOLDEN_SIGNAL), `drafts/F2-forgeImplementer.md` (QUIET_FLAME),
> `drafts/F2-riskTester.md` (GARDEN_HAVEN) — against `README_ForgeProfile.md` at v1.0.1 (the
> Profile), `README_HOWTO_ForgeCreationInstructions.md`, `RULINGS-supervisor-forgeProfile.md` (all addenda), the two
> binding addenda of `BRIEF-F2-frameworkPanel.md` (23:00, 23:12), `reviews/REVIEW-forgeProfile-adversarial-081526.md`,
> `SPEC-educoreBridgeProfile-v1.0.md` §2 and §4.7, the seam in `apps/graph-builder/apps/forger/forger.js`
> (1-70, 805-850) and `apps/graph-builder/DOCTRINE.md`. Code paths are relative to
> `system/code/educoreForge/`; every `[code fact]` cited from a paper was carried with its file:line and
> the ones this document leans on hardest were re-read in the working tree at branch
> `architecture-improvement` (`grep -a`, read-only). Nothing was built, run, or committed to write this.
>
> Every MUST below carries a trace in angle brackets to its source: `⟨Profile §n⟩`, `⟨ARCH §n⟩`
> (architect paper), `⟨IMPL §n⟩` (forge-implementer paper), `⟨RISK §n⟩` (risk-tester paper),
> `⟨RULING 23:12 #n⟩` / `⟨RULING 23:00 #n⟩` (the brief's addenda), `⟨RULINGS row n⟩` /
> `⟨RULINGS 22:46⟩` / `⟨RULINGS 23:00⟩` (the supervisor's rulings file), `⟨REVIEW §x⟩`, `⟨BRIEF⟩`,
> `⟨GUIDE⟩`, `⟨DOCTRINE⟩`. Where the papers disagree, the disagreement is stated and the ruling that
> settles it is named; where no ruling exists, §14 carries the decision as MUST DECIDE with a
> recommendation. `[code fact]`, `[doc fact]`, `[design]` carry the Profile's meanings; `[design]` is
> the default for unmarked normative text here, because this IS the design.

This specification defines the Forge Framework: ONE shared library that satisfies the EDUcore Forge
Profile for every forge bundle with shared code, so that each of the Profile's choices is made once
and observed red once. It specifies the framework object and its public surface, the declaration
object a forge author writes instead of code, the hooks a forge author injects, the execute contract
that satisfies the forger's seam unchanged, the closed registry of compatibility declarations under
which the four surviving forges migrate byte-identical, the migration recipe and its acceptance test,
the gate suite with a red twin per gate, what the framework refuses to offer, where it lives, and the
decisions left to the supervisor.

TQ's mandate, verbatim in substance ⟨BRIEF⟩: a specification with the *mandatory crucial priority of
maximizing the amount of code that can be shared with other forges*; the framework *produces a
standard qtools object that hands out utility methods* and *has methods to manage injecting the
forge's method or methods and executing the final thing*.

The acceptance test, binding on every section ⟨BRIEF⟩ ⟨Profile §5.4, §13.2, §15⟩: a forge
re-implemented on the framework, built through the UNCHANGED graphBuilder under the frozen
conditions of §9, produces the IDENTICAL content-addressed block id, a clean round trip
(`inventedTotal` 0), and `goldEvalCheck` PASS; the four-forge manifest stays
`97c618c20e07c0c612957def69164402d364a98d5dfee865faacae1deace6382`. Anything that would change a
block id — ordering that reaches a value, a new stamp, a timestamp, a renamed property — is a design
error unless the Profile requires it, and then it is a separate commit with a new id.

---

## 1. Terms

Terms defined in the Profile §1 (forge bundle, descriptor, entry module, seam, forger, engine shape,
block, pure layer, hook, round-trip validator, refusal by name, compatibility declaration, block
determinism, polyArch2, the doctrine) keep their meanings. This document adds:

**the framework** — `lib/forge-framework/`, the library this document specifies. Its factory returns
**the framework object** (`forgeFramework`), a qtools-style object that hands out utility methods.

**declaration object** (H1) — the DATA a forge author writes: everything the Profile §3.5 lists as
descriptor-shaped constants, plus root data, the non-embeddable role list, the anchor sentinel list,
and the compatibility declaration list (§4). Larger than the descriptor; never code ⟨RULING 23:12 #2⟩.

**hook set** (H2–H4) — the METHODS a forge author injects: the source loaders, `describeSource`,
`emitContractGraph`, `describeRoot`, and (in the validator file) the round-trip pair (§5).

**kit** — `contractGraphKit`, the object the framework hands the emission walk; the ONLY door through
which a node or an edge is created ⟨ARCH §2.1⟩ ⟨RULING 23:12 #4⟩.

**compatibility declaration / migration allowance** — one thing under two names: a row of the closed
`MIGRATION_ALLOWANCE_REGISTRY` (§7), keyed by a Profile §13.1 punch-list id, declared by a migrating
forge so the framework reproduces that forge's pre-migration bytes at a framework-owned step. The
Profile §13 calls it a compatibility declaration; the rulings call it a migration allowance.

**census** — a count computed over the pure output (duplicate stableIds, duplicate edge triples,
dangling endpoints, active allowances) and gated against a FROZEN per-forge value.

**red twin / lever** — the injected fault that turns a gate red, and the KIND of fault it is:
`productionMutation`, `inputFault`, or `expectationLever`; only the first two count toward
"observed red" ⟨RISK §7⟩ ⟨RULING 23:12 #8⟩.

**PROXY** — the pure-layer fingerprint gate G-ID-CHEAP, which stands in for the block-id gate in unit
time and is labelled PROXY in every report because it cannot see MERGE collapse or the header
⟨RISK §3⟩ ⟨RULING 23:12 #7⟩.

**the four** — `ceds`, `edfi`, `sif`, `pesc260805`, the migrating bundles; `MIGRATING_BUNDLE_LIST`.

**offline-precondition row / `probeEvidence`** — a registry row whose need cannot be evaluated by the
framework at forge time (P1, P5, P10, C9): the pre-migration probe's result is recorded IN the
declaration entry as `probeEvidence` and the framework checks only its presence (§7.1) ⟨FR13⟩.

**the harness** — `lib/forge-framework/roundTripHarness/`, a SEPARATE module the validator file
requires directly; NOT a member of the forge-time framework object (§3.3, §6.6) ⟨FR15⟩.

---

## 2. Purpose and scope

The framework exists so that a forge author writes a declaration object, a parser, an emission walk,
an identity rule, and a round-trip pair — and nothing else ⟨Profile §6, §15⟩ ⟨GUIDE "What the
framework will remove"⟩. Everything the four surviving forges built four times — the pipeline and its
one adapter, the embed pass, `makeNode`/`addEdge`, the root, the finalizer calls, the version stamp,
the checksum verification, the CEDS-anchor normalizer, the search-text element registry, the return
assembly, and the framework half of the round-trip validator — is the framework's, once.

In scope: the forge-time object and its execute path (§3–§6); the compatibility declarations that
make byte-identical migration possible (§7); the migration recipe (§8); the acceptance test (§9); the
gate suite (§10); the round-trip harness CONTRACT (§3.3, §10 G-RT). Out of scope for v1 (§11, §14):
consolidation of the four round-trip diff engines into one implementation, the hub, bridging, graph
access, any change to graphBuilder, the forger, replayManager or the seam ⟨PLAN "Hard lines"⟩.

The framework is a way of satisfying the Profile; it is exempt from no line of it ⟨Profile preface⟩.

---

## 3. The object

### 3.1 The factory

```
const forgeFramework = require('<lib>/forge-framework/forge-framework')({ embedder, xLog? });
```

- The framework MUST be ONE tree library in the house two-stage form,
  `moduleFunction({ moduleName }) => (deps) => forgeFramework`, exported applied ⟨ARCH §1.1⟩
  ⟨Profile §2.1 (D1: all four forges and every `lib/` module use it)⟩.
- The framework object MUST hold NO per-build state. Every node/edge array, duplicate-id registry and
  stats object lives inside one invocation of the pure layer, so one framework instance serves many
  builds and the pure layer stays pure ⟨ARCH §1.1⟩ ⟨Profile §5.3⟩.

### 3.2 `deps` — what comes in

| dep | required | source | rule |
|---|---|---|---|
| `embedder` | the KEY must be present; value `Embedder` or `null` | the seam: `require(entryModule)({ embedder })` `[code fact]` `forger.js:816`, `interfaces.js:245-254` | passed straight through; the framework MUST NOT construct an embedder, read an ini, or hold a credential ⟨Profile §2.1, §2.4⟩. `null` means the spend knob is off. An ABSENT key MUST be refused by name ⟨ARCH §1.2⟩ |
| `xLog` | optional as a dep; required as a capability | an explicitly passed `xLog` wins; otherwise `process.global.xLog` `[code fact]` D2 `forgeCeds.js:102`, `forgeEdfi.js:56`, `forgeSif.js:193` | if NEITHER exists → refuse by name. No do-nothing logger is ever manufactured ⟨Profile §5.3, §12 (P8, C7, E5)⟩ ⟨ARCH §1.2⟩ |
| tree libs | — | `require`d as PURE modules, never injected: `qtools-asynchronous-pipe-plus`, `lib/vocabulary`, `lib/structural-contract`, `lib/sequence-contract`, `lib/search-text/build-search-text`, `lib/snapshot-provenance`, `path`, `fs`, `crypto` | stateless; polyArch2 says a module instantiates its own stateless dependencies and receives its stateful ones ⟨ARCH §1.2⟩ |
| config | none | — | the framework reads NO ini. `EMBED_BATCH_SIZE` and `CORE_VERSION` are exported CONSTANTS, not settable keys with defaults behind them ⟨Profile §12 "a default standing behind a settable key"⟩ ⟨RISK §6.9⟩ |

The framework MUST NOT require anything under `apps/**`, `lib/replay/**`, `lib/embedding/**`,
`lib/vector-store/**`, `neo4j-driver`, or `forges/**` ⟨ARCH §7.1⟩ ⟨RISK G-NOGRAPH⟩. The ONE
exception is `neo4j-driver`, required by the harness's `graphReader.js` alone (§12.1); `forges/**` and
the rest are forbidden absolutely. Gate G-REQUIRE (§10) greps for it.

### 3.3 The public surface

Convention ⟨DOCTRINE⟩ ⟨Profile §2.2, §11.1⟩: every method that performs I/O or sits on the
orchestration side is `callback(errString, result)`, `''` on success — no Promise, no throw across a
boundary. Members of the KIT are synchronous and THROW a named `Error`, because they run inside
`buildContractGraph`, which the seam requires to be synchronous (`interfaces.js:241-242`) and which
the Profile §2.2 sanctions to throw inside the framework's ONE adapter. Pure declaration-side
helpers (`refuse.*`, `census.*`, `fingerprint.*`, `roster.*`) are synchronous and return values. The
round-trip HARNESS is not on this object (§6.6, ⟨FR15⟩): a hook file that requires the framework can
reach nothing that opens a bolt session.

| member | signature | what it does | refuses by name |
|---|---|---|---|
| `injectStandardHooks({ forgeDeclaration, hooks })` → `bundle` | synchronous (the seam requires the bundle synchronously, `forger.js:816`) | validates the declaration object against `FORGE_DECLARATION_CONTRACT` and the hook set against `STANDARD_HOOK_CONTRACT`; returns `{ forge, buildContractGraph, STANDARD_KEY, STANDARD_SOURCE, STABLE_URI_PROPERTY_NAME }` (§6) ⟨ARCH §3⟩ | §5.4 |
| `contracts.FORGE_DECLARATION_CONTRACT` | frozen data | key → `{ required, kind, allowedValueList? }` (§4) | — |
| `contracts.STANDARD_HOOK_CONTRACT` | frozen data | hookName → `{ required, kind, arity, calledFrom, returns }` (§5) | — |
| `contracts.MIGRATION_ALLOWANCE_REGISTRY` | frozen data | allowanceId → row (§7) | — |
| `contracts.CONTRACT_GRAPH_KIT_SURFACE` | frozen data | kit member names and arities (§3.4) | — |
| `contracts.MIGRATING_BUNDLE_LIST` | frozen data | `['ceds','edfi','sif','pesc260805']` ⟨ARCH §8.3⟩ ⟨RULING 23:12 #1⟩ | — |
| `constants.EMBED_BATCH_SIZE` | `128` | the ONE copy (D6) `[code fact]` four copies today `forgeCeds.js:73`, `forgeEdfi.js:49`, `forgeSif.js:64`, `forgePesc260805.js:61` | — |
| `constants.CORE_VERSION` | `'2.0.0'` | the root's `coreVersion` `[code fact]` `forgeCeds.js:495`, `forgeSif.js:399`, `forgeEdfiContractGraph.js:490`. Its MEANING is written beside the constant (§4.3) ⟨RULING 23:12 #9⟩ | — |
| `vocabulary.{DME_ROLES, EDGE_TYPES, NODE_LABELS, PROVENANCE_TIER, STRUCTURAL_PROPERTIES}` | frozen re-exports of `lib/vocabulary` | so a forge author requires ONE module and cannot type a bare string where a registry exists ⟨ARCH §2.7⟩ | — |
| `provenance.verifySnapshotChecksums({ snapshotDirPath, relativePathList? }, callback(err, { verifiedFileList }))` | callback | verifies the named files (or every LISTED file when no list is given) against `SHA256SUMS`; the ONE module that serves forge time AND the validator's intake ⟨Profile §4.1⟩ ⟨ARCH §2.4⟩. Semantics ⟨FR8⟩: a caller-named file ABSENT from `SHA256SUMS` → refused; a listed file missing or mismatched on disk → refused; a file on disk that the list does not name → IGNORED (every snapshot carries `README_PROVENANCE.md`, `SHA256SUMS`, `standardSourceLocation` beside the bytes) | missing / unlisted-but-named / mismatched file, naming the file and the path of the acquisition recipe (`README_PROVENANCE.md`) ⟨Profile §7.1 RT-3⟩ |
| `provenance.deriveVersionStamp({ sourcePath, sourceVersion }, callback(err, { snapshotKey, publishedVersion, versionSource }))` | callback | thin adapter over `lib/snapshot-provenance` `deriveVersionStamp` `[code fact]` `:59-110`; supplies the REAL `warn` channel (`xLog.error`) so no author can pass a do-nothing one (`:66-82` refuses a missing `warn`) ⟨ARCH §2.4⟩ ⟨Profile §10.1⟩. Called BY THE FRAMEWORK in `forge()`; exported for tests | (as the lib) |
| `embed.embedNodes({ nodes, nodeSubsetLimit, nonEmbeddableRoleList }, callback(err, { embedCallCount, embeddedCount }))` | callback | §6.3 | `skipEmbedding === false` with `embedder === null`; batch failure with its batch number; vector/text count mismatch |
| `structural.finalizeStructuralContract`, `structural.classifyParentReferent`, `sequence.finalizeSequence` | re-exports of `lib/structural-contract`, `lib/sequence-contract` | CALLED BY THE FRAMEWORK at the end of the pure layer (§6.2); exported for fixture tests ⟨ARCH §2.8⟩ | (as the libs) |
| `searchText.buildSearchText(element)` | re-export of `lib/search-text/build-search-text` | so a validator or test composes the same text the forge did ⟨ARCH §2.3⟩ | (as the lib: unknown role, empty result) |
| `refuse.byName({ moduleName, what, where })` → `Error` | pure | message `<moduleName> REFUSED: <what> — <where it belongs / which line to fix>` — the house shape `[code fact]` `forger.js:106-108,186-195`; every framework refusal is built with it ⟨ARCH §2.6⟩ ⟨Profile §7.1⟩ | — |
| *(v1.1.3: `refuse.requiredKeys` and `refuse.closedValue` were DELETED under ruling FB8 — zero callers; the contract validators carry their own checks)* | | | |
| `census.collisionCensus({ nodes, edges })` → `{ duplicateStableIdCount, duplicateEdgeTripleCount, danglingEndpointCount, firstDuplicateStableId?, firstDuplicateEdgeTriple?, firstDanglingEdge? }` | pure | the pre-migration probe and the G-ORDER gate's instrument ⟨RISK §1.4, §4.3.1⟩ ⟨RULING 23:12 #5⟩ | non-array input |
| `census.complianceReport({ forgeDeclaration, nodes })` → `{ activeAllowanceList, activeAllowanceCount, namelessNodeCountByRole, substitutionCount }` | pure | the compat-census instrument ⟨RULINGS 23:00⟩; counts nodes minted without `name` per role ⟨FR4⟩ and S6 edge-type substitutions ⟨FR20⟩ | — |
| `roster.assertUniqueStandardNames({ forgesDirPath })` → `Error \| null` | pure (reads the descriptors) | reads every `forges/*/parserDescriptor.ini` and refuses a duplicate `standardName` naming both directories (G-UNIQUE) ⟨RULING 00:15 gate 9⟩ | duplicate `standardName` |
| `fingerprint.pureLayerFingerprint({ nodes, edges })` → 64-hex | pure | sha256 over the pure output canonicalised exactly as harvest + serialize would (labels sorted, property keys sorted, nodes by stableId, edges by from/type/to, scalars array-wrapped) — the PROXY (§10 G-ID-CHEAP) ⟨RISK §3⟩ | — |

**The harness module** ⟨FR15⟩ — `require('<lib>/forge-framework/roundTripHarness/roundTripHarness')({ xLog? })` →
`{ validatorFrom, graphDoubleFrom }`, required DIRECTLY by `roundTripValidator.js` (§6.6), never by an
entry module or a hook:

| member | signature | what it does | refuses by name |
|---|---|---|---|
| `validatorFrom({ forgeDeclaration, canonicalizeSource, emitFromGraph, semanticValidationLimit, extraVerdictFieldList?, gateDeclarationList?, twinRegistry? })` → `{ validate, validateWithReader }` | `validate({ containerName, boltUrl, user, password, snapshotPath, outputPath }, cb)` — the uniform stage contract `[code fact]` `round-trip-stage.js:490-498`; `validateWithReader({ reader, snapshotPath, outputPath, graphIdentity }, cb)` — the seam every twin drives ⟨GUIDE step 10⟩ | the framework half of Profile §8: intake via `provenance.verifySnapshotChecksums`, bolt reader/close (`graphReader.js`), verdict assembly with the five normative names as the required core + `verifyVerdictShape` (PESC's, `pesc260805/roundTripValidator.js:90-115`), the A13 identity ASSERTED, every LOST item labelled with a `lostCategory` of `explicitlyOmitted` or `contentGap` and `lostTotal` counting `contentGap` alone (Profile §8.3), the A8 census — wall-clock, peak memory, statement census, every count assertion naming the two quantities it compares (Profile §8.6) ⟨FR18⟩, gate evaluator + twin registry (§10.3) ⟨ARCH §2.9⟩ ⟨Profile §8.2, §8.4, §8.6⟩ | a validator that declares no or blank `semanticValidationLimit` ⟨RULINGS row 3⟩; an absent `outputPath` (E1 cannot recur); an emitter that is not callback-shaped (E3 cannot recur); a verdict missing a normative field, a `lostCategory`, or carrying a NaN/Infinity count |
| `graphDoubleFrom({ forgeResult })` → `{ readAll, close }` | callback-shaped members | the ONE Docker-free graph double built from a forge result (R5) ⟨Profile §8.6⟩ | — |

WHY the kit throws while the surface calls back. The seam demands `buildContractGraph` synchronous
and pure `[code fact]` `interfaces.js:241-242`; a callback-shaped `makeNode` inside a synchronous
walk would force the walk async and break the seam, or be unwrapped on the same tick — which the
framework does ONLY for `finalizeSequence` (§6.2 step 5, as SIF does at `forgeSif.js:634-639`, ⟨FR20⟩)
and for nothing a walk calls. The Profile §2.2 already sanctions
exactly this shape — throw inside the pure layer, ONE adapter at the boundary — and makes the adapter
the framework's.

### 3.4 The kit — `contractGraphKit({ forgeDeclaration, metadata })`

Created by the framework at the top of every `buildContractGraph` invocation and handed to the walk.
PURE: no `xLog`, no clock, no I/O; a hook cannot reach a channel through it ⟨ARCH §2.1⟩. Its surface is
declared as data (`CONTRACT_GRAPH_KIT_SURFACE`) so a hook author and a test read the same truth.

| member | shape | guarantees | refuses by name |
|---|---|---|---|
| `kit.makeNode({ role, perStandardLabel, stableId, name, description?, structural: { parentId, path, owningName? }, carriedProperties?, precedingProperties?, origin })` → node (LIVE, mutable) | stamps `labels: [NODE_LABELS.FORGED_NODE, perStandardLabel, role]`, `stableId`, top-level `role`, `properties: { _id: stableId, _source: standardSource, name, role, [stableUriPropertyName]: stableId, searchText, parentId, path, ...description-when-defined, ...carriedProperties }` exactly as `forgeEdfiContractGraph.js:385-424` `[code fact]`; `searchText` via `buildSearchText(kit.searchTextElementFor({ role, name, owningName }))` unless `role` is on `nonEmbeddableRoleList` (then NO `searchText`, CEDS's bytes `forgeCeds.js:284-286,335-336,392-393`); pushes to the build's node list IN CALL ORDER; registers the stableId; counts `stats.nodeCountByRole[role]`. `precedingProperties` (CEDS's open annotation list, `forgeCeds.js:213-223`) is spread FIRST and the universal set wins on collision; `carriedProperties` is spread LAST and a collision with a universal name is REFUSED. `depth` is NOT a `makeNode` input — the finalizer derives it (Profile §4.4.7); under allowance P1 the walk stamps it through `carriedProperties`. `name` is OPTIONAL at mint ⟨FR4⟩: a string is stamped as given; absent/`undefined`/`null` → the `name` property is OMITTED, never `''` (CEDS's four foreign vocabulary terms carry no `name` today, `forgeCeds.js:413` — no allowance needed), and the compliance report COUNTS nameless nodes per role; under allowance P9/S2 an absent name is stamped `''` instead, because `''` is bytes ⟨IMPL §2.4 R3, §4.4 R7⟩. A non-string `name` (a number) is refused unless probe #10 (§8.4) proves the forge stamps one today, in which case an allowance row is added before migration ⟨FR7⟩. Every value passes through UNTOUCHED — no `String()`, no trim, no type coercion ⟨IMPL §1.4 R10⟩ ⟨RISK H12⟩. The returned node object is the SAME object the framework will return — a walk MAY write onto it after minting (Ed-Fi's crosswalk stash `cg:955-959`, PESC's `applyDerivedTier` `derivedTier.js:1134-1163`) ⟨IMPL §7.4⟩ ⟨RULING 23:12 #4⟩ | unclean stableId (`stableIdPattern`); duplicate stableId, naming both origins ("a silent overwrite is a silent merge", `cg:336-345`) unless allowance C2 is active; unknown `role`; empty searchText; `perStandardLabel` not a string; a `carriedProperties` name in the universal set; `_id` supplied by the caller anywhere (`carriedProperties`, `precedingProperties`) ⟨RULING 23:12 #9⟩; a `precedingProperties`/`carriedProperties` value that is not a plain object; a non-string `name` |
| `kit.addEdge({ edgeType, fromStableId, toStableId, edgeContext, edgeProperties? })` | pushes `{ type, fromRef: { source, id }, toRef: { source, id }, properties: { provenanceTier: PROVENANCE_TIER.STRUCTURAL, ...edgeProperties } }` IN CALL ORDER; counts `stats.edgeCountByType`; RECORDS a dangling endpoint into `stats.danglingEdges` and refuses ONCE at the end of the pure layer naming the count and the first offender (Ed-Fi/SIF form `cg:353-382,1108-1113`; PESC's throw-at-once loses the census) unless allowance C1 is active | `edgeType` not a member of `EDGE_TYPES` unless named in an active P4 `edgeTypeAllowList` or translated by an active S6 `parentEdgeSubstitutionTable` (the kit applies the declared translation and the census counts each substitution, ⟨FR20⟩); any retired `*_MAPPING` name, always (`vocabulary.js:90-97`); `edgeProperties` not a plain object; `fromRef.source`/`toRef.source` other than the bundle's own (a cross-standard edge cannot be expressed) ⟨Profile §9⟩; (terminal) any dangling endpoint |
| `kit.stats` | the per-build counters: `nodeCountByRole`, `edgeCountByType`, `danglingEdges` pre-seeded; the walk adds its own | — | — |
| `kit.requiredStat(statName)` → value | PESC's guard lifted (`forgePesc260805.js:710-719`) ⟨Profile §4.4.9⟩ | — | unknown stat name |
| `kit.carriedProperties({ parsedObject, carryList })` → object | copies WHITELISTED fields whose value is `!== undefined` — Ed-Fi's filter (`cg:428-432`) ⟨FR7⟩; CEDS's `!== undefined && !== ''` filter (`forgeCeds.js:312`) is probe #12's subject and, if any CEDS carried field is `''` today, allowance C10 reproduces the exclusion (§7.2). Ed-Fi's `mergeDirectives: JSON.stringify(mergeDirectiveList)` (`cg:433-435`) is NOT this helper's — the walk composes it and passes it in the carry object; its key order is the parser's and G-JSONKEYS lists it (§6.4) | never invents a value | `carryList` not an array |
| `kit.crossRefsJson(crossRefList)` → string | `JSON.stringify` of `[{ system, id, raw, locator }]` in EXACTLY that key order, `raw` null-not-string when null (D22; `forgeEdfiContractGraph.js:955-959`, `forgeCeds.js:116-123`, `forgeSif.js:443-450`) ⟨IMPL §0.1⟩ ⟨RISK H9⟩; the finalizer stamps `'[]'` where absent | shape-checked | an entry missing `system` or `id` |
| `kit.searchTextElementFor({ role, name, owningName? })` → element | ONE role-keyed registry (D13) reproducing the SIF/Ed-Fi ladder (`forgeSif.js:214-229`, `cg:272-297`) with `standardName` = the declaration's `standardSource`. It HONOURS a caller-supplied `owningName` and defaults `owningName` to `standardSource` ONLY when the caller passes none — PESC's CLASS element passes the owning artifact (`forgePesc260805.js:494-499`) ⟨IMPL §4.4 R1⟩ ⟨RULING 23:12 #3⟩. A walk MAY bypass this helper and hand `makeNode` a literal `searchTextElement` (PESC's OPTION_SET form `owningClassName: owningName`, `:502-506`); the two are exclusive per call | unknown role |
| `kit.cedsAnchorValue({ rawValue, kind })` → `{ cedsAnchorValue } \| { absent: true }` (renamed from `normalizeCedsAnchor`, and its result is NOT called `stableId`: it is a JOIN-KEY value, `P######`, never an address — Profile §5.2 ⟨FR20⟩) | ONE normalizer with the byte-identical regex `/(\d+)(?!.*\d)/` (D14); `kind` from CEDS's `rolePrefixByKind` registry C/P/OS/OV (`ceds/lib/normalize.js:30-65`); the "means-absent" sentinel list comes from the DECLARATION (`cedsAnchorAbsentSentinelList`) ⟨Profile §4.3⟩ ⟨ARCH §2.1⟩ | the SIF/Ed-Fi drift on `'000000'` becomes declared data (Ed-Fi `['000000']`, SIF `[]`) | unnormalizable anchor; unknown `kind` |
| `kit.isCleanStableId({ stableId })` → boolean | the declaration's `stableIdPattern` `{ pattern, trimmed }` applied: `typeof === 'string'`, non-empty, `=== trim()` when `trimmed`, and the REAL regex — Ed-Fi `^edfi:[A-Za-z]+(/.+)?$` + trim (`cg:216-221`), SIF `^sif:[A-Za-z]+(/.+)?$` + trim (`sif/lib/normalize.js:62-67`; SIF ids legitimately contain slashes and SPACES, `test/test-r3-canonical.js:65`), CEDS `^https?://\S+$` (`ceds/lib/normalize.js:74-76`), PESC its own ⟨FR6⟩ ⟨IMPL §3.4 R11⟩ | a refusal, never a repair | — |
| `kit.rootStableId` | the root's stableId as the framework resolved it (§6.2) so a walk can stamp `parentId` referents to it without knowing the rule | — | — |
| `kit.emitOptionValue({ optionSetStableId, optionValueStableId, name, code, ...carried })` → node | a HELPER the walk CALLS to expand one option value into a `DmeOptionValue` child joined by `HAS_VALUE`; three forges expand in their own code today (`forgeCeds.js:757-803`, `cg:669-`, `forgeSif.js:598-623`); the framework offers the helper, never an opt-out ⟨RISK §6.10⟩ | — | — |

The kit is the whole of what a walk needs; a walk that needs something the kit does not offer asks
the framework for it (a new kit member is ONE row here) rather than building it locally ⟨ARCH §2.1⟩.
Gate G-SHARE (§10) refuses a hook file that defines `makeNode`, `addEdge`, `embedNodes`, or calls
`finalizeStructuralContract`, `deriveVersionStamp`, `embedTexts`, `buildSearchText` directly.

---

## 4. The declaration object — H1

`FORGE_DECLARATION_CONTRACT`. One frozen object per bundle, in `forges/<std>/lib/<std>ForgeDeclaration.js`,
required by BOTH the entry module and the validator so descriptor-shaped data is written once
⟨ARCH §4.3⟩. The ini half of H1 (`parserDescriptor.ini`) stays the forger's to read; the framework
never reads the ini ⟨Profile §3⟩. It is a declaration OBJECT, larger than the descriptor
⟨RULING 23:12 #2⟩.

### 4.1 Keys

| key | kind | required | Ed-Fi's value today `[code fact]` | rule |
|---|---|---|---|---|
| `standardKey` | string, lowercase | yes | `'edfi'` (`cg:57`) | MUST equal the bundle directory token; returned in the seam ⟨Profile §2.3⟩. Gate G-SEAM |
| `standardSource` | string | yes | `'EdFi'` (`cg:58`) | `_source` on every node and `ref.source` on every edge; MUST equal the descriptor's `standardName` — gate G-SOURCE asserts it against the ini ⟨Profile §3.1⟩ ⟨RISK H14⟩ |
| `standardDisplayName` | string | yes | `'Ed-Fi Data Standard'` (`cg:59`) | the ROOT's `standardName` property and the root searchText's `standardName`. NEVER derived from the descriptor's `standardName` or `displayName` — in three of four forges it differs from both, and a root built from the descriptor changes three block ids ⟨IMPL §7.2⟩ ⟨RULINGS 22:51 (c)⟩ ⟨RULING 23:12 #2⟩ |
| `stableUriPropertyName` | string | yes | `'edfiStableId'` (`cg:60`) | stamped on every node; returned in the seam; header `resolutionKey` ⟨Profile §2.3, §5.1⟩ |
| `stableIdPattern` | `{ pattern: <regex source>, trimmed: boolean }` | yes | `{ pattern: '^edfi:[A-Za-z]+(/.+)?$', trimmed: true }` (`cg:216-221`) | the REAL predicate, as data ⟨FR6⟩: SIF `{ pattern: '^sif:[A-Za-z]+(/.+)?$', trimmed: true }` (`sif/lib/normalize.js:62-67`), CEDS `{ pattern: '^https?://\\S+$', trimmed: false }` (`ceds/lib/normalize.js:74-76`), PESC `PERMISSIVE_STABLE_ID_PATTERN` under allowance P10 (§7). Drives `kit.isCleanStableId`; a refusal, never a repair |
| `rootStableIdFrom` | `'declared' \| 'sourceUrl'` | yes | `'declared'` | closed two-value registry: CEDS's root stableId is `metadata.sourceUrl` (`forgeCeds.js:469`), the other three declare `<standardKey>:root` ⟨ARCH §2.5⟩ ⟨IMPL §3.4 R2⟩. Any other value refused |
| `rootStableId` | string | when `rootStableIdFrom === 'declared'` | `'edfi:root'` (`cg:61`) | refused if present with `'sourceUrl'` |
| `rootLabel` | string | yes | `'EdfiRoot'` (`cg:465`) | verbatim; CEDS `'CedsOntology'`, SIF `'SifRoot'`, PESC `'Pesc260805Root'` — never derived by capitalising `standardKey` ⟨RISK H5⟩ |
| `parserVersion` | string | yes | `'2'` (`cg:485`) | root property, verbatim; the framework MUST NOT substitute its own version ⟨RISK H20⟩ |
| `mappingInstruction` | six-key object | yes | Ed-Fi's (`cg:68-75`) | exactly `{ cedsOriginalAnchorPropertyName, cedsOptionOriginalAnchorPropertyName, crosswalkPrefix, crosswalkResolveProperty, includeInImplied, impliedTargets }` in THAT order; JSON-stringified onto the root in that order (the string is a byte, §10 G-JSONKEYS) ⟨Profile §10.4⟩ ⟨IMPL §1.4 R5⟩ ⟨RISK H10⟩. More or fewer keys refused |
| `nonEmbeddableRoleList` | list of `DME_ROLES` members | yes (may be `[]`) | `[]` | a node whose role is listed carries NO `searchText` and is skipped by the embed pass, never removed from the array (CEDS `[EDIT_HISTORY_ENTRY, RESTRICTION, VOCABULARY_TERM]`, `forgeCeds.js:829-834`) ⟨Profile §4.6⟩ ⟨RISK H25⟩. A PERMANENT declaration, not an allowance (§14 D7). A non-member role refused; a FRAMEWORK-owned role (`DmeEmbedText`) refused too — the framework makes it non-embeddable itself through `frameworkNonEmbeddableRoles.effectiveNonEmbeddableRoleList`, the ONE union used by the kit (no searchText at mint), the §6.2 step-4c re-check and inside `embed.embedNodes` ⟨PLAN-forgeEmbedText §8.3 R-ET-3⟩ |
| `embedTextDeclaration` | `null`, or `{ embedTextLabel: <non-empty string>, textPropertyListByRole: { <DME_ROLES member>: [unique non-empty property names] } }` | yes (`null` when the bundle embeds no text) | `null` (`edfiForgeDeclaration.js`) | the text a bundle embeds as framework-minted `DmeEmbedText` nodes (§6.2 step 4b, §6.3 text pass). `embedTextLabel` is the per-standard text-node label verbatim (`'EdfiEmbedText'`, `'CedsEmbedText'`, `'SifEmbedText'`, `'Pesc260805EmbedText'`, toy `'ToyEmbedText'`); the framework derives no prefix. Refused by name: any other shape; an unknown inner key; a missing or empty `embedTextLabel`; an EMPTY role map (declare `null` instead); a role outside `DME_ROLES`; `DmeEmbedText` itself; an empty or non-list property list; a non-string or empty name; a duplicate name; a framework-stamped, structural or vector name (`searchText`, `embedding`, `textEmbedding`, `embeddingModelVersion`, `embedSourceProperty`, `vectorPropertyName`, `_id`, `_source`, `role`, `parentId`, `path`, `stableId`, `crossRefs`, `depth`, and the bundle's `stableUriPropertyName`) — `name` and `description` ARE legitimate text properties. Gate G-ETEXT (k) ⟨PLAN-forgeEmbedText §8.3 R-ET-15, R-ET-19⟩ |
| `cedsAnchorAbsentSentinelList` | string list | yes (may be `[]`) | `['000000']` (`cg:63`) | §3.4 `cedsAnchorValue` |
| `additionalSourceInputList` | list of `{ inputName, relativePathFromSourcePath }` | yes (may be `[]`) | `[]` | a DECLARED second (third…) source input inside the snapshot, resolved by the framework relative to `sourcePath`, verified against `SHA256SUMS`, and handed to every loader as `additionalSourceInputPathByName`; absent on disk → refused by name. SIF: `[{ inputName: 'refIdResolutionMap', relativePathFromSourcePath: 'refIdResolutionMap.tsv' }]` (today located by search, `sif/lib/parser.js:520-527`) — declared, not sniffed (Profile §3.3) ⟨FR20⟩ ⟨RULING 23:12 #4⟩ |
| `compatibilityDeclarationList` | list of `{ allowanceId, probeEvidence?, ...allowanceData }` | yes (may be `[]`) | `[{ allowanceId: 'E6' }]` (§7) | every `allowanceId` MUST be a `MIGRATION_ALLOWANCE_REGISTRY` key whose `declarableBy` names this `standardKey`; a non-empty list on a bundle whose `standardKey` is not in `MIGRATING_BUNDLE_LIST` is refused; an offline-precondition row (§7.1) MUST carry `probeEvidence` ⟨RULING 23:12 #1⟩ ⟨FR13⟩ |

Validation is a table walk over the contract, not a switch. Refused by name at `injectStandardHooks`:
a missing required key; an UNKNOWN key (a typo must not become a silently ignored declaration); a
wrong kind; a closed-value violation; a `mappingInstruction` with a missing or extra key or keys in
the wrong order; a role not in `DME_ROLES`; an unknown allowance id; an allowance id whose `declarableBy` does
not name this bundle (`edfi` declaring `P4`) ⟨FR20⟩; an offline-precondition row without `probeEvidence`
⟨ARCH §3⟩ ⟨Profile §7.1⟩; a `nonEmbeddableRoleList` naming `DmeEmbedText`; and every `embedTextDeclaration`
fault its row lists.

### 4.2 What is NOT in the declaration, and why

- `sourceFormat`, `sourceFiles`, `sourceUrl`, `version` — come from `describeSource` (§5.2), because
  they are read from the SOURCE, not declared (Ed-Fi's `sourceFormat` is a literal in the forge today,
  `forgeEdfi.js:182`, and moves to `describeSource`'s return).
- the per-standard label prefix — each `makeNode` call passes `perStandardLabel` verbatim; a prefix
  rule would be a derivation ⟨RISK H5⟩.
- `checksumVerification` — there is no such key. The framework verifies the consumed bytes against
  `SHA256SUMS` before every parse, for every bundle, from day one ⟨RULINGS 22:46 M4 CONFIRMED⟩
  ⟨RULING 23:12 #9 "ONE value"⟩ ⟨RISK H33⟩. Ed-Fi's loaders MAY additionally verify at consumption
  (`metaEdSourceLoader.js:37,103-106`); the double hash is accepted ⟨ARCH §9.3⟩.
- `_id` policy — none. The FRAMEWORK stamps `_id: stableId` (the engine overwrites it and the harvest
  drops it, so it is byte-invisible); a HOOK MUST NOT set it. Profile v1.0.1 §5.1 reads "a forge MUST
  NOT set `_id`" — the framework's stamp is a Profile v1.0.2 AMENDMENT the supervisor makes, not an
  F2 decision (§14 D1) ⟨FR20⟩ ⟨ARCH §0 C1, §8.1⟩ ⟨RISK §1.2⟩.
- `displayName` (ini) — read by nothing (`Profile §3.1`); the framework does not read it.
- `EMBED_BATCH_SIZE` — a constant, byte-invisible ⟨RISK §1.2, §6.9⟩.

### 4.3 `CORE_VERSION` — meaning, written beside the constant ⟨RULING 23:12 #9⟩

`coreVersion` on the root names the version of the SHARED FORGE CORE that stamped the node: the
universal property set (`_id`, `_source`, `name`, `role`, `searchText`, `[stableUriPropertyName]`,
`parentId`, `depth`, `path`, `crossRefs`), the label triple, the root's provenance block, and the
structural-contract semantics of `depth`/`parentId`. It is `'2.0.0'` in the three forges that stamp it
`[code fact]` and stays `'2.0.0'` under the framework, because the framework reproduces that core. It
is bumped ONLY when the universal set or the root schema changes — never for a framework release, a
bug fix, or a new forge — and a bump is a deliberate change that moves every root line
⟨RISK H20, §6.5⟩. The framework's own version lives in its `package.json` and the DEVLOG, not in the
block.

---

## 5. The injection contract

TQ: "methods to manage injecting the forge's method or methods." Two things are injected — DATA (H1)
and METHODS (H2–H4) — through ONE call, `injectStandardHooks({ forgeDeclaration, hooks })`, which
validates both and returns the seam bundle synchronously ⟨ARCH §3⟩.

### 5.1 The hook set — `STANDARD_HOOK_CONTRACT`

| hook | kind | required | called from | signature | contract |
|---|---|---|---|---|---|
| `sourceLoaderList` | list of `{ loaderName, load }`, length ≥ 1 | yes | orchestration | `load({ sourcePath, additionalSourceInputPathByName, xLog }, callback(errString, loaded))` | run SERIALLY in list order; results assembled as `parsed = { [loaderName]: loaded }`. THE CANONICAL FORM OF PARSE ⟨RULING 23:12 #4 "H2 = N loaders"⟩: Ed-Fi's three loaders (`forgeEdfi.js:117-168`) are three entries; CEDS/SIF/PESC are a list of ONE. SIF's second input (`refIdResolutionMap.tsv`, `sif/lib/parser.js:520-527`) becomes a DECLARED loader input — `additionalSourceInputList` in H1 (§4.1), resolved and verified by the framework, handed to the loader as `additionalSourceInputPathByName.refIdResolutionMap` — never located by search ⟨FR20⟩; its fifth `forge()` argument dies (§6.1) ⟨IMPL §7.6⟩ ⟨Profile §4.2 "MUST NOT force a multi-input standard to fold its loaders"⟩. `loaderName` of `'metadata'` refused (it would shadow the framework's). Loaders consume ONLY bytes the framework has verified (§6.1 step 2) |
| `describeSource` | function | yes | orchestration, PURE | `({ parsed }) => { version?: string, selfDescribedVersion: string \| null, sourceFormat, sourceFiles, sourceUrl }` | ⚠ `version` IS OPTIONAL as of the versionFromStamp order (tqii 2026-08-31): a bundle that read no version OMITS the key entirely and the framework takes the root's `version` from the provenance STAMP. When present it is still the ROOT `version` property, and a PRESENT value differing from the resolved stamp is REFUSED BY NAME (`refuseVersionDisagreement`). TWO version keys ⟨FR2⟩: `version` is the ROOT `version` property; `selfDescribedVersion` is the `deriveVersionStamp` input — the standard's OWN reading, `null` when the source does not self-describe (the framework then stamps `'unknown'` in the provenance triple). Without allowance S3 the framework REFUSES `version !== (selfDescribedVersion ?? 'unknown')`; under S3 (SIF: root `version: '1.0'` from `sif/lib/parser.js:943` while the stamp input is `null` — `forgeSif.js:762-765`, header `sif@unknown_01`) the two may differ. ALL FIVE keys required; `sourceFiles` an array in the ORDER the standard states (never re-sorted, `[code fact]` Ed-Fi concat order `forgeEdfi.js:183-185`, PESC sorted readdir `pesc/lib/parser.js:735-737`) ⟨RISK H11⟩, non-empty unless allowance S7 is active (SIF's parser returns no `sourceFiles` and the root carries `[]`, `sif/lib/parser.js:942-955`, `forgeSif.js:394` ⟨FR3⟩). A SEPARATE hook, not folded into a loader ⟨RULING 23:12 #9⟩. Under allowance P2 it MAY additionally return `{ snapshotKey, publishedVersion, versionSource }` and the framework does not call `deriveVersionStamp`; without P2 those keys are refused. `sourceUrl: ''` is refused unless allowance E6/S4/P16 is active (Profile §10.4: a URL-less standard OMITS `sourceUrl`) |
| `emitContractGraph` | function | yes | PURE (inside the adapter) | `({ parsed, metadata, kit }) => { nodes, edges, stats, sequenceGroups?, ...standardSpecificReports }` | the walk (H3). It CALLS `kit.makeNode` / `kit.addEdge`. It MAY be a COMPOSITION (PESC's three tiers, `forgePesc260805.js:641-676`) and MAY write onto nodes it has minted ⟨RULING 23:12 #4⟩. `nodes` and `edges` MUST be, element for element by object identity, the kit's collected arrays — possibly re-assembled by concatenation, never containing an object the kit did not mint; an object of foreign origin is refused by name ("the kit is the only door for CREATION"). The ORDER of the returned arrays IS the emission order the framework passes through untouched (§6.4) ⟨RULING 23:12 #5⟩. `sequenceGroups` is `{ orderingByParent }` where `orderingByParent[groupKey] = { members: [stableId…], orderSemantics: 'normative' \| 'document' }` — `orderSemantics` PER GROUP, exactly the shape `lib/sequence-contract/sequence-contract.js:79,106-110,142` consumes (SIF `'document'` on every group, `forgeSif.js:238-280`) ⟨FR5⟩; present only for a standard that sees element order (SIF; PESC after P3). Reports (`crosswalkMatchReport`, `syntheticMergeReport`) pass through to the seam return as extra keys ⟨Profile §2.3⟩ |
| `describeRoot` | function | yes | PURE | `({ parsed, metadata }) => { description?, extraProperties? }` — `metadata` is the POST-stamp object (step 4 complete); an absent `description` → the root carries no `description` ⟨FR20⟩ | the root's per-standard `description` (today template-built in all four — punch rows C8/S5/P17 and §14 D9 — reproduced verbatim during migration; the framework cannot distinguish a template from a source-stated string, so this MUST is enforced by review, not by a registry row); `extraProperties` refused unless an allowance names it (PESC's `pescTier: 'meta'` under P5, provisional per Profile §14) |
| `roundTripPair` | object | yes for a NEW forge; validated by the harness's `validatorFrom`, not by `injectStandardHooks` | validator | `{ canonicalizeSource({ ...intake }, cb(err, { statements: Map, stats })), emitFromGraph({ reader }, cb(err, { statements: Map, stats } \| { fault })), semanticValidationLimit }` (H4, Profile §8.5) | lives in `roundTripValidator.js`; the emit-then-canonicalize-with-the-SAME-canonicalizer shape (SIF/PESC) is the recommended one; a synchronous emitter refused (E3) |

Struck: `summarizeForgeStatus` ⟨RULING 23:12 #9 "drop"⟩. The framework prints its own uniform
node/edge/embed count line; a per-standard status sentence (Ed-Fi's crosswalk-match line,
`forgeEdfi.js:220-229`) is printed by the loader or walk through `xLog` on the orchestration side, or
not at all.

**Multiple methods vs one — the ruling.** TQ said "method or methods." The canonical injection is the
HOOK SET above — several small methods, each with one job and one declared shape — because the four
forges' genuinely per-standard code already falls into exactly these seams (Profile §6, Author A §3),
and a single `forgeStandard(everything)` method would be a wrapper around the pipeline that lets a
standard swallow it (the "shared code as a lie" smell, §10 G-SHARE) ⟨ARCH §3.2⟩ ⟨RISK §5⟩. The
single-method form is offered ONLY as a `sourceLoaderList` of length one — a forge with one parser
supplies one loader; that IS "the forge's method." No other single-method form exists.

### 5.2 Validation at injection — refuse by name, before any I/O

Missing required hook; unknown hook name (a typo must not become a silently ignored hook); a hook of
the wrong kind; wrong arity (`load` arity 2, `describeSource`/`emitContractGraph`/`describeRoot`
arity 1); a `sourceLoaderList` entry missing `loaderName` or `load`; duplicate `loaderName`;
`loaderName: 'metadata'`; a declaration violation (§4.1). Validation is a table walk over
`STANDARD_HOOK_CONTRACT`, not a switch ⟨ARCH §3.2⟩ ⟨polyArch2⟩. Gate G-HOOK (§10).

### 5.3 The entry module — one line

Under the framework the ENTRY MODULE is one line binding the declaration object and the hooks to the
factory ⟨RULING 23:00 #6⟩ ⟨Profile §2.1 [design — F2 defines]⟩; what `require` returns is still
`({ embedder }) => bundle`, in the house two-stage form. §8.2 shows Ed-Fi's whole.

### 5.4 What is validated where

| thing | validated by | when |
|---|---|---|
| declaration object | `injectStandardHooks` | at `require` of the entry module (the forger's `require(entryPath)({ embedder })`, before any build I/O) |
| forge-time hook set | `injectStandardHooks` | same |
| round-trip pair + `semanticValidationLimit` | the harness's `validatorFrom` (§6.6) | at `require` of `roundTripValidator.js` by the stage (`round-trip-stage.js:120-157`); a declared-but-broken validator is a refusal on EVERY build ⟨Profile §3.3⟩ |
| `describeSource` return | `forge()` step 4 | per build |
| `emitContractGraph` return (kit-origin identity, shape) | `buildContractGraph` | per build |
| root | `buildContractGraph` integrity pass | per build |
| allowance preconditions | `buildContractGraph` integrity pass and `forge()` step 4 | per build (§7.2) |

---

## 6. The execute contract

TQ: "executing the final thing." The bundle's `forge` IS the execution. It satisfies the seam
UNCHANGED `[code fact]` `forger.js:816` (`require(resolved.entryPath)({ embedder })`), `:827-828`
(`bundle.forge({ sourcePath, owner, embedNodeLimit, skipEmbedding: !vectorize }, cb)`), and returns
what `forger.js:835,881,925,942-956` read ⟨Profile §2⟩ ⟨PLAN "Hard lines"⟩. graphBuilder, the forger,
`shapeForgedGraph`, replayManager and the seam are NOT modified; if the framework needs the seam to
change, STOP and the supervisor rules.

### 6.1 `bundle.forge({ sourcePath, owner, embedNodeLimit, skipEmbedding }, callback)` — the pipeline

One `taskListPlus`, one `pipeRunner`, callback error-first (D3; `forgeEdfi.js:114-267` is the
template) ⟨DOCTRINE⟩ ⟨ARCH §4.1⟩. `forge` MUST be arity 2 ⟨Profile §2.2⟩. The framework accepts exactly
the four seam keys ⟨RULING 23:12 #4⟩ and READS three of them — `sourcePath`, `embedNodeLimit`,
`skipEmbedding`; `owner` is accepted and NEVER read ⟨FR12⟩. An unknown fifth key on the argument
object is REFUSED by name (SIF's `resolutionMapPath`, `forgeSif.js:746`, moves into its loader)
⟨IMPL §7.6⟩; gate G-SEAM asserts, with a Proxy that permits exactly those three reads, that nothing
else — `owner` included — is READ ⟨RISK §5⟩.

| # | step | owner | refuses by name |
|---|---|---|---|
| 1 | **cheap refusals first** ⟨Profile §7.1⟩: `sourcePath` absent or not a string; `sourcePath` not on disk; `skipEmbedding` not a boolean; `skipEmbedding === false` with `embedder === null` ("silence is not consent to spend", `forgePesc260805.js:575-582`, M10) | framework | each, before any I/O — "a refusal can never itself cost anything" |
| 2 | **checksum verification**: `provenance.verifySnapshotChecksums({ snapshotDirPath })` over the snapshot directory that contains `sourcePath` (the directory itself when `sourceFile` is absent; the file's directory otherwise), verifying every listed file that the loaders will consume — for a file-bound parser the ONE file, for a directory parser every listed file ⟨Profile §4.1⟩ ⟨RULINGS 22:46 M4⟩ ⟨RISK H33⟩ | framework | missing / unlisted / mismatched file, naming the recipe |
| 3 | **load**: run `sourceLoaderList` serially → `parsed = { [loaderName]: loaded }` | hooks (H2) | a loader's error, prefixed `forge-<standardKey> <loaderName>:` |
| 4 | **describe + stamp**: `describeSource({ parsed })` → `{ version?, selfDescribedVersion, sourceFormat, sourceFiles, sourceUrl }` (`version` OPTIONAL since the versionFromStamp order, tqii 2026-08-31 — omitted, the stamp supplies it; present and disagreeing with the stamp, refused by name); then, unless allowance P2 is active, `provenance.deriveVersionStamp({ sourcePath, sourceVersion: selfDescribedVersion })`; `metadata = { version, versionSource, sourceFormat, sourceFiles, sourceUrl, snapshotKey, publishedVersion }` (Ed-Fi `forgeEdfi.js:170-197`, CEDS `forgeCeds.js:891-909`, SIF `forgeSif.js:759-767` made one) ⟨Profile §10.1⟩ ⟨FR2⟩ | framework | `describeSource` missing a key or returning an undeclared key; `version` of `''` (the seam refuses it later, `forger.js:362-372`; the cheap refusal belongs here); `version !== (selfDescribedVersion ?? 'unknown')` without S3; `sourceUrl: ''` without E6/S4/P16; `sourceFiles` empty without S7 |
| 5 | **the pure layer under the ONE adapter**: `buildContractGraph({ parsed, metadata })` (§6.2) inside the framework's `try/catch` — "the throw-to-callback ADAPTER, not control flow" (`forgeEdfi.js:199-231`); a throw becomes `next('forge-<standardKey> buildContractGraph: <message>')`. A forge author never writes `try` ⟨Profile §2.2⟩ ⟨DOCTRINE⟩. Then the framework's uniform count line via `xLog.status` | framework | (translated) every pure-layer refusal |
| 6 | **embed**: `skipEmbedding === true` → `embedCallCount: 0`, no `embedTexts` call (D7); else `embed.embedNodes({ nodes: contractGraph.nodes, nodeSubsetLimit: embedNodeLimit, nonEmbeddableRoleList })` — the hook's node ORDER preserved (§6.4) — THEN (step 6b) the text pass `embedTextNodes({ nodes, embedNodeLimit, standardKey })` over the `DmeEmbedText` nodes (§6.3), skipped under the same `skipEmbedding`; `embedCallCount` is the SUM of both passes. The text pass reads nothing new from the seam argument (G-SEAM's Proxy still permits `sourcePath`, `embedNodeLimit`, `skipEmbedding` only) | framework | §6.3 |
| 7 | **return** `callback('', { nodes, edges, metadata, stats, embedCallCount, standardKey, stableUriPropertyName, complianceReport, ...standardSpecificReports })` — the seam's six declared keys (`interfaces.js:239-240`; of these the forger's live path READS `nodes`, `edges`, `metadata`'s four, `embedCallCount`, `stableUriPropertyName` — `standardKey` is read by nothing live, the header takes the recipe token, `build.js:1475`, so the framework's own G-SEAM equality check is its only enforcement), plus `stats` (the walk's object, carrying the five `embedText*` counts of §6.2 step 4b when `embedTextDeclaration` is non-null and none under `null`), `complianceReport: { activeAllowanceList, activeAllowanceCount, namelessNodeCountByRole, substitutionCount }` (§7.3, ⟨FR4⟩) and the walk's reports as extras ⟨Profile §2.3 "MAY return additional keys"⟩ | framework | — |

`owner` is accepted and NEVER READ by the framework — not carried, not handed to a hook, not
interpreted; an absent `owner` is not refused ⟨RULINGS row 4⟩ ⟨RISK §8.3⟩ ⟨FR12⟩ ⟨§14 D4⟩. `bundleVersion` is the forger's derivation from `metadata.version` (`forger.js:923-936`); the
framework guarantees `metadata.version` is what the bundle READ or `'unknown'`, never `''`, never the
recipe token — it never sees the recipe token ⟨Profile §2.4⟩.

### 6.2 `bundle.buildContractGraph({ parsed, metadata })` — the pure layer

> **v1.1.2 (supervisor, 2026-08-16 08:30):** a hook MAY log through `process.global.xLog`; a log line is not a byte. G-DET's grep over migrated hook files covers clocks/randomness only.

Exported under exactly that name ⟨Profile §2.1⟩ (P7 cannot recur). Synchronous, deterministic, no
I/O, no clock, no `xLog`. It:

1. creates a fresh `contractGraphKit({ forgeDeclaration, metadata })` — fresh arrays, fresh
   duplicate-id registry, fresh stats;
2. builds the ROOT (§6.5) FIRST and registers its stableId, so the walk can refer to
   `kit.rootStableId`. Root stableId: `forgeDeclaration.rootStableId` when `rootStableIdFrom ===
   'declared'`; `metadata.sourceUrl` when `'sourceUrl'` (CEDS, `forgeCeds.js:469`);
3. calls `emitContractGraph({ parsed, metadata, kit })`;
4. runs the integrity pass, in three parts whose ORDER is ruled ⟨PLAN-forgeEmbedText §8.3 R-ET-2⟩:
   **4a — over the WALK's return, unchanged:** refuse by name any returned node or edge not minted by
   the kit, returned twice, or minted and not returned; and any returned node whose role is
   `DmeEmbedText` — the framework owns that role ⟨§8.5 R-ET-35⟩;
   **4b — the framework's text nodes:** `embedTextDerivation.deriveEmbedTextGraph({ nodes: returnedNodes,
   embedTextDeclaration, kit })` mints, through the kit, one `DmeEmbedText` node per DISTINCT declared
   text and one `EMBEDS_TEXT_OF` edge per distinct (text node, source node) pair (rules below); the
   framework then COMPOSES `nodes` = the walk's returned nodes followed by the text nodes, and `edges`
   likewise, by IDENTITY — a walk that returned the live `kit.nodes`/`kit.edges` already holds the
   appended text nodes and is not double-appended; a walk that returned a copy has them concatenated and
   is not refused for nodes it never minted; and it writes the derivation's five counts
   (`embedTextNodeCount`, `embedTextEdgeCount`, `embedTextSkippedEmptyCount`, `embedTextAbsentCount`,
   `embedTextTrimmedCount`) onto the `stats` object the walk returned. Under `embedTextDeclaration: null`
   nothing is minted and no `embedText*` property is written ⟨R-ET-23, §8.4 R-ET-29⟩;
   **4c — over the COMPOSED arrays:** dangling endpoints → count + first offender (unless C1 active, then recorded in `stats` and the
   census); duplicate stableIds already refused at mint (unless C2 active — then counted);
   `_source === standardSource` on every node; the root's required set (§6.5); every active
   allowance's precondition met and no needed allowance undeclared (§7.2); AND — because a walk may
   write onto a minted node (§3.4) — the kit's universal-property checks are RE-RUN over every node and
   edge POST-MUTATION: `_id === stableId`, `role` a `DME_ROLES` member and equal to the label triple's,
   `searchText` present and non-empty unless the role is non-embeddable (the declaration's list plus the
   framework-owned roles, R-ET-3), no universal-name value
   overwritten to a non-string, `[stableUriPropertyName] === stableId`, every edge `type` still a member
   of `EDGE_TYPES` or an active P4/S6 name, every edge `properties.provenanceTier === 'structural'`
   ⟨FR15⟩. Creation is single-doored AND enforcement survives mutation;
5. calls `finalizeSequence({ nodes, orderingByParent }, cb)` when the walk returned `sequenceGroups`,
   with `orderSemantics` PER GROUP inside `orderingByParent[groupKey]` (`sequence-contract.js:79,
   106-110,142` refuses any value but `'normative'`/`'document'`) ⟨FR5⟩ (callback-shaped per R7; the
   framework unwraps its same-tick callback as SIF does at `forgeSif.js:634-639`; a refusal is thrown
   to the adapter) — BEFORE the structural finalizer, preserving SIF's order (`:634` precedes `:688`;
   the two are not proven independent) ⟨IMPL §2.4 R5⟩. SIF calls it BEFORE its edge translation
   (`:634` precedes `:641+`); the framework calls it after the walk has returned edges — byte-neutral
   because `finalizeSequence` reads `nodes` only (`sequence-contract.js:79-142`), stated so the move is
   deliberate ⟨REVIEW B17⟩; under allowance P3 the absence of `sequenceGroups` from an element-ordered
   standard is permitted;
6. calls `finalizeStructuralContract({ nodes, edges })` LAST over structure — derives `depth`, stamps
   `crossRefs: '[]'` where absent, refuses ≠1 root / bad `parentId` / cycle ⟨Profile §4.4.7⟩ — unless
   allowance P1 is active;
7. returns `{ nodes, edges, stats, ...standardSpecificReports }` — `nodes`/`edges` in the walk's order
   followed by the framework's text nodes/edges in mint order (§6.4).

WHY the root is built first and the walk cannot push its own objects. The kit is the ONLY door for
CREATION, so every node carries the universal stamp and every stableId went through the duplicate
registry — the two integrity properties Profile §4.4 item 6 says are unsafe to leave to an author
(CEDS has neither, C1/C2). The walk's returned arrays are honoured for ORDER and for composition, and
checked for ORIGIN ⟨ARCH §4.2⟩ ⟨RULING 23:12 #4⟩. The pure layer stays testable in isolation exactly
as today: `buildContractGraph` takes what the loaders produced and gives `{ nodes, edges }`.

**The embed-text derivation (step 4b)** ⟨PLAN-forgeEmbedText §8.3 R-ET-1, R-ET-4, R-ET-16; §8.4 R-ET-28,
R-ET-29⟩. Over the walk's returned nodes in emission order, for each node whose role has a declared
list, for each listed property in list order: `undefined`/`null` → counted (`embedTextAbsentCount`) and
skipped; a string is one value; ANY list is expanded element-wise (a one-element list is one value), an
EMPTY list is refused, and an element that is not a string (a nested list included) is refused; any
other type is refused; a value containing NUL (U+0000) is refused (the vector sidecar refuses NUL at
harvest); `text = value.trim()` is the DECLARED identity rule — empty after trim → counted
(`embedTextSkippedEmptyCount`) and skipped, a non-empty text that differs from its value → counted
(`embedTextTrimmedCount`). Identity is the text alone: `stableId = rootStableId + ('/' unless the root
already ends with '/') + 'embedText/' + sha256hex(text)` (CEDS's root `https://w3id.org/CEDStandards/terms/`
yields ONE slash), `path = 'embedText/' + sha256hex(text)`, `parentId = rootStableId`. Text nodes are minted
in ascending `stableId` order carrying `{ text, embedSourceProperty: 'text', vectorPropertyName:
'textEmbedding' }` beyond the kit's stamps — no `name`, no `description`, no `searchText` (the kit builds
none for a framework-owned role), no `embedding`; the finalizers give them `depth` 1 and `crossRefs '[]'`.
Edges are added in ascending (from, to) order, ONE per distinct (text node, source node) pair, carrying
`propertyNameList` — the sorted, unique source property names of that pair (the collision census
stays 0 per forge). Refusals name the module, the source node's stableId and the property.

### 6.3 `embed.embedNodes` — census D5–D7 made ONE

Filter by `nonEmbeddableRoleList` FIRST (CEDS), THEN slice to `nodeSubsetLimit` in emission order (the
F3b builder confirms this order against Ed-Fi today by probe, ⟨FR20⟩), chunk by
`EMBED_BATCH_SIZE`, serial recursion, `embedder.embedTexts({ texts }, cb)`, stamp
`properties.embedding = Array.from(vectors[i])`, mirror to `node.embedding`, stamp
`embeddingModelVersion` on BOTH the node and its properties from `embedResult.embeddingModelVersion`
(CARRIED, never invented), count `embedCallCount`, one status line per batch `[code fact]`
`forgeEdfi.js:61-105` (the compound names to keep) ⟨Profile §4.7⟩ ⟨ARCH §2.7⟩. The pass NEVER removes
a node from the array and NEVER re-orders it — a non-embeddable or over-limit node simply carries no
vector ⟨RISK H4, H25, §1.3⟩. Refuses by name: `embedder === null` with embedding requested; a batch
failure with its batch number; `vectors.length !== texts.length` (`interfaces.js:249-251`).
`embedNodeLimit` slices "the first N" of the array as the hook ordered it ⟨ARCH §0 C3⟩.

The role filter is the caller's `nonEmbeddableRoleList` UNIONED with the framework-owned roles
(`FRAMEWORK_NON_EMBEDDABLE_ROLE_LIST = [DmeEmbedText]`), computed INSIDE `embedNodes` because the public
`embed.embedNodes` export takes a caller list ⟨PLAN-forgeEmbedText §8.3 R-ET-3⟩: a text node, which
carries no `searchText`, never reaches `embedTexts` through this pass.

**The text pass — `embedTextPass.embedTextNodes({ nodes, embedNodeLimit, standardKey }, cb)`**, forge()
step 6b, beside the legacy pass and not on the public surface ⟨R-ET-8, R-ET-18⟩: selects the
`DmeEmbedText` nodes in array (mint) order, takes the first `embedNodeLimit` when a limit is set (the
limit bounds spend in BOTH passes, each over its own nodes), embeds `properties.text` in
`EMBED_BATCH_SIZE` batches through the unchanged `embedder.embedTexts`, and stamps
`properties.textEmbedding = Array.from(vectors[i])` and `properties.embeddingModelVersion` — the ORDINARY
name, CARRIED from the result. It writes nothing to `properties.embedding` or to the node's top level, so
the graph's `<graph>_vector` index on `ForgedNode(embedding)` never sees a text vector. Refuses by name:
a selected text node without a non-empty string `text`; a batch failure with its batch number;
`vectors.length !== texts.length`; a missing `embeddingModelVersion`. Its calls ADD to `embedCallCount`;
`skipEmbedding: true` skips it as it skips the legacy pass. The PROXY fingerprint drops `textEmbedding`
as it drops `embedding` (R-ET-9), so an embed run and a skip run hash equal; the text nodes and their
edges themselves ARE hashed.

### 6.4 Emission order — passed through untouched

The framework MUST return `nodes` and `edges` in the ORDER the walk returned them, followed by the
framework's own text nodes and edges in mint order (§6.2 step 4b): no sort, no stable partition, no
dedup of the walk's arrays ⟨RULING 23:12 #5⟩ ⟨PLAN-forgeEmbedText §8.4 R-ET-31⟩ ⟨RISK §1.4⟩ ⟨Profile §5.5⟩. Order does not reach block text —
harvest sorts nodes by `stableId` and edges by `(from, type, to)`, the serializer sorts keys and labels
`[code fact]` `replay-engine.js:709,739,813,840`, `replay-block.js:117-128,182` — EXCEPT through MERGE
collisions: `mergeNodes` is `MERGE (n:ForgedNode {stableId}) SET n += row.props` and `mergeEdges` is
`MERGE (from)-[r:TYPE]->(to) SET r += e.props` (`replay-engine.js:203-205`, `:288`), so a duplicate
`stableId` or a duplicate `(from, type, to)` triple collapses LAST-WRITER-WINS and emission order
decides the bytes. Three of the four do not refuse duplicates today. Hence: pass-through order, plus
the collision census gate G-ORDER frozen per forge, plus allowances C1/C2 ONLY where the census proves
the pinned snapshot triggers a collision (§7). The sixth-conjunct closure is qualified by that MERGE
sentence ⟨RULING 23:12 #5⟩ ⟨RISK §8.5⟩.

What the framework MAY freely re-order: nothing on the returned arrays. The embed-text derivation orders
only what it mints — text nodes by ascending `stableId`, their edges by ascending (from, to) — and never a
walk node or edge. What it MAY freely do
internally: iterate its own frozen registries in any order, because no registry order reaches a value
— EXCEPT inside stringified JSON values (`mappingInstruction`, `crossRefs`, and Ed-Fi's
`mergeDirectives`, `cg:433-435` — the walk composes it, its key order is the parser's, G-JSONKEYS lists
it ⟨REVIEW B9⟩), composed strings
(`searchText`, `path`), and array-valued properties (`sourceFiles`), all of which are pinned to
TODAY's order (§3.4, §4.1, §5.1) ⟨IMPL §0⟩ ⟨RISK §1.5, H28⟩.

### 6.5 The root — framework-built, from DECLARED data

`rootNode.build({ forgeDeclaration, metadata, describedRoot })` emits the ONE `DmeStandardRoot` in the
shape the three compliant forges emit `[code fact]` `forgeEdfiContractGraph.js:455-495`,
`forgeSif.js:366-404`, `forgeCeds.js:462-500` ⟨Profile §10.4 [design]⟩ ⟨ARCH §2.5⟩:

```
labels: [FORGED_NODE, forgeDeclaration.rootLabel, DME_ROLES.STANDARD_ROOT]
stableId: rootStableId
properties: {
  _id: rootStableId, _source: standardSource, name: standardSource, role: STANDARD_ROOT,
  [stableUriPropertyName]: rootStableId,
  searchText: buildSearchText({ role: STANDARD_ROOT, name: standardSource, standardName: standardDisplayName }),
  description: describedRoot.description            (only when defined),
  standardKey, standardName: standardDisplayName, version: metadata.version,
  sourceFormat, sourceFiles, sourceUrl,              (sourceUrl only when non-empty, or '' under E6/S4/P16)
  stableUriPropertyName, mappingInstruction: JSON.stringify(mappingInstruction)   (six keys, declared order),
  snapshotKey, publishedVersion, versionSource,      (from the stamp; omitted under P5)
  parserVersion,                                     (NEVER omitted; PESC stamps '1' today, `forgePesc260805.js:206`)
  coreVersion: CORE_VERSION,                         (omitted under P5)
  ...describedRoot.extraProperties                   (refused unless an allowance names each key — P5: pescTier)
}
```

The framework ENFORCES `REQUIRED_PROPERTIES.STANDARD_ROOT` (the eight, `vocabulary.js:521-530`)
⟨RULINGS row 5⟩ AND the five (`snapshotKey`, `publishedVersion`, `versionSource`, `parserVersion`,
`coreVersion`), refusing a root missing any of them by name unless allowance P5 is active — and P5
licenses omitting exactly FOUR (`snapshotKey`, `publishedVersion`, `versionSource`, `coreVersion`),
never `parserVersion` ⟨FR10⟩ ⟨ARCH §8.2⟩ ⟨§14 D5⟩. Root `name` is `standardSource` in all four `[code fact]` (`cg:457,471`,
`forgeSif.js:369,379`, `forgeCeds.js:464,474` (the literal `'CEDS'`), `forgePesc260805.js:189,195`); the root
`searchText` element is `{ role: STANDARD_ROOT, name: standardSource, standardName: standardDisplayName }` in
all four `[code fact]` (`cg:455-459`, `forgeSif.js:367-371`, `forgeCeds.js:462-466`, `forgePesc260805.js:193-197`); root `standardName` is
`standardDisplayName` (§4.1). `sourceFiles`/`sourceUrl` are stamped as `describeSource` returned them;
the `|| []` / `|| ''` coercions in Ed-Fi/SIF (`cg:486-487`, `forgeSif.js:394-395`) are NOT reproduced
by the framework: the `''` `sourceUrl` byte survives only through E6/S4/P16, and SIF's `[]`
`sourceFiles` byte only through S7 ⟨FR3⟩. A forge MUST NOT hand-roll the root; `describeRoot` is the only
per-standard input ⟨Profile §10.4⟩.

### 6.6 The round-trip validator file

Not in `forge()`. The stage requires `roundTripValidator.js` after materialization
(`round-trip-stage.js:120-157`, `:490-498`); under the framework that file is:

```js
module.exports = require(HARNESS)()   // lib/forge-framework/roundTripHarness/roundTripHarness — NOT the forge-time object
  .validatorFrom({ forgeDeclaration, ...require('./lib/<std>RoundTripPair')(), gateDeclarationList, twinRegistry });
```

— the APPLIED export (Profile §8.1 SHOULD), the same declaration object as the entry module
⟨ARCH §4.3⟩. The harness is a separate module required DIRECTLY by the validator file; the forge-time
framework object does not expose it, so no entry module or hook can reach a bolt session by holding the
framework ⟨FR15⟩. In v1 the harness owns the CONTRACT (§3.3 harness table, `validatorFrom`) and lets each
forge's existing canonicalizer/emitter pair AND its existing diff run behind it; the consolidation of
the four diff engines into one implementation (R2, 1,679 lines in four cousins) is deferred (§11.6,
§14 D8) ⟨RISK §6.6⟩ — it moves no block byte and can be proven by verdicts on its own schedule.

---

## 7. The compatibility declarations — `MIGRATION_ALLOWANCE_REGISTRY`

Profile §13 (binding): the four surviving forges migrate BYTE-IDENTICAL FIRST; the framework MUST
allow each forge's current behaviour so it migrates with its block id UNCHANGED; every repair is a
separate commit with a new id. The review found the counter-example that makes a MECHANISM necessary
(PESC's version stamp, REVIEW §E) and the ruling fixed the mechanism's shape: per-forge DATA
declarations, never code branches, counted by a census gate, retired one commit at a time
⟨RULINGS 23:00⟩ ⟨RULING 23:00 #1⟩.

### 7.1 The shape — ONE closed registry ⟨RULING 23:12 #1⟩

`MIGRATION_ALLOWANCE_REGISTRY` is a frozen table, one row per Profile §13.1 punch id whose repair
would move a block id (or, for C1/C2, would refuse a build) — except the `sourceUrl` row, which is ONE
row keyed three ways (P16/S4/E6) ⟨FR20⟩. Each row names: `declarableBy` (the forge(s) that may declare
it — enforced: `edfi` declaring `P4` is refused ⟨FR20⟩); the exact behaviour the framework permits
WHILE the allowance is declared; the `allowanceData` it carries (if any); its PRECONDITION and the
precondition's KIND; the retirement commit; the twin that proves it is live. The rules
⟨RULING 23:12 #1⟩ ⟨ARCH §8.3⟩ ⟨FR13⟩:

- **Two precondition kinds.** A **forge-time** row has a precondition the framework evaluates on the
  build it is running (E6/S4/P16, S2, S7, P2, P3, P4, P6, P9, C1, C2, C10, S6 — S3 and P17 retired 2026-09-01 by the versionFromStamp order, which replaced the divergence they permitted with a refusal). An
  **offline-precondition** row (P1, P5, P10, C9) has a precondition only a pre-migration probe can
  answer; its declaration entry MUST carry `probeEvidence` (the probe's name, date and result) and the
  framework checks only its PRESENCE at forge time. Retirement of a forge-time row is FORCED by the
  declared-but-unneeded rule; retirement of an offline row is a punch-list obligation, not a refusal.
- **Undeclared-but-needed → refused by name.** A forge whose output would need a forge-time allowance
  it did not declare is refused at the step in question (the strict behaviour runs).
- **Declared-but-unneeded → refused.** A forge-time allowance whose precondition is NOT met on this
  build is refused as "allowance `<id>` active but its condition is not met" — no stale no-ops.
- **Non-empty for a name outside the four → refused.** `MIGRATING_BUNDLE_LIST` is data.
- **Every active allowance is reported** in `complianceReport.activeAllowanceList` on every build and
  counted by G-COMPAT (§10) against a frozen per-forge count.
- **Retirement = one commit per allowance**, with a deliberately NEW block id and its own verdict
  ⟨RULING 23:12 #10⟩ ⟨Profile §13⟩; the punch row reads "retire declaration X".
- **No escape hatch.** Every allowance is a CLOSED enumeration over a NAMED step; there is no
  "skip the pipeline" allowance and no allowance a NEW forge may declare ⟨RISK §5 "The escape hatch"⟩.
- **When to retire (v1.1.3, 2026-08-16).** A snapshot update, a loader change, or a source that
  starts stating what it once omitted is the natural moment to retire the rows it makes unnecessary:
  the commit that bumps the snapshot or changes the loader is FOLLOWED, in the same working session,
  by one retirement commit per row it obsoletes (e.g. a snapshot whose `sourceFiles` become verified
  paths retires E8; a source that starts stating its URL retires E6/S4/P16). The registry already
  refuses a declared-but-unneeded row, so a stale row cannot sit silently — but refusing at build
  time is the safety net, not the plan; the plan is to retire on the day the precondition dies. The
  active registry is expected to SHRINK over time; a growing one is a smell.

### 7.2 The rows

Ids are the Profile v1.0.1 §13.1 ids. Rows marked *proposed* name a punch row that does not yet exist
in §13.1 and is requested (§14 D10). "kind" is forge-time (**F**) or offline (**O**).

| id | declarableBy | while declared, the framework… | `allowanceData` | precondition (needed iff…) | kind | retired by |
|---|---|---|---|---|---|---|
| **P1** | pesc | skips `finalizeStructuralContract`; the walk stamps `depth`/`crossRefs` itself (`forgePesc260805.js:236…524`) | — | probe #2 (§8.4) shows the finalizer would CHANGE at least one `depth`/`parentId` on the pinned snapshot; a neutral probe FORBIDS the declaration and the finalizer runs from day one (P1 discharged, §8.5) ⟨RISK §6.1, H8⟩ | O | removing → finalizer runs → new id (P1) |
| **P2** | pesc | does not call `deriveVersionStamp`; takes `{ snapshotKey, publishedVersion, versionSource }` from `describeSource` (`versionSource: 'aggregate-manifest'`, `:777-787`). P2 exists BECAUSE of P13 — PESC's snapshot has no `standardSourceLocation`, so the shared stamp would yield `unknown_01` (REVIEW §E) — P13 is block-relevant and retires WITH P2 ⟨FR14⟩ | — | `describeSource` returns the three keys | F | removing → framework stamp; header `version` moves from `aggregate_01` → new id (P2, P13) |
| **P3** | pesc | does not require `sequenceGroups` from a walk that stamps `sequencePosition` (`:327`) | — | nodes carry `sequencePosition` and no `sequenceGroups` returned | F | the repair adds sequence properties → new id (P3) |
| **P4** | pesc | `kit.addEdge` accepts the SEVEN listed types outside `EDGE_TYPES` — `DECLARES` (`forgePesc260805.js:284,542`), `IN_NAMESPACE`, `SAME_DEFINITION`, `IMPORTS`, `RESOLVES_TO` (`lib/derivedTier.js:705,1013`; `lib/syntheticTier.js:1786,1800`), `MERGED_FROM` (`syntheticTier.js:1384,1398`), **`SERVED_BY`** (`syntheticTier.js:1771`, asserted live by `test-pesc260805SyntheticTier.js:1203-1206`); the serializer's check is lexical only (`replay-block.js:204`) so all seven reach block text today ⟨FR1⟩ ⟨IMPL §0.4, §7.1⟩. `grep -a` is required to see `syntheticTier.js` at all — plain grep skips it as binary, which is how the count was six twice | `edgeTypeAllowList: [seven names]` | every listed name is minted at least once; a listed name minted zero times → refused (stale) | F | P4 repair: add to `EDGE_TYPES` or re-emit under registry names — TQ's vocabulary call → new id |
| **P5** | pesc | omits exactly FOUR root properties — `snapshotKey`, `publishedVersion`, `versionSource`, `coreVersion` (`:198-207`; PESC DOES stamp `parserVersion: '1'`, `:206`, never licensed) ⟨FR10⟩ — and accepts `describeRoot.extraProperties` naming `pescTier` (`'meta'`, provisional, Profile §14) | `rootOmitPropertyList: [four]`, `rootExtraPropertyNameList: ['pescTier']` | by construction (the framework would otherwise stamp them); declared-but-unneeded cannot occur — hence offline | O | removing → the four stamped → new id (P5) |
| **P6** | pesc | accepts an OPTION_SET-role node with ZERO `HAS_VALUE` children (enumeration values as a JSON array, `:418-419`) | — | at least one OPTION_SET-role node with no `HAS_VALUE` child | F | the expansion → new id (P6) ⟨RULINGS row 1⟩ |
| **P9** | pesc | `makeNode` stamps `name: ''` when absent, and the walk's `description`/`documentation` `''` pass through `carriedProperties` (`:141-143`) | `coerceEmptyStringPropertyList: ['name','description','documentation']` | at least one node received the coercion | F | RT-2 repair → new id (P9) |
| **P10** | pesc | `stableIdPattern` is the permissive constant `PERMISSIVE_STABLE_ID_PATTERN` (`{ pattern: '^\\S+$', trimmed: true }`) | — | probe #9 (§8.4) records PESC's id shapes; the declaration uses the constant | O | declare a real pattern, prove zero refusals; byte-neutral → its own commit (P10) |
| **P16 / S4 / E6** (one row, three ids) | pesc / sif / edfi | stamps root `sourceUrl: ''` when `describeSource` returns `''` (`:203,785`; `forgeSif.js:395`; `cg:487`) | — | `describeSource` returns `sourceUrl === ''` | F | omit `sourceUrl` (Profile §10.4) → new id, each forge in its own commit |
| **S2** | sif | `makeNode` stamps `name: ''` when null (`forgeSif.js:350`) | `coerceEmptyStringPropertyList: ['name']` | at least one node received it | F | RT-2 repair → new id (S2) |
| **S3** | sif | root `version` (`'1.0'`, `sif/lib/parser.js:943`) may differ from `selfDescribedVersion ?? 'unknown'` (`null` → stamp `unknown`, header `sif@unknown_01`, `forgeSif.js:762-765`) ⟨FR2⟩ | — | `version !== (selfDescribedVersion ?? 'unknown')` | F | SIF's parser reports a real source version (or the root carries `'unknown'`) → new id (S3) |
| **S7** *new* | sif | root `sourceFiles: []` reproduced (`sif/lib/parser.js:942-955` returns none; `forgeSif.js:394` stamps `[]`) ⟨FR3⟩ | — | `describeSource` returns `sourceFiles.length === 0` | F | the SIF loader reports its files → new id (S7) |
| **C1** | ceds, sif, pesc260805 (any whose census is nonzero) | dangling endpoints RECORDED, not refused; the write path drops them (`replay-engine.js:275-310`), so the block is unchanged | — | the frozen collision census (§8.4 #1) shows `danglingEndpointCount > 0` on the pinned snapshot; a census of zero forbids the declaration | F | the universal refusal → byte-neutral, its own commit (C1) |
| **C2** | ceds, sif, pesc260805 (same) | duplicate stableIds COUNTED, not refused; MERGE collapses last-writer-wins, so emission order is load-bearing (§6.4) | — | the frozen census shows `duplicateStableIdCount > 0` | F | the universal refusal → byte-neutral iff no collision, its own commit (C2) |
| **C9** *proposed* | ceds | permits a declared `legacyIdMint({ stableId, canonicalCedsId }) => string` so the kit stamps `_id = 'ceds:<canonicalCedsId>'` (`forgeCeds.js:108-109,225`) instead of `stableId` — byte-INVISIBLE (§4.2), FORGE-OUTPUT-visible only | `legacyIdMint` function | probe #3 (§8.4) finds an in-bundle reader of `properties._id`; none → C9 MUST NOT be declared | O | remove → `_id === stableId` → same id (C9) |
| **C10** *proposed* | ceds | `kit.carriedProperties` ALSO excludes `''` values (CEDS's `!== undefined && !== ''`, `forgeCeds.js:312`) ⟨FR7⟩ | `carryExcludeEmptyString: true` | probe #12 finds at least one CEDS carried field that is `''` today | F | Ed-Fi's `!== undefined` filter → new id iff any `''` existed (C10) |
| **S6** *proposed* | sif | `kit.addEdge` applies the declared `parentEdgeSubstitutionTable` when a `_parentEdge` type is outside SIF's translation registry (`forgeSif.js:652` `canonical \|\| EDGE_TYPES.REFERENCES`); the census counts each substitution ⟨FR20⟩ | `parentEdgeSubstitutionTable: { [nativeType]: 'REFERENCES' }` | `substitutionCount > 0` on this build (census #1 forbids the declaration at zero) | F | refuse unknown type → byte-neutral, its own commit |

Not allowances (and why): `nonEmbeddableRoleList` — permanent H1 data (Profile §4.6 makes it a
framework concept, §14 D7); nameless nodes — `name` is optional at mint (§3.4, ⟨FR4⟩), CEDS's four
foreign vocabulary terms (`forgeCeds.js:413`) need nothing; the template-built root descriptions (C8,
S5, P17 and Ed-Fi's `cg:472-475`, §14 D9) — not machine-distinguishable from a source-stated string,
enforced by review; P7, P8, S1, P11/C5 — refusal-side or rename repairs the framework DISCHARGES by
construction (§8.5, §14 D6); P12, P14, E1, E3, A1 — validator- or test-side, no block bytes ⟨IMPL §5,
§7.7⟩ ⟨RISK §4.1⟩; C7 and E5 — stub loggers INSIDE loader code that becomes a hook, NOT discharged
(§8.5, ⟨FR14⟩); P15 — discharged only when the F3d call-site probe proves it (§8.5, ⟨FR14⟩).

### 7.3 Per-forge declaration counts — what the order falls out of ⟨FR13⟩

Single frozen numbers per forge (what G-COMPAT asserts EQUALITY against), with the conditional rows
listed separately; a conditional row that a probe/census turns ON raises the frozen number by one
BEFORE the migration commit and the frozen file is updated in that commit.

| forge | frozen at migration | frozen count | conditional (probe/census decides before migration) |
|---|---|---|---|
| edfi | E6 | **1** | — |
| sif | S2, S3, S4, S7 | **4** | S6 (census #1), C1/C2 (census #1) |
| pesc260805 | P2, P4, P5, P6, P9, P10, P16 | **7** | P1 (probe #2), P3 (present by construction today — declared unless the migration adds `sequenceGroups`), C1/C2 (census #1) |
| ceds | — | **0** | C1, C2 (census #1), C9 (probe #3), C10 (probe #12) |

The papers counted Ed-Fi at zero ⟨IMPL §7.7⟩; the Profile v1.0.1 §10.4 rule on `sourceUrl` adds E6.
Ed-Fi remains the proving case: E6 is a value-only allowance with a one-line precondition, and it is
the only allowance whose retirement is identical in three forges. Profile §13's "a forge at zero
declarations is fully compliant" is TRUE only for the machine-checkable rules; Ed-Fi's template root
description (D9) remains a review-enforced punch row after E6 retires ⟨REVIEW G3⟩.

---

## 8. The migration recipe

### 8.1 The order — Ed-Fi → SIF → PESC → CEDS ⟨RULING 23:12 #6⟩

| step | forge | why here | what its migration PROVES ⟨RISK §4.2⟩ |
|---|---|---|---|
| 1 | **edfi** (`aea6d8df…`) | already obeys the Profile most: duplicate refusal, validated `addEdge`, RT-2 `makeNode`, registries as data, the finalizer, `deriveVersionStamp`, extracted intake; one allowance (E6); risk entirely in VALUES (`searchText` ladder, root display text, `sourceFiles` order, `mappingInstruction`/`crossRefs` key order, `parserVersion`); a three-loader H2 that proves the N-loader form ⟨IMPL §1.4, §6⟩ | that a compliant forge can be re-expressed on the framework — the FRAMEWORK is right |
| 2 | **sif** (`d393b040…`) | adds `finalizeSequence` with hook-supplied groups (the two-finalizer ORDER), a positional H2 wrapped in an adapter, a two-input directory parse (the second input DECLARED), four allowances (S2, S3, S4, S7), one silent branch to measure (S6) ⟨IMPL §2.4, §6⟩ | that the MIGRATION MECHANISM (a compatibility declaration) works — the plan's own second proof (F3c) |
| 3 | **pesc260805** (`db885ac4…`) | exercises every remaining allowance at once (finalizers, version stamp, seven edge types, coercions, permissive pattern, root omissions), a composed three-tier walk over mutable nodes, the `owningName` search-text case; its block is not the one the DME resolves against ⟨IMPL §4.4, §6⟩ | that the allowances COMPOSE — where a wrong policy design shows |
| 4 | **ceds** (`09a5d658…`, hub-bearing) | highest structural risk (`_id`, non-embeddable roles, measure-first C1/C2, annotation precedence, address slots via `carriedProperties`), the biggest validator, the block the DME reads; its hub is forger-side and untouched throughout ⟨IMPL §3.4⟩ ⟨RISK §4.1⟩ | that the framework carries the hub standard without a hub hook |

Why NOT PESC or CEDS first: a first proving case must fail for framework reasons only; PESC and CEDS
would each fail for three reasons at once and the diff could not tell them apart ⟨IMPL §6⟩. "Proven on
one is proven on none" (PLAN F3c) is sharpened: proven on Ed-Fi proves the framework; on SIF, the
mechanism; on PESC, that the allowances compose; the DEVLOG records which was proven when the night
ends ⟨RISK §4.2⟩.

### 8.2 The thin-file shape — Ed-Fi, whole ⟨ARCH §5.1⟩

`forges/edfi/forgeEdfi.js` after migration:

```js
'use strict';
const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
// forgeEdfi.js — the Ed-Fi forge bundle on the Forge Framework. The framework owns the pipeline,
// the adapter, the root, the embed pass and the return; this file owns nothing but the wiring.
const path = require('path');
const forgeFramework = require(path.join(__dirname, '..', '..', 'lib', 'forge-framework', 'forge-framework'));
const forgeDeclaration = require('./lib/edfiForgeDeclaration');   // H1 — data (§4)
const edfiHooks = require('./lib/edfiHooks')();                    // H2/H3 — sourceLoaderList, describeSource, emitContractGraph, describeRoot

const moduleFunction =
	({ moduleName } = {}) =>
	({ embedder } = {}) =>
		forgeFramework({ embedder }).injectStandardHooks({ forgeDeclaration, hooks: edfiHooks });

module.exports = moduleFunction({ moduleName });
```

Where the current 280 lines go ⟨ARCH §5.2⟩ ⟨IMPL §1.1⟩: header/requires/`EMBED_BATCH_SIZE` (1-50) —
deleted (D23, D6); `embedNodes` (61-105) — deleted (D5); the orchestrator, adapter, embed stage,
`pipeRunner`, return (114-116, 199-266) — deleted (D3, D4, D7); the three loader stages (117-168) →
`sourceLoaderList` of three entries, ~15 lines of data in `edfiHooks.js`; metadata + stamp (170-197)
→ `describeSource`, ~10 lines; export surface (269-275) — built by `injectStandardHooks`. In
`forgeEdfiContractGraph.js` (1,120 lines): the constants (57-63) and `edfiMappingInstruction` (68-75) →
the declaration; `isCleanStableId` (216-221), `normalizeCedsCrossRef` (235-247), `searchTextElementFor`
(272-297), `registerStableId` (336-345), `addEdge` (353-382), `makeNode` (385-424), `carriedScalars`
(426-), the root (452-495), the dangling terminal check (1108-1113), the finalizer call (1115) → deleted,
replaced by kit calls. What remains is the walk: `CONSTRUCT_ROLE_REGISTRY` (85-108),
`PROPERTY_REFERENCE_EDGE_REGISTRY` (141-166), the carry lists (184-201), the identity rule (21-27), the
passes over constructs / properties / descriptors / option values / crosswalk annotation, and the
per-standard refusals of malformed STANDARD content (547-549, 561-566, 761-762, 888-889) — Profile
§7.2 keeps those in the hook. Roughly 230 lines shed from the entry module and 250 from the contract
graph, every one an Author A D-row; ~800 lines of walk remain, all Ed-Fi.

### 8.3 The other three — where the code goes and which allowances

| forge | H1 additions beyond Ed-Fi's | H2 | H3 | allowances |
|---|---|---|---|---|
| **sif** | `standardDisplayName 'SIF Implementation Specification'`, `stableUriPropertyName 'sifStableId'`, `stableIdPattern { pattern: '^sif:[A-Za-z]+(/.+)?$', trimmed: true }`, `cedsAnchorAbsentSentinelList []`, `parserVersion '1'`, `additionalSourceInputList [{ inputName: 'refIdResolutionMap', relativePathFromSourcePath: 'refIdResolutionMap.tsv' }]` | ONE loader wrapping the positional `parseSif(sourcePath, { resolutionMapPath }, cb)` (S1's adapter), passing `resolutionMapPath = additionalSourceInputPathByName.refIdResolutionMap` — the DECLARED second input, never located by search ⟨FR20⟩; `describeSource` returns NO `version` (the TSV declares none; the parser's hard-coded `'1.0'` was deleted and the root's version comes from the provenance stamp — versionFromStamp order, f87f7da, 2026-09-01; allowance S3 retired) and `selfDescribedVersion null`, and `sourceFiles []` under S7. *(Stale text corrected 2026-09-02, Lane B; the `additionalSourceInputList` entry this row prescribes is NOT what was built — see Profile §13.1 S3 clause 2 and `WORKORDER-standDownBacklog-090226.md` §5.)* | the walk with `roleSpecByNativeLabel`, `naturalKeyByKind`, `edgeTypeTranslation`, `ownershipEdgeForKind`, `FIELD_CHARACTERISTICS_DERIVATION`, the codeset dedup, the TWO sibling-group families returned as `sequenceGroups.orderingByParent`, every group carrying `orderSemantics: 'document'` (`forgeSif.js:238-280,511-567`) ⟨FR5⟩; `depthByKind` deleted (dead under the finalizer) | S2, S3, S4, S7 (+S6, C1/C2 iff census) |
| **pesc260805** | `standardDisplayName` (its `STANDARD_DISPLAY`), `stableUriPropertyName 'pesc260805StableId'`, `stableIdPattern PERMISSIVE_STABLE_ID_PATTERN` (P10), `rootLabel 'Pesc260805Root'`, `parserVersion '1'` | ONE loader `parsePescCorpus({ sourcePath }, cb)`; `describeSource` returns `version 'aggregate-01'` and **`selfDescribedVersion null`** — ⚠ CORRECTED 2026-08-29 (hub-kit-role Phase 4): this table said `selfDescribedVersion 'aggregate-01'` (its own claim), which would stamp `versionSource 'spec'` and assert that PESC's source self-describes a whole-family release it does not publish. It returns null, the snapshot's `standardSourceLocation` (added under FJ-P4-7) supplies `publishedVersion aggregate-01`, and the stamp resolves `versionSource 'provenance-file'`. The version disagreement that follows is licensed by **P17**, a row this table predates | ONE walk composing `buildSourceTierGraph` → `buildDerivedTier` → `applyDerivedTier` (mutates minted nodes) → `buildSyntheticTier` → concat, all creation through the kit; `pescTier` on every node via `carriedProperties` and on every edge via `edgeProperties` — passed EXPLICITLY at EVERY `addEdge` call site in `forgePesc260805.js`, `lib/derivedTier.js`, `lib/syntheticTier.js` (P15's `\|\| PESC_TIER.SOURCE` default lived in PESC's own five-argument `addEdge`, `:175`, and does not exist in the kit) — the F3d probe COUNTS the call sites and P15 is discharged only when every one is proven to pass it ⟨FR14⟩; the SEVEN edge types under P4; `depth` via `carriedProperties` under P1 (iff probe); no `sequenceGroups` under P3; enumerations as JSON under P6; `describeRoot.extraProperties { pescTier: 'meta' }` under P5 | P2, P4, P5, P6, P9, P10, P16, P3 (+P1 iff probe, C1/C2 iff census) |
| **ceds** | `standardDisplayName 'Common Education Data Standards'`, `stableUriPropertyName 'uri'`, `stableIdPattern { pattern: '^https?://\\S+$', trimmed: false }`, `rootStableIdFrom 'sourceUrl'`, `rootLabel 'CedsOntology'`, `nonEmbeddableRoleList [EDIT_HISTORY_ENTRY, RESTRICTION, VOCABULARY_TERM]`, `parserVersion '1'`, `mappingInstruction` = `emptyMappingInstruction` | ONE loader `parseCeds({ sourcePath, xLog }, cb)` | the four loops migrated AS the walk first (byte-identical; the registry rewrite is C3, its own commit); `canonicalFor`'s second-form try (`:139-152`) stays hook logic calling `kit.cedsAnchorValue`; annotations through `precedingProperties` — NOTE today CEDS spreads `annotations` LAST on vocabulary terms (`forgeCeds.js:424`) where the kit spreads `precedingProperties` FIRST: probe #11 measures whether any annotation key collides with a universal name on the pinned snapshot; a collision needs an allowance row before migration ⟨FR7⟩; the four foreign vocabulary terms without `name` (`:413`) need nothing (§3.4); address slots (`hubName`, `hubVersion`, `canonicalKey`, `domainId`, `rangeOptionSetId`, `rangeClassId`, `rangeDatatype`), `cedsId`, `cedsOriginalAnchorPropertyName: ['dc:identifier']`, `declaredTypes`, `foreignRangeRefs`, `notation` through `carriedProperties` (the framework does not interpret them; §11); the self-reference `crossRefs` via `kit.crossRefsJson`; the hub is NOT touched (forger-side `HUB_FORGE_BY_STANDARD`, `forger.js:407-412`) | (C1, C2 iff census), (C9 iff probe #3), (C10 iff probe #12) |

### 8.4 Pre-migration census probes — run BEFORE the first framework line for each forge ⟨RISK §4.3⟩ ⟨IMPL §7.5⟩

Each is cheaper than a build, needs no container, and its result is FROZEN into the framework's test
fixtures. None writes into a tracked path ⟨Profile §12⟩.

1. **Collision census** — `census.collisionCensus` over the forge's CURRENT pure output: duplicate
   stableIds, duplicate `(from, type, to)` triples, dangling endpoints. Freezes G-ORDER's expected
   value; decides whether C1/C2 (and S6's parent-edge count) may be declared.
2. **PESC finalizer neutrality** — run `finalizeStructuralContract` over PESC's current output; diff
   `depth`/`parentId`/`crossRefs` per node. Empty → P1 MUST NOT be declared and P1 is discharged by
   migration; non-empty → P1 declared, and the diff IS the P1 punch-list evidence.
3. **`_id` readers in CEDS** — `grep -an 'properties\._id\|\._id\b' forges/ceds/` between mint and
   return, and in the hub fold's inputs. None → C9 not declared; M5's closure is safe for CEDS too.
4. **`_source` literal equality** — the four descriptors' `standardName` vs the four `_source`
   literals (G-SOURCE's data).
5. **searchText element census** — dump `{ role, name, owningName, standardName, owningClassName,
   optionSetName }` per role per forge from the current ladders (`forgeSif.js:214-229`, `cg:272-297`,
   `forgePesc260805.js:494-513`, CEDS's literals `forgeCeds.js:511-515,668-672,718-722,777-782`); this
   is the DATA `kit.searchTextElementFor` must reproduce, and the per-node compare in the migration
   diff reads it.
6. **Ed-Fi locale** — run the pure layer under `LC_ALL=C` and `LC_ALL=en_US.UTF-8`; compare
   (`metaEdSourceLoader.js:55-56` `localeCompare`, Profile §5.5 [inferred]).
7. **PESC vocabulary** — count edges of each of the SEVEN types (`DECLARES`, `IN_NAMESPACE`,
   `SAME_DEFINITION`, `IMPORTS`, `RESOLVES_TO`, `MERGED_FROM`, `SERVED_BY`) on the pinned snapshot with
   `grep -a` over all three emitters: P4's `edgeTypeAllowList` precondition data ⟨FR1⟩.
8. **CEDS `_id` and root** — confirm root `stableId === metadata.sourceUrl` and root `name 'CEDS'`
   (`forgeCeds.js:469-481`).
9. **stableId whitespace** ⟨FR6⟩ — per forge, count stableIds containing whitespace and stableIds
   that fail the REAL predicate (§4.1); PESC's shapes recorded as P10's `probeEvidence`.
10. **`typeof name`** ⟨FR7⟩ — per forge, count nodes whose `name` at mint is not a string (Ed-Fi
    stamps `` `${name}` `` at `cg:409`, SIF at `forgeSif.js:350`); any non-string → an allowance row
    before migration.
11. **Annotation-key collision** ⟨FR7⟩ — on the pinned CEDS snapshot, count `annotations` keys that
    collide with a universal property name (`forgeCeds.js:213-223`, `:424`); nonzero → an allowance row.
12. **Carry-list `''` exclusion** ⟨FR7⟩ — count CEDS carried fields whose value is `''` today
    (`forgeCeds.js:312`); nonzero → C10 declared.
13. **PESC `addEdge` call sites** ⟨FR14⟩ — count every `addEdge(` call in `forgePesc260805.js`,
    `lib/derivedTier.js`, `lib/syntheticTier.js` (`grep -a`) and whether each passes `pescTier`; P15 is
    discharged only when the count of implicit-default calls is zero after migration.

### 8.5 The migration commit and what it discharges

> **v1.1.1 (supervisor, 2026-08-16 05:05, ruling FB1):** discharge is PER FORGE. A migration commit discharges only the rows of THE FORGE IT MIGRATES; rows of other forges that the framework performs by construction discharge with THOSE forges' migration commits. F3b's Ed-Fi commit therefore discharged no P*/C* row.

Each forge's migration is ONE commit: the thin entry module, the declaration, the hooks file(s), the
deletions, the frozen census values, and — in the SAME commit, because they change no block byte and
the framework performs them by construction — the repairs the framework discharges: P7 (pure layer exported as
`buildContractGraph` AND covering the WHOLE composition — source, derived, synthetic tiers — so gate 4
covers everything that reaches the block, `Profile §13.1 P7`), P8 (no stub logger in the deleted entry
module: the framework refuses an absent `xLog`), S1 (the positional signature lives behind a loader
adapter), P11/C5 (forge-time checksum verification for every forge, universal from day one), and P1
WHEN probe #2 is neutral (the finalizer runs; the discharge line cites the probe) ⟨FR20⟩. NOT
discharged by migration ⟨FR14⟩: C7 (`forges/ceds/lib/parser.js:434`) and E5
(`forges/edfi/lib/metaEdParser.js:100`) — stub loggers INSIDE loader code that becomes a hook, which the
framework never enters; G-NOSUB's stub-logger grep turns them RED until their own commits; and P15,
discharged only when probe #13 proves zero implicit-default `addEdge` calls. The migration commit
message names each discharged row ⟨§14 D6⟩ ⟨RISK §8.2⟩. Every OTHER punch row is
its own later commit with its own block id ⟨Profile §13.1 preface⟩ ⟨RULING 23:12 #10⟩.

### 8.6 The BLOCK diff procedure — when a migrated forge's id differs ⟨RULING 23:12 #10⟩ ⟨RISK §4.4⟩

The comparison is between BLOCKS, never between forge outputs: CEDS's forge OUTPUT bytes change under
the framework (`_id`, if C9 is not declared) while its block cannot ⟨ARCH §5.3⟩. Both blocks sit in a
`standardsDatabase` (`schemaBlocks` text).

1. Extract both block texts.
2. Header line first — a difference there is the version triple (P2/H21), the embedder model, or
   `stableUriPropertyName`; nothing below need be read until it is fixed.
3. Line-set diff (sort both, `comm`): only-in-old = lost or changed; only-in-new = added or changed;
   pair by `ref.id` / edge triple.
4. Per paired node line, key-by-key diff of the sorted properties → names the hazard: a helpful
   default added (`''`, `depth`, a root field), JSON key order (`mappingInstruction`, `crossRefs`), a
   literal (`coreVersion`, `parserVersion`, `standardName`), `searchText` (and with it `embeddingRef`),
   `embeddingRef` appeared or vanished (non-embeddable / limit).
5. Node-count difference with matched ids → a collision changed outcome (§6.4) or an expansion (P6).
6. **The rule:** the framework is edited until the diff is EMPTY — unless every remaining line maps to a
   named punch row for THAT forge, in which case the migration is wrong (it folded a repair) and is
   unwound until the diff is empty. There is no third outcome. The framework yields to the bytes unless
   the Profile says the bytes were wrong, and even then the migration ships the old bytes.
7. Freeze the diff tool's output for the successful run; the tool's own twin: diff a block against
   itself with one byte flipped and watch it report the line.

---

## 9. The acceptance test

**Compare like with like** ⟨FR9⟩. For each forge the F3 builder FIRST runs the frozen per-forge command
(§9.2) over the UNMIGRATED forge and freezes the block id it produces in
`acceptance/expectedBlockIds.json` (with the run directory and date); THEN migrates; THEN runs the same
command over the migrated forge. A forge on the framework is ACCEPTED when (1) its block id EQUALS
that frozen pre-migration id, (2) the round trip is clean or carries the same named `lostTotal` backlog
as before with `inventedTotal` 0, (3) `-goldEvalCheck` PASS on the run directory, and (4) the
`fourWithHub-baseline` manifest EQUALS `97c618c2…` — after Ed-Fi alone (the other three unchanged)
and again after all four ⟨Profile §13.2⟩ ⟨PLAN F3b⟩ ⟨BRIEF⟩. The manifest is the FINAL proof; the
per-forge ids are the working proof.

### 9.1 The reference ids — measured under `fourWithHub-baseline` ⟨BRIEF⟩ `[code fact]` `DEVLOG-rootAndBranch.md:167-172, 188-189, 691-692`

| forge | block id (`standardBase`) as measured under `fourWithHub-baseline` (G1) | per-forge acceptance recipe |
|---|---|---|
| edfi | `aea6d8dfe7899adef57c5ac3adb6b0df2bfc7e4a4ae859c4fa3893c132c8b304` | `edfiOnlyRoundTrip` |
| sif | `d393b0406d08f613f3142711fca5a9f2b0c580e84c4bef3ffd6b18d4eaa2330a` | `sifOnlyRoundTrip` |
| pesc260805 | `db885ac42b284135a37135a0fb95baf376547fe401530506cc321f36686a9e61` | `pesc260805OnlyRoundTrip` |
| ceds (hub-bearing) | `09a5d658807b9c22b44b28289d9ad4b47df15e45f44c9eacec765962fe487c33` | `cedsOnlyRoundTrip` |
| four-forge manifest | `97c618c20e07c0c612957def69164402d364a98d5dfee865faacae1deace6382` | `fourWithHub-baseline` |

These five ids come from ONE run: the G1 golden build of `fourWithHub-baseline` (`DEVLOG:167-172`),
with the round-trip stage on, the warm canonical cache, and NO explicit `--vectorize` flag —
`build.js:555-559` defaulted it true ⟨REVIEW G7⟩. They are the REFERENCE the manifest proof asserts;
they are NOT the ids G-ID asserts per forge — those are MEASURED by the F3 builder on each unmigrated
forge under §9.2's command ⟨FR9⟩. The `*OnlyRoundTrip` recipes differ from their stage-off siblings
only in `recipeName`, `description` and `roundTripStage: true` `[code fact]` `diff recipes/edfiOnly.recipe.jsonc
recipes/edfiOnlyRoundTrip.recipe.jsonc`; whether a single-forge build reproduces the four-forge id for
that member is exactly what the pre-migration measurement answers, and the F3 builder records both
numbers side by side (a difference is a header-token difference, not a defect) ⟨RISK §4.5⟩.

### 9.2 The frozen command — ONE committed line per forge, run twice ⟨RULING 23:12 #7⟩ ⟨FR9⟩ ⟨RISK §3 "On the pinned command"⟩

Committed under `lib/forge-framework/test/acceptance/acceptanceCommands.jsonc`, keyed by `standardKey`,
and G-ID runs EXACTLY it (from `system/code/educoreForge`, nohup-detached with PID and log, `[code fact]`
the form of the G1 golden build, `DEVLOG-rootAndBranch.md:169-172`):

```
node --max-old-space-size=20000 apps/graph-builder/graphBuilder.js -build \
  --recipePath=recipes/edfiOnlyRoundTrip.recipe.jsonc \
  --vectorize=true \
  --standardsDatabaseFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/graphBuilder/forgeFramework_edfi_<preMigration|migrated>.standardsDatabase.sqlite3 \
  --embeddingCacheFilePath=/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorCache/vectorCache.sqlite3 \
  </dev/null > /Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/buildLogs/forgeFramework/edfi-<preMigration|migrated>/build.log 2>&1 &
```

Run ONCE before migration (`preMigration`) and ONCE after (`migrated`); the two `<…>` tokens are the
only variation and both paths are explicit ⟨FR9⟩. Pinned: `--vectorize=true` stated explicitly even
though `build.js:555-559` defaults it true, because
`vectorize` is a CLI flag not a recipe field and a stage-off/vectorize-off run mints a different id
trivially ⟨RISK §0.2⟩; the WARM cache by absolute path (block bytes are cache-independent —
`embeddingRef = sha256(model NUL searchText)`, never the vector — but the run's cost and duration are
not) ⟨RISK §1.3⟩; the round-trip stage inside the recipe; `</dev/null` (graphBuilder blocks on non-TTY
stdin) ⟨PLAN⟩; heap 20000; a SCRATCH `standardsDatabase` under `system/dataStores/graphBuilder/`, never
the golden's. A frozen id compared against a run with a different flag set is not a failed gate; it is
a broken test. Then `node apps/graph-builder/graphBuilder.js -goldEvalCheck --buildLogDirPath=<run dir> </dev/null`
→ PASS ⟨Profile §11.2⟩. Containers are `DEV_<label>` and disposed ⟨GNC-001⟩ ⟨PLAN "Hard lines"⟩.

### 9.3 Equality, and the PROXY

G-ID asserts EQUALITY of the migrated forge's id with the frozen 64-hex string MEASURED on the
unmigrated forge under the same command — never "a block was produced" or "the id is 64 hex"
⟨RULING 23:12 #7⟩ ⟨FR9⟩ ⟨RISK §3⟩. The migration gates need the licensed Ed-Fi MetaEd bytes
(gitignored, `forges/edfi/parserDescriptor.ini:23-25`) and Docker: they are ONE-MACHINE-ONLY and
licence-gated, said here by name (Profile §12) ⟨FR17⟩. G-ID-CHEAP (`fingerprint.pureLayerFingerprint`
against a frozen per-forge fingerprint) is ALLOWED as a unit-time proxy and MUST be labelled `PROXY`
in every report line: it cannot see MERGE collapse, the header, or the hub fold, and a green proxy is
not a green G-ID. G-ID runs at every phase boundary regardless ⟨RISK §3⟩.

---

## 10. The gate suite — every gate with the RED TWIN that turns THAT gate red

Conventions ⟨Profile §11.1, §11.3⟩ ⟨RISK §3⟩ ⟨RULING 23:00 #4⟩ ⟨FR20⟩: every gate ASSERTS, never
merely computes; UNPROVEN and UNMEASURED are failures; no standing `expectFail: true`; a gate that
asserts EXISTENCE where the rule states an IDENTITY is under-enforcement and does not count; every
twin faults PRODUCTION input or configuration, not the gate's own expectation; every twin is
registered in DATA keyed by **gateId + conjunct** with its `leverKind`, and G-SWEEP counts observed-red
PER CONJUNCT — a gate with four conjuncts and one twin reports three UNPROVEN, not "observed red"; the
registry is audited for missing/orphaned implementations; the sweep itself has a twin (G-SWEEP). Every
gate MUST have been observed RED before it was made to pass — a gate never seen failing is unproven
⟨Profile §11.1⟩ ⟨polyArch2⟩. Where a gate below lists several conjuncts, "(each)" in the twin column
means one registered twin per conjunct.

The suite runs hermetically over a **fixture forge** — a tiny toy standard under
`lib/forge-framework/test/fixtures/toyForge/` with committed source, `SHA256SUMS`,
`README_PROVENANCE.md`, `standardSourceLocation`, descriptor, declaration, hooks, round-trip pair,
bundle-root `package.json`, `README_ERRATA.md`, and the validation-certificate pair — a forge that
itself satisfies every Profile MUST a new forge owes ⟨FR18⟩ — so no licensed bytes and no container
are needed for the unit gates ⟨ARCH §7.2⟩ ⟨Profile §12 "licensed source inside a gate"⟩. Where a
twin needs the toy INSIDE the four (C2, P5), the test installs a test-only `MIGRATING_BUNDLE_LIST`
override, registered `shippedConfig: false`, and a separate conjunct asserts the override is ABSENT
from shipped configuration ⟨FR20⟩. G-ID/G-BLOCK/G-CENSUS/G-RT-LIVE need a build and are the
F3b/F3c/F3d proofs (§10.2).

### 10.1 Framework unit gates (fixture, no container)

| id | gate — what it asserts | RED TWIN | leverKind | equality or existence |
|---|---|---|---|---|
| **G-SEAM** | `require(fixtureEntry)({ embedder: null })` is a function of ONE object arg returning `{ forge, buildContractGraph, … }` under those names; `forge.length === 2`; `forge` calls back `('', result)`; the return carries `nodes[]`, `edges[]`, `metadata.{version,snapshotKey,publishedVersion,versionSource}`, numeric `embedCallCount`, `standardKey === bundle dir`, `stableUriPropertyName` naming a property every node carries, `embeddingModelVersion` beside every `embedding`; a Proxy argument object permits reads of `sourcePath`, `embedNodeLimit`, `skipEmbedding` ONLY and throws on any other read — `owner` included ⟨FR12⟩; a fifth key refused by name; an ABSENT `embedder` key at the factory refused; a `{ embedder, driver }` factory call refused | (each): rename the pure export `buildSourceTierGraph` (P7 shape) → red; `embedCallCount: '0'` → red; drop `metadata.snapshotKey` → red; a test double that reads `owner` → the Proxy throws → red; pass a fifth key → refused; call the factory with `{}` → refused naming `embedder` | inputFault / productionMutation | names EXIST + values EQUAL declared tokens/types |
| **G-DECL** | one twin PER required declaration key (drop it → refused naming it); unknown key → refused; each closed value (`rootStableIdFrom: 'newest'`) → refused; unknown allowance id → refused; an id outside `declarableBy` (`edfi` + `P4`) → refused; an offline row without `probeEvidence` → refused; `mappingInstruction` with permuted or missing key → refused; non-`DME_ROLES` in `nonEmbeddableRoleList` → refused; non-empty allowance list on a `standardKey` outside the four → refused; `stableIdPattern` not `{ pattern, trimmed }` → refused | (each) | inputFault | existence of the NAME in the refusal text (the assertion IS about naming) |
| **G-HOOK** | missing hook; unknown hook name (`parseV2`); wrong arity; duplicate `loaderName`; `loaderName: 'metadata'`; `describeSource` returning four keys of five, an undeclared key, or `version !== (selfDescribedVersion ?? 'unknown')` without S3; `sourceFiles` empty without S7; a declared `additionalSourceInputList` entry absent on disk; a walk returning a foreign node object → each refused by name at inject or first run | (each) | inputFault | name in refusal text |
| **G-KIT** | duplicate stableId (both origins named); unclean stableId under the REAL predicate incl. the trim conjunct; bare-string edge type; retired `*_MAPPING` type; cross-source endpoint; dangling endpoint (count + first offender in text); `carriedProperties` colliding with a universal name; caller-supplied `_id`; unknown role; empty searchText; a non-string `name`; a `null`/absent `name` → node minted with NO `name` property and `namelessNodeCountByRole` incremented (never `''`) ⟨FR4⟩; a POST-MINT write of `_id`, `role`, an empty `searchText`, or a non-vocabulary edge `type` → refused by the §6.2 step-4 re-check ⟨FR15⟩ | (each); for the post-mutation conjuncts a fixture walk that writes `node.properties._id = 'x'` after minting → red | inputFault / productionMutation | name in refusal text; EQUALITY of the nameless count |
| **G-REFERENT** (Profile 11.3 5(d)) ⟨FR18⟩ | every non-root `parentId` names a MEMBER stableId; a `parentId` naming an `_id` value or nothing is refused with the "wrong referent stamped" / "unresolvable" diagnostic (`structural-contract.js:108-145`) | point one fixture node's `parentId` at another node's `_id`-form value → refused with the diagnostic; at a non-member → refused | productionMutation | name in refusal text |
| **G-ROOT** | exactly one `DmeStandardRoot`; the eight + `parserVersion` + (`snapshotKey`, `publishedVersion`, `versionSource`, `coreVersion` unless P5) present non-empty; refused by name otherwise; a `describeRoot` returning `extraProperties` without an allowance → refused; a P5 declaration never licenses omitting `parserVersion` ⟨FR10⟩ | drop `mappingInstruction` → refusal names it; emit two roots → finalizer refuses; strip `snapshotKey` without P5 → refused; with P5 (pesc fixture data) strip `parserVersion` → refused | inputFault / productionMutation | existence of fields (that IS the requirement) + count EQUALS 1 |
| **G-DET** | two `buildContractGraph` runs over one `parsed` are byte-identical after canonical sort (mirroring `replay-block`); two `forge()` runs on ONE framework instance are byte-identical (no per-build state, §3.1); static grep of the framework tree AND the fixture hooks for `Date.now\|new Date\|Math.random\|process.hrtime\|crypto.randomBytes` → zero | a fixture hook that stamps a run counter into one stableId → runs differ; a `Date.now()` in a fixture hook → static red; a test double that caches the node array on the framework object → the second `forge()` differs → red | productionMutation | equality (byte compare) |
| **G-ENV** | G-DET repeated under `LC_ALL=C` and `LC_ALL=en_US.UTF-8` (child processes) → identical; a readdir-order fixture whose directory order differs from `SHA256SUMS` order → identical | a fixture hook sorting with `localeCompare` over a mixed-case list ICU and code-unit order disagree on → red under one locale | productionMutation | equality |
| **G-ORDER** | (a) `census.collisionCensus` over the fixture output EQUALS the frozen expected (0/0/0 for the toy); (b) `forge()` returns `nodes`/`edges` in the walk's emission order (stableId sequence equals the captured sequence) | (a) with the test-only `MIGRATING_BUNDLE_LIST` override (`shippedConfig: false`) the toy declares C2 and its walk emits one stableId twice → census 1 ≠ 0 → red ⟨FR20⟩; a sibling conjunct asserts the override is absent from shipped config; (b) a test double that sorts inside the return step → sequence differs | productionMutation | (a) EQUALITY with a frozen count — trap: "no crash"; (b) equality of sequences |
| **G-EMBED** | `skipEmbedding: true` → `embedCallCount === 0` and a spy embedder that throws on call is never called; `skipEmbedding: false` + `embedder: null` → refused by name; N nodes → `ceil(N/128)` calls; `embedNodeLimit: n` → exactly `min(n, embeddable)` nodes carry vectors, chosen by role filter FIRST then slice in emission order ⟨FR20⟩; non-embeddable roles carry none and remain in the array in place; vector/text count mismatch → refused; batch failure text carries the batch number | fixture framework build calls the spy once under `skipEmbedding: true` → red; limit 3, embed 4 → red; a double that slices before filtering → a non-embeddable node consumes a slot → count differs → red | productionMutation | EQUALITY of counts — trap: "count is a number" |
| **G-ETEXT** ⟨PLAN-forgeEmbedText §8.3-8.5⟩ | (a) `null` on the toy → zero `DmeEmbedText` nodes, zero `EMBEDS_TEXT_OF` edges, no `embedText*` stat, and the toy PROXY EQUALS the frozen `3a3130eb…`; (b) the declared (test-only) toy → one text node per DISTINCT trimmed text against an independent oracle, a shared text is ONE node with two edges, the five `stats` counts EQUAL the oracle, text nodes follow every walk node; (c) one edge per (text, node) pair — a node whose two listed properties share a text gets ONE edge with a two-name `propertyNameList` and `collisionCensus.duplicateEdgeTripleCount === 0`; (d) a text node carries no `name`/`searchText`/`embedding` and exactly its ruled property set (`depth` 1, `crossRefs '[]'`, label triple); (e) the stableId literal under the toy pattern and under a CEDS-shaped `^https?://\S+$` with root `https://w3id.org/CEDStandards/terms/` (ONE slash); (f) a walk returning COPIES composes with the text nodes present once; a walk-minted `DmeEmbedText` is refused (R-ET-35); (g) two runs byte-identical, and a permuted emission order gives the same canonical text; (h) with a spy, the legacy pass sends no text node's text and the text pass exactly the distinct texts, `embedCallCount` EQUALS the sum of both `ceil(n/128)`; (i) `skipEmbedding: true` → no text vectors, no spy call; (j) `embedNodeLimit: 1` → one walk text and one node text; (k) every `embedTextDeclaration` refusal of §4.1, `DmeEmbedText` in `nonEmbeddableRoleList`, and a textless text node at the pass; (l) absent and empty-after-trim counted, padding collapses onto one node, a list expands element-wise, `['x']` is one value, `[]` / nested / NUL / non-string refused; (m) an embed run's PROXY EQUALS a skip run's; (n) text nodes carry the spy's `embeddingModelVersion` and a `textEmbedding` of its dimension, and no `textEmbeddingModelVersion` exists | (each; 42 twins over 36 conjuncts): mint one text node under `null`; hash text + source stableId; always concatenate the text nodes; drop the stats copy; one edge per property use; build searchText for the role in the kit; stamp `searchText` / `embedding` on a text node; drop `vectorPropertyName`; the `<standardKey>:` form; always join with `/`; derive before the origin check; disable the R-ET-35 check; an emission-index stableId; remove the union inside `embedPass`; run the text pass under skip; remove its slice; disable each declaration and value check; keep `textEmbedding` in the proxy; stamp the invented model-version name. Twins over the declared toy are registered `shippedConfig: false` | productionMutation | EQUALITY with an independent oracle and frozen literals |
| **G-ADAPTER** | a hook that throws inside the pure layer surfaces as `callback('forge-toy buildContractGraph: …')`, never as a thrown error across `forge()` | remove the adapter in a test double → the throw escapes → red | productionMutation | equality of the error-string prefix |
| **G-FINALIZERS** | after `forge()`, every node's `depth` EQUALS an independent chain-length computation; `crossRefs` present on every node; sequence properties present where groups were declared with the per-group `orderSemantics` value; `finalizeSequence` ran BEFORE `finalizeStructuralContract` (an instrumented double records order); a group without `orderSemantics` → refused by `sequence-contract` naming the group | a fixture walk stamps `depth: 99` and a test double skips the finalizer → red; swap the finalizer order in a double → red; drop one group's `orderSemantics` → refused | productionMutation | equality with an independently computed value |
| **G-VERSION** | `metadata.version` EQUALS the fixture's declared root version and `selfDescribedVersion ?? 'unknown'` EQUALS what the stamp used (frozen per fixture); never `''`, never `'current'`; `versionSource ∈ {spec, provenance-file, unknown}` unless P2; S3 or P2 declared on a fresh fixture → refused | fixture provenance says `1.2.3` while the hook returns `selfDescribedVersion null` → stamp `'unknown'` ≠ `1.2.3` → red; return the recipe token → red; `version '1.0'` with `selfDescribedVersion null` and no S3 → refused | inputFault | EQUALITY with the source's value — trap: "non-empty" |
| **G-CHECKSUM** ⟨FR8⟩ | before any loader runs, every file the loaders will consume (and every declared additional input) is verified against `SHA256SUMS`; a caller-named file absent from the list → refused naming it; a listed file altered on disk → refused naming it and the recipe path; a file on disk the list does not name → ignored | alter one byte of one listed fixture file in a scratch copy → refused; name a file absent from the list → refused; add an unlisted stray file → still green (the negative conjunct) | inputFault | name in refusal text |
| **G-SOURCE** | `declaration.standardSource === parserDescriptor.ini standardName` (the gate a bundle's suite runs over its own two files) and every emitted node's `_source` and every edge's `ref.source` equal it | descriptor `standardName=Ceds` with `standardSource 'CEDS'` → red | inputFault | equality |
| **G-UNIQUE** ⟨RULING 00:15 gate 9⟩ | `standardName` (and therefore `standardSource`) is UNIQUE among enabled bundles: `roster.assertUniqueStandardNames({ forgesDirPath })` reads every `forges/*/parserDescriptor.ini` and refuses by name on a duplicate, naming both directories; run by every bundle's suite and by the fleet suite (the forger's roster is not modified — the helper is a gate, `forger.js:158-176` stays as it is) | two fixture descriptors sharing one `standardName` → refused naming both | inputFault | name in refusal text |
| **G-JSONKEYS** | `mappingInstruction`, `crossRefs`, and (Ed-Fi) `mergeDirectives` strings produced through the framework are byte-identical to today's literal-order strings for a fixture of each forge's values | a builder iterating alphabetically → red on `mappingInstruction` (its literal order is not alphabetical) | productionMutation | equality |
| **G-COMPAT** | `complianceReport.activeAllowanceCount` EQUALS the frozen per-forge count (§7.3); every forge-time allowance's precondition met; a needed-but-undeclared allowance refused; a declared-but-unneeded forge-time allowance refused; every offline row carries `probeEvidence` | with the pesc fixture data (INSIDE the four) declare P6 while every OPTION_SET has children → refused "condition not met" ⟨FR20⟩; drop E6 from a fixture whose `describeSource` returns `''` → refused; declare `['P4']` on the toy (not in the four) → refused (the outside-the-four conjunct); declare P1 without `probeEvidence` → refused | inputFault | EQUALITY with a frozen count + name in refusal text |
| **G-NOSUB** | lexical: the f-word (any form) absent from framework and hook source, comments included; lexical: the stub-logger idioms `\|\| (() => {})`, `\|\| { status()`, `\|\| { status: () =>` absent from hook files ⟨FR14⟩ (RED today for ceds C7 and edfi E5); behavioural: `xLog` absent from `process.global` and deps → refusal names `xLog` (a fixture installing PESC's `\|\| { status(){} }` goes red); `warn` absent → refused; `sourcePath` absent / not on disk → refused; unknown role / unknown edge type without P4/S6 → refused; a coercion allowance on a non-migrating bundle → refused; a NEW fixture forge with a `null` name → node carries NO `name`, never `''`. Carve-outs (§11.5): `owningName \|\| standardSource` inside the search-text ladder and `crossRefs: '[]'` from the finalizer are BYTE MANDATES, not substitutions; G-NOSUB is lexical only ⟨FR20⟩ | (each) | inputFault | negative existence (lexical) + name in refusal text |
| **G-NOGRAPH** / **G-REQUIRE** | static: no `require` in the framework tree or any hook file of `neo4j-driver`, `lib/replay/**`, `replayManager`, `sqlite`, `apps/**`, `lib/embedding/**`, `lib/vector-store/**`, `forges/**`, OR `lib/forge-framework/roundTripHarness` from an entry module or hook ⟨FR15⟩ (the harness's `graphReader.js` is the ONE allow-listed bolt file, and only the validator file may require the harness); no `fs.readFileSync` of a `.ini` path in the framework tree (§3.2); dynamic: `forge()` runs to completion with the driver `require` stubbed to throw; the factory refuses an undeclared dep | add `require('neo4j-driver')` to a fixture hook → static red; add `require('../../lib/forge-framework/roundTripHarness/roundTripHarness')` to a fixture hook → static red; pass `driver` → refused | inputFault | negative existence — correct as a NEGATIVE check |
| **G-SHARE** | static: no function named `makeNode`/`addEdge`/`embedNodes` in a hook file; no `finalizeStructuralContract(`, `deriveVersionStamp(`, `embedTexts(`, `buildSearchText(`, `EMBED_BATCH_SIZE` outside the framework; no hook requires a sibling forge's `lib/` or `qtools-asynchronous-pipe-plus` (a hook is pure or a single loader); per migrated forge, hook lines / original lines ≤ the ratio the F3 builder FREEZES from the MEASURED migrated file, with a ceiling of 0.5 ⟨FR20⟩; every framework export has ≥1 caller across the four migrated forges' tests or a written justification — this conjunct is RED by design until F3b lands and its report line says so | copy `embedNodes` into a fixture hook → static red; set the frozen ratio to 0.0 in a test double → red | inputFault | negative existence + ratio inequality |
| **G-RT** | the harness refuses no/blank `semanticValidationLimit`, refuses absent `outputPath`, requires the five normative fields with finite counts and ASSERTS `roundTripClean === (contentGapTotal === 0 && inventedTotal === 0)`; every LOST item carries `lostCategory ∈ {explicitlyOmitted, contentGap}` and `lostTotal === contentGap count`; the verdict carries wall-clock, peak memory and the statement census (A8) ⟨FR18⟩; hermetic double: fixture forge → `graphDoubleFrom` → emit → diff = 0/0; a synchronous emitter refused | (each): delete one fact from the double → `lostTotal` moves (cheating-detector); inject one invented statement → build fails; delete the limit → harness refuses; verdict `roundTripClean: true` with `contentGapTotal: 1` → refused; a lost item without `lostCategory` → refused; a sync emitter → refused | productionMutation / inputFault | equality of counts + the A13 identity |
| **G-SEAM-UNTOUCHED** ⟨FR16⟩ | `git diff --stat <preMigrationTag> -- apps/graph-builder/apps/forger/forger.js apps/graph-builder/lib/build.js apps/graph-builder/apps/forger/lib/shape-forged-graph.js lib/replay/replay-engine.js lib/replay/replay-block.js apps/graph-builder/apps/replay-manager/replayManager.js apps/graph-builder/interfaces.js` is EMPTY — the §11.14 hard line with an instrument | touch a comment in `forger.js` in a scratch worktree → red | productionMutation | equality (empty diff) |
| **G-SWEEP** | the sweep reports DEFECTIVE for a gate CONJUNCT whose registered twin does not turn it red and UNPROVEN for a conjunct with no twin; the registry audit reports missing/orphaned twins; a twin registered `expectationLever` does not count toward observed-red; a twin registered `shippedConfig: false` is reported as such | register a no-op twin → sweep reports that conjunct DEFECTIVE; delete one twin implementation → audit reports missing; register an expectation-lever twin as the ONLY twin of a conjunct → UNPROVEN | productionMutation | equality (defective count 1 ≠ 0) |

### 10.2 Migration gates (a build; F3b/F3c/F3d proofs) — ONE-MACHINE-ONLY, licence-gated ⟨RULING 23:12 #7⟩ ⟨FR17⟩

These gates build `edfiOnlyRoundTrip` and its siblings, which need the gitignored MetaEd bytes
(`forges/edfi/parserDescriptor.ini:23-25`, `README_PROVENANCE.md` recipe), Voyage credentials, the warm
cache and Docker; they run on this Mac and nowhere else, and their report lines say so by name
(Profile §12 "a license-gated bundle's gate is one-machine-only and MUST say so by name").

| id | gate | RED TWIN | leverKind | equality or existence |
|---|---|---|---|---|
| **G-ID** | for each migrated forge, the block id produced by the frozen command (§9.2, `migrated`) EQUALS the id the SAME command produced on the unmigrated forge (`preMigration`), frozen in `acceptance/expectedBlockIds.json` ⟨FR9⟩; after Ed-Fi alone and after all four, the `fourWithHub-baseline` manifest EQUALS `97c618c2…` | change ONE byte of one root literal in the hook data (`parserVersion '2'` → `'2a'`) → id differs, and the diff procedure (§8.6) names the root line | productionMutation | **EQUALITY** with a frozen literal |
| **G-ID-CHEAP** (`PROXY`) | `fingerprint.pureLayerFingerprint` over the migrated forge's pure output EQUALS a frozen per-forge fingerprint measured on the unmigrated forge | same twin as G-ID (`productionMutation`). A SEPARATE registered `expectationLever` entry demonstrates that the proxy and G-ID DISAGREE on a duplicate stableId — a demonstration that does not count toward observed-red and is labelled so ⟨FR20⟩ | productionMutation (+ one expectationLever demo) | equality; report line says `PROXY` |
| **G-BLOCK** (Profile 11.3.8) | a second build over the same pin reproduces the id | inject a hook returning `Date`-derived text into one `searchText` → the second build's id differs. Sensitivity check (not the twin): flip the pin → id changes and the diff is the changelog | productionMutation | equality |
| **G-CENSUS** | the migrated forge's collision census EQUALS its frozen pre-migration census (§8.4 #1); its compliance census EQUALS its frozen allowance count (§7.3) | (a) a test double that drops one edge from the migrated output → dangling/duplicate counts differ → red; (b) declare one extra forge-time allowance whose precondition holds (S6 with a real substitution on the sif build) → count differs → red ⟨FR20⟩ | productionMutation | equality with frozen counts |
| **G-RT-LIVE** | stage-ON build: `inventedTotal` 0; `lostTotal` equals the forge's named backlog; `-goldEvalCheck` PASS | inject one invented statement into the migrated forge's emitter in a scratch copy → `inventedTotal` 1 → the build fails and `goldEvalCheck` refuses ⟨FR20⟩ | productionMutation | equality |

### 10.3 The twin registry contract ⟨RULING 23:12 #8⟩ ⟨RISK §7.3⟩

The framework's twin registry (in `roundTripHarness/twinRegistry.js` and reused by the forge-side
suite) is DATA keyed by `gateId` + `conjunctId`; each entry carries `{ gateId, conjunctId, twinName,
leverKind: 'productionMutation' | 'inputFault' | 'expectationLever', shippedConfig: boolean, run }`. The
sweep counts ONLY `productionMutation` and `inputFault` toward "every conjunct observed red"; an
`expectationLever` twin is recorded and does not satisfy the requirement (the PESC ledger's
`expectationLeverOnly` lesson); a `shippedConfig: false` twin is recorded as such and a sibling
conjunct asserts its override is absent from shipped configuration. The stale/orphan audit
(`auditRegistryAgainst`, `forges/ceds/test/test-cedsGates.js:263-303`) is a REQUIRED gate with
G-SWEEP's twin. Every forge's round-trip GATES, PESC included, MUST have a declaration and twins in
this form (a test-only obligation, no block bytes; §14 D10 asks for punch row P18). PESC's
red-evidence ledger is an ACCEPTED ALTERNATIVE for the tier-suite assertion labels it covers, stays
PESC-local, and is NOT a substitute for live round-trip twins ⟨RULING 23:12 #8⟩ ⟨RISK §7⟩.

### 10.4 RED TODAY — gate × forge, from code facts, before any migration ⟨FR17⟩

What each gate would report if run against the four forges AS THEY STAND (pre-migration, framework
gates applied to today's behaviour). "green" = today's forge already satisfies the conjunct; "RED" =
it does not (a punch row or an allowance is why); "unknown" = a census, probe or build is needed.

| gate | edfi | sif | pesc260805 | ceds |
|---|---|---|---|---|
| G-SEAM (pure export name; return keys) | green | green (fifth `forge()` arg outside the seam, dead) | RED — P7 `buildSourceTierGraph` | green |
| G-DECL / G-HOOK (declaration + hook shapes) | n/a until written | n/a; S1 positional parser needs the adapter | n/a; P8 stub logger | n/a; C4 literals |
| G-KIT duplicate stableId | green (`cg:336-345`) | unknown (census #1) | unknown (census #1) | RED — C2 (no check) / unknown whether it fires |
| G-KIT dangling endpoint | green | green (`forgeSif.js:679-683`) | RED — falsy-only check (`:163-167`) | RED — C1 (partial edges pushed) / unknown whether it fires |
| G-KIT edge type ∈ `EDGE_TYPES` | green | unknown (S6 branch, `:652`) | RED — P4, seven types | green |
| G-KIT clean stableId (real predicate) | green | green (spaces legal) | RED — P10 (no predicate) | green |
| G-KIT `name` handling | green (string) | RED — S2 `''` coercion | RED — P9 `''` ×3 | green (nameless terms omitted) |
| G-REFERENT (parentId → member) | green (finalizer) | green | unknown (P1: finalizer never runs) | green |
| G-ROOT (eight + five) | green | green | RED — P5 (four omitted) | green |
| G-VERSION | green | RED — S3 (`'1.0'` vs `unknown`) | RED — P2/P13 (`aggregate-manifest`) | green |
| G-CHECKSUM (forge-time) | green (loaders verify, `metaEdSourceLoader.js:37,103-106`) | green (`sif/lib/parser.js:504-506`) | RED — P11 (validator only) | RED — C5 (validator only) |
| G-SOURCE | green | green | green | green (literal `'CEDS'` equals descriptor) |
| G-JSONKEYS | green | green | green | green |
| G-DET (pure layer; no clock) | green | green | green (source tier; derived/synthetic tiers unmeasured) | green |
| G-FINALIZERS | green | green | RED — P1, P3 | green (structural only) |
| G-EMBED (`skipEmbedding`, null embedder) | green / RED (null embedder → TypeError) | green / RED | green (refuses by name) | green / RED |
| G-NOSUB stub-logger grep | RED — E5 (`metaEdParser.js:100`) | green | RED — P8 | RED — C7 (`parser.js:434`) |
| G-NOSUB `sourceUrl ''` | RED — E6 | RED — S4 | RED — P16 | green |
| G-RT (harness contract) | RED — E1 (`outputPath` truthy-gated), E3 (sync emitter) | green | RED — P14 (no hermetic double), no gates/twins (P18) | green (C6 shape kept behind the contract) |
| G-UNIQUE | green | green | green | green |
| G-COMPAT / G-CENSUS / G-ID / G-BLOCK / G-RT-LIVE | unknown (build) | unknown (build) | unknown (build) | unknown (build) |

## 11. What the framework MUST NOT offer

Each is a thing that would make the framework a place where a forge could do what the Profile forbids
⟨ARCH §6⟩ ⟨IMPL §8.5⟩ ⟨RISK §6⟩ ⟨Profile §9⟩ ⟨Bridge Profile §2.2, §4.7⟩.

1. **No graph access.** The forge-time surface has no bolt URL, no driver, no `lib/replay`, and does
   NOT expose the round-trip harness ⟨FR15⟩; the harness is a separate module (§3.3, §6.6) whose bolt
   read is the validator's sanctioned read (Profile §8.1), in ONE allow-listed file, and G-NOGRAPH's
   static grep refuses an entry module or hook that requires the harness path. Gate G-NOGRAPH.
2. **No bridging.** No cross-standard edge builder — `kit.addEdge` REFUSES an endpoint whose source is
   not the bundle's own, so a cross-standard edge cannot be expressed. No mapping edge type: `EDGE_TYPES`
   membership plus an explicit refusal of the retired `*_MAPPING` names (`vocabulary.js:90-97`).
   Structural bridges, mapping bridges and their `_struct`/`_exact`/`_close` blocks are a different
   producer (Bridge Profile §4.7); a forge's block is `standardBase`.
3. **No hub hook.** `canonicalKey`, `addressSignature`, `hubName`, `hubVersion` are not kit members and
   not interpreted by the framework; CEDS stamps its address slots through `carriedProperties` as
   opaque data; the hub is the FORGER's `HUB_FORGE_BY_STANDARD` and CEDS's `cedsHubForge.js`, OUTSIDE
   the seam ⟨RULING 23:12 #6⟩ ⟨IMPL §3.2⟩.
4. **No join-key addressing.** No method returns a single-valued map keyed on `canonicalKey`, `cedsId`,
   or any cross-reference; `kit.cedsAnchorValue` returns a VALUE to stamp as data (and is named for what
   it is — a join-key value, not a `stableId`) ⟨FR20⟩, never a lookup;
   `crossRefs` are stamped raw and never resolved (Bridge Profile §2.2 "A resolver MUST NOT treat
   `canonicalKey` as an address"; Profile §5.2, §9).
5. **No silent substitution, in any form.** No default for an absent declaration key, hook, seam
   argument, `describeSource` key, `warn` channel, or `xLog`; no `a || b` identity chain; no coerced
   `name`/`description` except through a NAMED allowance visible in the compliance report; no
   do-nothing logger; no "newest snapshot" resolution — `sourcePath` is read as handed. Two named
   CARVE-OUTS ⟨FR20⟩: `owningName || standardSource` inside the search-text ladder (Ed-Fi
   `cg:281-286`, SIF `forgeSif.js:217`, and `build-search-text.js:60,65,72`) and the finalizer's
   `crossRefs: '[]'` are BYTE MANDATES that reproduce today's blocks, not substitutions; G-NOSUB is
   lexical only and does not read them as violations. The embed-text derivation's `text = value.trim()`
   is NOT a substitution either: it is a DECLARED identity rule of the derivation, counted
   (`embedTextTrimmedCount`) and reported in `stats` ⟨PLAN-forgeEmbedText §8.3 R-ET-16, §8.4 R-ET-29⟩. The lexical rule follows the engineering rule:
   the f-word and the stub-logger idioms are absent from framework and hook source (G-NOSUB)
   ⟨Profile §7⟩.
6. **No embedder construction, no ini reading, no credential.** Injected or `null` ⟨Profile §2.1, §2.4⟩.
7. **No clock, no randomness, no process state in the pure layer.** The kit carries no channel; the
   framework's own pure code contains no `Date`, `Math.random`, `process.hrtime`, `crypto.randomBytes`
   (G-DET greps the framework tree exactly as Profile §5.3 greps the forges).
8. **No raw-node escape hatch and no per-standard branch.** The kit is the only door for creation; no
   `if (standardKey === 'ceds')` anywhere — every per-standard difference is a declaration value, a
   hook, or an allowance id (registry over switch; G-NOSUB greps for the literal tokens of the four).
9. **No node/edge sorting or dedup anywhere in `forge()`** ⟨RISK §6.2⟩ — §6.4. The embed-text derivation
   (§6.2 step 4b) dedups TEXTS, not nodes: each distinct text becomes ONE node it mints and orders itself;
   it never removes, merges or re-orders a walk node or edge ⟨PLAN-forgeEmbedText §8.4 R-ET-31⟩.
10. **No `finalizerPolicy` beyond P1, no `owner` interpretation, no `_id` policy switch, no
    config-driven `EMBED_BATCH_SIZE`, no option-value-expansion opt-out beyond P6, no new root
    fields, no `frameworkVersion` stamp, no `coreVersion` bump, no timestamps, no `ingestedAt`
    ⟨RISK §6.1, §6.5, §6.8-6.12⟩. Every one of these either changes every root line or is a settable
    with a default behind it.
11. **No `displayName` reader, no certificate generator, no descriptor writer** — not on the acceptance
    path ⟨RISK §6.11⟩.
12. **No round-trip DIFF-ENGINE REWRITE in v1** — the harness ships the CONTRACT (§3.3, §10 G-RT);
    consolidation of the four cousins is a later phase with its own proof (§14 D8) ⟨RISK §6.6⟩.
13. **No migration of PESC's ledger** into the framework ⟨RULING 23:12 #8⟩.
14. **No touch of the seam.** Not one more return key the forger reads, not a fifth `forge()`
    argument, no change to graphBuilder, forger, `shapeForgedGraph`, replayManager ⟨PLAN "Hard lines"⟩
    — instrumented by G-SEAM-UNTOUCHED (§10.1) ⟨FR16⟩.
    **Moved by ruling** (forge embed-text revision, TQ decision 3; PLAN-forgeEmbedText §8.3 R-ET-8, §8.4
    R-ET-30, §8.5): the text-vector sidecar changes three seam files in phase P4 —
    `apps/graph-builder/apps/forger/lib/shape-forged-graph.js` (strip `props[vectorPropertyName]` and lift
    it into the record's one vector slot with its `embeddingModelVersion`, so the ragged-dimension and
    model guards cover text vectors; a node carrying both `embedding` and its declared vector property is
    refused), `lib/replay/replay-engine.js` (`shapeNode`: drop `props[vectorPropertyName]` from the
    serialised properties and read the vector from `props[vectorPropertyName ?? 'embedding']` in BOTH the
    sidecar branch and the store-less inline branch, the ref still derived from `embedSourceProperty`;
    `buildNodeRow`: land the resolved vector under `vectorPropertyName ?? 'embedding'`; the index DDL gains
    `<graph>_embedText_vector FOR (n:DmeEmbedText) ON (n.textEmbedding)` beside `<graph>_vector`), and
    `lib/replay/replay-block.js` (serialise and deserialise the per-node discriminator). A record without
    `vectorPropertyName` keeps today's bytes. G-SEAM-UNTOUCHED goes red by design and is re-anchored in P8
    with its causes named. This site list is written from R-ET-8; if P4's final list differs, the
    supervisor amends it at the merge. No other return key, `forge()` argument, or graphBuilder / forger /
    replayManager change is licensed.

---

## 12. Layering, tests, doctrine compliance

### 12.1 Where it lives and what it may require ⟨ARCH §7.1⟩ ⟨FR19⟩

FLAT: `test/runAllTests.js:139-156` discovers `lib/` modules by a recursive "directory containing a
`.js` file" rule (NOT by `package.json` — that gate is `apps/` and `forges/` only, `:108,168`), so a
nested `lib/` under the framework would register as its own module and report "no test suite" on
every fleet run. Two modules, each with its own `test/`; `runAllTests.js` is NOT modified.

```
lib/forge-framework/
  forge-framework.js               the factory + the object (§3): injectStandardHooks (§5), forge()/buildContractGraph (§6),
                                   and the re-exports the surface names — constants.*, vocabulary.*, structural.*, sequence.*, searchText.*
  forgeDeclarationContract.js      FORGE_DECLARATION_CONTRACT + its table-driven validator (§4)
  standardHookContract.js          STANDARD_HOOK_CONTRACT + its validator (§5)
  migrationAllowanceRegistry.js    MIGRATION_ALLOWANCE_REGISTRY + MIGRATING_BUNDLE_LIST + PERMISSIVE_STABLE_ID_PATTERN (§7)
  contractGraphKit.js              §3.4 — makeNode, addEdge, stats, requiredStat, carriedProperties, crossRefsJson,
                                   searchTextElementFor, cedsAnchorValue, isCleanStableId, emitOptionValue, rootStableId
  rootNode.js                      §6.5
  embedPass.js                     §6.3
  sourceVerification.js            provenance.verifySnapshotChecksums (§3.3) — serves forge time and validator intake
  provenanceStamp.js               provenance.deriveVersionStamp adapter with the real warn channel
  census.js                        census.collisionCensus, census.complianceReport
  fingerprint.js                   fingerprint.pureLayerFingerprint (PROXY)
  refuse.js                        refuse.byName (requiredKeys/closedValue deleted under FB8)
  roster.js                        roster.assertUniqueStandardNames (G-UNIQUE)
  README.md                        the header prose the four forges each carried (D23), once; CORE_VERSION's meaning (§4.3)
  package.json                     the framework's own version (never in the block); does NOT drive discovery
  test/
    fixtures/toyForge/             committed toy standard: source, SHA256SUMS, README_PROVENANCE.md, standardSourceLocation,
                                   parserDescriptor.ini, package.json, README_ERRATA.md, README_ValidationCertificate.md,
                                   README_ValidationDetail.md, lib/toyForgeDeclaration.js, lib/toyHooks.js, lib/toyRoundTripPair.js,
                                   forgeToy.js (the one-line entry), roundTripValidator.js
    test-*.js                      one file per §10.1 gate family; every twin registered in data (gateId + conjunct)
    acceptance/acceptanceCommands.jsonc   §9.2, one frozen line per forge; expectedBlockIds.json (measured pre-migration);
                                          expectedCensus.json; expectedAllowanceCounts.json; expectedShareRatios.json

lib/forge-framework/roundTripHarness/     a SEPARATE module (its own discovery boundary), required only by roundTripValidator.js files
  roundTripHarness.js              validatorFrom, graphDoubleFrom (§3.3)
  graphReader.js                   the ONE bolt-facing file (DOCTRINE dispensation: .then().catch() to the callback at the leaf)
  verdictAssembler.js              five normative names + verifyVerdictShape + the A13 identity + lostCategory + the A8 census
  twinRegistry.js                  §10.3 — leverKind, shippedConfig, gateId+conjunct, auditRegistryAgainst
  gateEvaluator.js
  test/                            its own suite
```

Every member of the §3.3 surface has a file above; the re-exports live in `forge-framework.js` ⟨FR20⟩.
A `lib/` sibling of `structural-contract`, `sequence-contract`, `search-text`, `snapshot-provenance`
— the same house shape, a pure module plus its own test dir (`sequence-contract.js:6-8`). It MAY
require: `qtools-asynchronous-pipe-plus`, `path`, `fs`, `crypto`, `lib/vocabulary`,
`lib/structural-contract`, `lib/sequence-contract`, `lib/search-text/build-search-text`,
`lib/snapshot-provenance`, and — in `roundTripHarness/graphReader.js` ONLY — `neo4j-driver`. It
MUST NOT require `apps/**`, `lib/replay/**`, `lib/embedding/**`, `lib/vector-store/**`, `forges/**`;
an entry module or hook MUST NOT require `roundTripHarness/`. Gate G-REQUIRE greps the framework tree's
`require` calls against this allow-list. A forge bundle requires the framework by relative path exactly
as it requires `snapshot-provenance` today (`forgeEdfi.js:44-47`).

### 12.2 The test suite ⟨ARCH §7.2⟩ ⟨Profile §11.1⟩

Every §10.1 gate, each with its registered twin per conjunct, run over the toy fixture; discovery is
the `lib/` rule — a flat directory with `.js` files and a `test/` beside them (`test/runAllTests.js:139-156`)
— not `package.json` ⟨FR19⟩; nothing writes into a tracked path — evidence of a run comes from a run ⟨Profile §12⟩. The identical-block-id
gate is NOT a unit test (it needs a build); it is the F3b/F3c proof, driven by
`acceptance/acceptanceCommands.jsonc`. Every gate MUST have been observed RED before it was made to
pass, by the three-state method (before-passes → invert-and-watch-red → fix-to-green), and the F3
builder's DEVLOG records the red observation per gate.

### 12.3 Doctrine and polyArch2 compliance ⟨DOCTRINE⟩ ⟨ARCH §7.3⟩ ⟨programming-skills briefing: general + cli⟩

- Callback error-first everywhere on the orchestration side; `pipeRunner`/`taskListPlus`; no
  `async`/`await`; no Promise surfaced past a leaf. The ONE `try/catch` is the adapter and it is the
  framework's (Profile §2.2). The harness's bolt reads resolve `.then().catch()` to the callback at
  the leaf, in ONE file, so the dispensation stays where the doctrine lists it.
- Registry over switch: declaration contract, hook contract, allowance registry, kit surface, role
  registries — all data; no per-standard branch (§11.8).
- No mutation of global state; `process.global` is read (`xLog`) and never written.
- A formally declared interface at every polymorphic seam: `FORGE_DECLARATION_CONTRACT`,
  `STANDARD_HOOK_CONTRACT`, `CONTRACT_GRAPH_KIT_SURFACE`, `MIGRATION_ALLOWANCE_REGISTRY`, and the
  `@interface ForgeBundle` / `Embedder` the seam already declares (`interfaces.js:229-254`).
- No silent default for absent or invalid input (config or user): it throws, or is refused by name,
  never quietly corrected — including a required input with a do-nothing default (`warn`, `xLog`).
- Compound, greppable names; never the bare word `key` — `standardKey`, `snapshotKey`,
  `stableUriPropertyName`, `stableId`, `rootStableId`, `loaderName`, `allowanceId`, `gateId`; a
  record's own identifier is `refId` where one is introduced; a reference to another record is named
  for its subject.
- Every gate observed failing before it passes (§12.2).
- Module locality: everything a module needs lives in that module or arrives through the seam; the
  framework instantiates its own stateless dependencies and receives its one stateful one.

---

## 13. Positions this specification encodes

- **The block layer hashes less than the forge emits, and in a canonical order.** `_id` never reaches
  block text (the framework stamps it, a hook never does — Profile v1.0.2 amendment); the five root fields do; property/label/node/edge ORDER is canonicalized away — the
  framework is free internally except inside array values, composed strings, JSON-string internals,
  the embed slice, and MERGE collisions ⟨ARCH §0⟩ ⟨IMPL §0⟩ ⟨RISK §1⟩ ⟨Profile §5.5⟩.
- **One qtools object, one injection call, one execute path.** `require(framework)({ embedder, xLog? })`
  hands out the kit and the utilities; `injectStandardHooks({ forgeDeclaration, hooks })` validates
  data and methods against declared contracts and returns the seam bundle; `bundle.forge` runs cheap
  refusals → verify → load → describe+stamp → pure layer (adapter) → embed → return, satisfying
  `forger.js:816-828` unchanged.
- **The kit is the only door for creation; the walk is a composition over mutable nodes.**
- **H1 is a declaration object larger than the descriptor; the root is built from declared data,
  never from the descriptor.**
- **Byte-identical migration is a closed allowance registry keyed by the punch list, not a bypass.**
  Undeclared-but-needed refused; declared-but-unneeded refused; census-counted; retired one commit at
  a time with a deliberate new id.
- **Ed-Fi → SIF → PESC → CEDS**; proven on Ed-Fi proves the framework, on SIF the mechanism, on PESC
  the composition; the hub is never touched.
- **The acceptance test is EQUALITY with a frozen id under a frozen command; the proxy says PROXY.**
- **Refuse by name; absent is absent; a coerced value is a substitution; a cheap refusal precedes a
  costly step; a declared-unenforced requirement is the pattern this reset exists to end.**

---

## 14. MUST DECIDE — for the supervisor, with recommendations

Each item names the fork, what each paper said, and the recommendation this document has already
written into the sections above (so a contrary ruling is a find-and-replace, not a redesign).

| # | question | positions | recommendation (as written) |
|---|---|---|---|
| **D1** | Does the kit stamp `_id: stableId` at all? | ARCH §8.1: stamp `_id === stableId`, no override, because `REQUIRED_PROPERTIES.NODE` (`vocabulary.js:520`) declares it and `structural-contract.js:63` reads it for the "wrong referent" diagnostic; RISK §6.12: stamp nothing, byte-invisible and engine-owned; RULING 23:12 #9: a HOOK-set `_id` → refuse by name (both agree) | **the FRAMEWORK stamps `_id: stableId`; a HOOK MUST NOT** (§3.4, §4.2) — ACCEPTED as a Profile v1.0.2 AMENDMENT (Profile v1.0.1 §5.1 reads "a forge MUST NOT set `_id`"; the framework is not the forge, and the review's F7 is right that this is a Profile change, not an F2 decision) ⟨FR20⟩. Keeps the declared universal set and the diagnostic. CEDS's legacy `_id` through C9 ONLY if probe #3 finds a reader |
| **D2** | Kit helpers synchronous-throwing vs callback-shaped (RT-8 "every public interface callback-shaped even where pure") | Profile §11.1 RT-8 vs `interfaces.js:241-242` (`buildContractGraph` synchronous) and Profile §2.2 (throw inside the pure layer, ONE adapter) | **kit throws, orchestration calls back** (§3.3 WHY); RT-8 governs the forge's and validator's PUBLIC interfaces, which the framework's surface honours |
| **D3** | A fifth key on the `forge()` argument object: refuse or ignore? | IMPL §7.6: refuse by name; RISK §5: assert not READ | **refuse by name AND assert not read** (§6.1); the forger passes exactly four; the Proxy permits exactly three reads ⟨FR12⟩ |
| **D4** | `owner` absent: refused or passed through? | RULINGS row 4: accept and pass through; RISK §8.3: passed through as-is, unread | **accepted, never READ, not carried, absent not refused** (§6.1) ⟨FR12⟩ |
| **D5** | Are the five extra root fields ENFORCED (Profile §14 MUST DECIDE for the F2 architect)? | ARCH §8.2: enforce eight + five, PESC via P5; RISK H19: root field policy per forge | **enforced, PESC via P5** (§6.5); recommend Profile §10.4 SHOULD → MUST once P5 retires |
| **D6** | Byte-free repairs (P7, P8/C7/E5, P15, S1, P11/C5): own commits or discharged BY the migration commit? | Profile §13.1 preface: "still lands as its own commit"; RISK §8.2: P11/C5 discharged by migration; IMPL §4.4 R12: supervisor's call; RULING 23:12 #9 "checksumVerification ONE value" | **discharged by the migration commit, each named in its message** (§8.5) — P7, P8, S1, P11/C5, and P1 when probe #2 is neutral; NOT C7/E5 (hook-side loader code) and NOT P15 until probe #13 proves it ⟨FR14⟩ |
| **D7** | `nonEmbeddableRoleList`: an allowance or a permanent H1 key? | RULING 23:12 #1 lists "nonEmbeddableRoles" among the registry's coverage; RULING 23:12 #2 lists it as H1 data; Profile §4.6 [design]: a framework concept; IMPL §5: "permanent not migration" | **permanent H1 key, not a registry row** (§4.1, §7.2): a retirement commit for it would be wrong |
| **D8** | Round-trip harness scope in v1 | ARCH §2.9: the whole framework half (intake, reader, ONE diff engine, assembler, double, gates, twins), sequenced after F3b; RISK §6.6: CONTRACT only, no diff-engine rewrite in v1 | **contract + refusals + assembler + double + twin registry in v1; per-forge diffs run behind it; R2 consolidation deferred to its own phase** (§6.6, §11.12); the harness moves no block byte either way |
| **D9** | Ed-Fi's root description is template-built (`cg:472-475`) but §13.1 lists only C8/S5/P17 | Profile v1.0.1 §10.4 "never template-built"; the framework cannot distinguish a template from a source-stated string | **add punch row E7 (edfi template description); enforce by review, not by a registry row** (§5.1, §7.2); Ed-Fi's allowance count stays 1 (E6) |
| **D10** | New punch rows requested: **C9** (ceds `_id ≠ stableId`, byte-invisible), **S6** (sif `canonical \|\| REFERENCES` parent-edge substitution, `forgeSif.js:652`), **E7** (D9), **P18** (pesc ships no `roundTripGates`/twins — RISK §7 proposed "P12", renumbered because v1.0.1's P12 is package.json) | RISK §7, §8.6; IMPL §7.5 | **add all four**, plus **S7** (sif `sourceFiles []`, ⟨FR3⟩) and **C10** (ceds carry-list `''` exclusion, ⟨FR7⟩) as new rows; C9, S6, C10 are declared only if the census/probe says so; **P4 → seven types** and **P13 → block-relevant** in Profile v1.0.2 ⟨FR1, FR14⟩ |
| **D11** | Sequencing: forge-side object + Ed-Fi proof BEFORE the harness lands? | ARCH §9.4 and RISK §6.6 agree | **yes** — F3a core + suite, F3b Ed-Fi block id, harness contract in F3a but per-forge validators keep their diffs until a later phase |
| **D12** | `sourceUrl ''` allowance ids: E6/S4/P16 are three rows for one behaviour | Profile v1.0.1 §13.1 | **keep three ids** (each forge retires its own row in its own commit); the registry row is one, keyed three ways |
| **D13** | The `standardName`-unique gate (addendum 00:15 gate 9): framework helper vs forger roster | Profile §3.1 "enforced by the framework/roster" | **framework helper `roster.assertUniqueStandardNames`, run by every bundle's suite and the fleet suite; the forger's roster is not modified** (G-UNIQUE) |

---

## Appendix A — Where the papers disagreed, and what settled it

| subject | ARCH | IMPL | RISK | settled by |
|---|---|---|---|---|
| Does the walk return nodes/edges? | no — the kit collects; the walk returns reports | yes — a composition returning `{ nodes, edges, stats, ...reports }` over mutable nodes | (silent) | RULING 23:12 #4: composition over mutable nodes, kit the only door — §5.1 reconciles by ORIGIN check + ORDER honoured |
| Search-text element for CLASS | shared registry from the declaration's `standardSource` | PESC passes the owning artifact as `owningName` — a shared SIF/Ed-Fi ladder rewrites every PESC class | H24: per-forge data | RULING 23:12 #3: honour a caller-supplied `owningName`, default only when none — §3.4 |
| `_id` | stamp `_id === stableId`, no knob | CEDS needs an override (byte-critical — later shown byte-invisible) | stamp nothing | RULINGS 22:51 M5 CLOSED (byte-invisible; forge MUST NOT set); RULING 23:12 #9 (hook-set → refuse); D1 for the kit's own stamp |
| Root display text | `standardDisplay` declared | root `standardName` ≠ descriptor in 3 of 4 — declared data | H5/H14 | RULING 23:12 #2: framework-built from DECLARED data — §4.1 `standardDisplayName` |
| PESC's `'DECLARES'` | (not addressed as a blocker) | SIX types outside `EDGE_TYPES`; P4 undercounts | H15: a migration BLOCKER; recommend `legacyEdgeTypeAllowList` | RULING 23:12 #1: P4 widened to six, allowance with `edgeTypeAllowList`; the adversarial review found the SEVENTH (`SERVED_BY`, `syntheticTier.js:1771`, invisible to non-`-a` grep) — FR1: seven — §7.2 |
| `finalizeStructuralContract` off for PESC | allowance P1 | declared `finalizeStructuralContract: false` | §6.1: no switch until the H8 probe proves non-neutrality | §7.2 P1: declared ONLY if probe #2 shows a change; otherwise forbidden and discharged |
| Duplicate/dangling refusals for CEDS | C1/C2 run from day one; not allowances | measure first; "record-do-not-refuse" if live | H18/§8.4: policies only if the census shows collisions | RULING 23:12 #1: ONLY where a pre-flight census proves the pinned snapshot triggers it — §7.2 C1/C2 |
| `checksumVerification` | two values (`'framework'`/`'loaderOwned'`), or one if the supervisor prefers | S* for CEDS/PESC; supervisor to confirm P11/C5 | H33/§8.2: universal, byte-neutral, discharges P11/C5 | RULING 23:12 #9 "ONE value" + RULINGS 22:46 M4 — §4.2, §8.5, D6 |
| `summarizeForgeStatus` | optional hook | (silent) | (silent) | RULING 23:12 #9: drop — §5.1 |
| `describeSource` separate hook | yes | H2 must yield `{ parsed, metadata, sourceVersion }` | (silent) | RULING 23:12 #9: separate hook YES — §5.1 |
| Round-trip harness in v1 | whole framework half | (silent; lists R1-R9 as S) | contract only; no diff-engine rewrite | D8 — contract in v1, consolidation deferred |
| PESC ledger | (silent) | MUST DECIDE | accepted alternative for what it covers; twins mandatory; two ideas lifted | RULING 23:12 #8 — §10.3 |
| Migration order | (silent) | Ed-Fi → SIF → PESC → CEDS by allowance count | same order; sharpened "proven on" | RULING 23:12 #6 — §8.1 |
| Diff procedure compares | BLOCKS (§5.3) | (block model §0) | BLOCKS (§4.4) | RULING 23:12 #10 — §8.6 |
| Ed-Fi's allowance count | zero | zero | none known | v1.0.1 §10.4 + E6 → ONE (§7.3); the papers predate the rule |
| SIF's version stamp | (silent) | `describeSource` yields `sourceVersion`; `'1.0'` literal is S3 hook territory | H21 | REVIEW B11 + FR2: two version keys, S3 a registry row (§5.1, §7.2) |
| `name` at mint | refused when null (RT-2) unless allowance | coerce-to-`''` as a declared option | H6: no default in either direction; a named legacy policy | REVIEW B13/D7 + FR4: OPTIONAL — omitted, never `''`, counted; `''` only under P9/S2 (§3.4) |
