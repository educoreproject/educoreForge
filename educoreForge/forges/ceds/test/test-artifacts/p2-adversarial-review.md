# Phase 2 Adversarial Review — hubReimplementation (registry flip + vector sidecar)

Reviewer: independent hostile pass, 2026-08-03. Scope per assignment: engine diffs
(replay-engine.js, replayManager.js, build.js, embedding-client.js, forger.js), new files
(vector-store.js, test-embedSourceProperty.js, test-cedsHubBuildGates.js), R-P2-1 seam in
test-build.js, rulings R-P2-1/R-P2-2, devlog Phase 2 entry. No files modified.

All file paths below are under
`/Users/tqwhite/Documents/webdev/educoreForge/system/code/educoreForge/` unless absolute.

**VERDICT: SOUND-WITH-GAPS** — STOP 0 · MUST-FIX 3 · SHOULD-FIX 4 · NOTE 7

The engine diff itself survived every line-level attack (format discrimination verified, no
resolution chains, refusals by name, old format byte-preserved). All three MUST-FIX findings
are in what the WIRING and the CLAIMS cover, not in what the changed lines do.

---

## MUST-FIX

### M-1 — Bridge dependency-graph restore drops vectors SILENTLY for ref-style blocks
`apps/graph-builder/lib/build.js:1040`

```js
replay.init({ inGraph: args.depGraph, schemaBlocks }, (err) => ...
```

The bridge phase restores each pairing's dependency base blocks (source + hub — including the
folded CEDS block with its 94,602 ref-carrying cards) into a scratch dependency graph with
**no `storeResolver`**. The engine's no-resolver path (replay-engine.js:562-570) is a
deliberate no-op, so every node carrying `embeddingRef` merges into the depGraph **with no
`embedding` property and no error anywhere**. `vectorStoreResolver` is in scope at this call
site (resolved at build() top, line ~635) — it simply is not passed.

Exact failure scenario: any recipe with a bridge whose dependency standard was harvested
ref-style (after this phase, that is EVERY vectorized standard) produces a vectorless
dependency graph. Nothing fires: the bridge vectorizer re-embeds texts through the shared
cache (so matching quietly still works today), but sourceWalker's `flattenFullRecord`
pass-through of `embedding` into evidence goes undefined, and Phase 3's no-reembed / G-15
contract — which R-P2-2 EXPLICITLY names as the beneficiary of "restore stamps vectors back
onto graph nodes so downstream readers see candidate.embedding" — lands on a path where that
constraint is not wired. Phase 2's own build was green only because cedsHub.recipe.jsonc has
no bridges; the landmine is armed precisely where Phase 3 starts.

Fix: pass `storeResolver: vectorStoreResolver` at build.js:1040, plus M-2's engine refusal as
the layer-owned defense.

### M-2 — Engine no-resolver path cannot refuse a ref-style manifest (single-caller defense)
`lib/replay/replay-engine.js:562-570`

The `resolveNodeVectors` no-op branch (`if (!storeResolver)`) strips `_standardKey` and
returns success without checking whether any node carries `embeddingRef && !embedding`. The
R-P2-2 constraint "a MISSING vector is a refusal, not a silent vectorless node" is therefore
enforced only ONE layer up, in `materializeSchemaBlocks` (build.js:311-319), for exactly one
of the write path's entry points. `replayManager.init` documents `spec.storeResolver` as
optional ("absent means the legacy inline-only replay, exactly as before" —
replayManager.js:744-746), which is true only for legacy blocks; for ref-style blocks,
absence means a silently blind graph. M-1 is the first real caller to fall through this hole.

Exact failure scenario: any present or future caller of `replayManager.init`/
`replayEngine.replay` handed ref-style blockText without a resolver writes a graph whose
vectored nodes have no embedding and no trace of the omission (buildNodeRow does not persist
embeddingRef), and every downstream cosine searches blind — the exact wording of build.js's
own refusal comment.

Fix: in the no-resolver branch, scan for `oneNode.embeddingRef && !oneNode.embedding` and
refuse naming the first stableId + standardKey ("ref-style block requires a storeResolver").
Legacy inline manifests carry no refs and are untouched — the check IS the format
discriminator, in the R-P2-2 idiom.

### M-3 — The build's vectors landed INSIDE the incumbent's CEDS.sqlite3; the devlog's "not touched" claim is false
`apps/graph-builder/lib/build.js:77-78` (VECTOR_STORES_DIR_PATH + `${standardKey}.sqlite3`),
devlog R-P2-2 entry ("the incumbent's CEDS.sqlite3 belongs to a different producer and is not touched")

Verified on disk: `/Users/tqwhite/Documents/webdev/educoreForge/system/dataStores/vectorStores/`
contains **no `ceds.sqlite3`**. It contains the incumbent's `CEDS.sqlite3` — 560MB, mtime
Aug 3 12:20 local (== ~17:20Z, the cedsHub_20260803-171721 build window), now holding
**117,786 rows** = the incumbent's ~23k base vectors + this phase's 94,562 card vectors
(read-only sqlite query, one modelVersion voyage-4-large). macOS APFS is case-insensitive:
`path.join(dir, 'ceds.sqlite3')` opened the incumbent's file. The recreation wrote half a
gigabyte into a store the handoff explicitly claims it did not touch.

Consequences, in order: (1) the HANDOFF-STATE/devlog claim is materially false and would
propagate to Phase 3's cold reader; (2) cross-producer shared mutable state — content
addressing and identical schema make it data-compatible (no corruption; verify-on-read
holds), but neither producer's store is any longer an inventory of its own writes; (3) deploy
trap: on a case-SENSITIVE filesystem (the Linux deploy targets) the resolver will look for
`ceds.sqlite3`, which does not exist under that name — a refusal at materialize, loud but
planted, and the devlog's transport instruction names a file that isn't there; (4) two
casings for one store is one-fact-two-names, the campaign's named disease.

Fix: rule ONE casing for store filenames (derive from the same registry/token authority both
producers use), rename/migrate explicitly, and correct the devlog claim before sign-off.

---

## SHOULD-FIX

### S-1 — Report writer crashes (uncaught throw) if hubSkipReport is absent when hubDivergenceReport is present
`apps/graph-builder/lib/build.js` hub-fold reports task (~line 768-820). The guard checks only
`hubDivergenceReport === undefined`; it then calls
`JSON.stringify(args.forgeReport.hubSkipReport, ...)` → `undefined`, and
`fs.writeFile(path, undefined, cb)` **throws synchronously** inside the mkdir callback —
process crash, not error-first. Today the forge module always returns both together; the
coupling is unchecked at the seam that assumes it. Refuse by name if one report arrives
without the other.

### S-2 — The 24GB heap requirement exists only as prose; the failure mode strands containers
Devlog "Found-and-fixed" #2 + open item 1. Assessment per attack F: the engine-side
JSON.stringify in the LOAD path is a **resource risk, not a correctness risk** — OOM kills
the process loudly, block bytes and hashes are unaffected. But the sharp edges are real: an
operator running the documented plain command OOMs mid-build, and OOM bypasses
dispose-on-failure (observed: stranded scratch container, disposed by hand). Add an in-code
guard (v8.getHeapStatistics().heap_size_limit vs an estimated need, refusing by name with the
`--max-old-space-size` remedy) or land the streaming batch write. Until then this is a trap
with only a devlog sign over it.

### S-3 — G-13's twin perturbs the HASH, not the stream; determinism proven warm-cache/same-process only
`forges/ceds/test/test-cedsHubBuildGates.js:241-258`. `injectRunVaryingValue` re-hashes the
pristine hash with a token — it proves `computeDeterminismViolations` flags differing hashes,
not that a run-varying value in the actual nodeEdges changes `canonicalNodeEdgesHash` (true
by sha256, but the twin is one derivation away from the gate's real measure — the same
mirror-limit family Phase 1's review flagged). Separately: the two forges run in ONE process
on one forger instance, and the devlog's two full builds both drew from the warm vector
cache. Two-build independence at the FORGE level is genuine (full re-parse/re-forge; nothing
memoizes nodeEdges — verified in forger.js), but determinism is proven **conditional on the
shared content-addressed cache**; cold-cache re-embed determinism is untested and should be
stated as out of contract (Voyage is not promised bit-stable across API calls).

### S-4 — putVector is check-then-insert, not the "insert-or-ignore" its comment claims
`lib/vector-store/vector-store.js:199-218`. SELECT-then-INSERT on `vectorId`. Two concurrent
builds of the same standard (or a build racing the incumbent producer in the SAME commingled
file — see M-3) can both pass the SELECT and collide on the PRIMARY KEY → constraint error →
harvest fails. Loud and non-corrupting, but a spurious failure mode the comment says cannot
exist. Use `INSERT OR IGNORE` (keeps first-write-wins) or document single-writer discipline.

---

## NOTE

### N-1 — Attack A verdicts (R-P2-2 compliance in the diff): CLEAN
(1) No `a || b` resolution chain on embed input or vector lookup anywhere in the diff — the
declared-vs-original split is a null-tested format discriminator (replay-engine.js:395-434),
and precedence-with-both-present follows the declaration (proven,
test-embedSourceProperty.js:123-136). (2) Declared-property-absent REFUSES naming node and
property (replay-engine.js:413-420; asserted with message-regex including the stableId).
Empty declaration refused separately. (3) The old-format branch is the pre-diff code moved
verbatim (message strings byte-identical); existing inline blocks replay through untouched
paths (`embeddingRef && !embedding` discrimination in resolveNodeVectors:578; dual-read in
replay-block deserialize). An existing base block's replay output cannot change. (4) Restore:
a ref present in the block but ABSENT from the store is a named refusal
(replay-engine.js:612-621, "transport gap. No graph written"), placed BEFORE any merge in
writeShapedGraph's task order — no partial writes. Dims mismatch also refused. The gap is
only the no-resolver bypass (M-1/M-2). Also verified: `embedSourceProperty` survives into
block properties (shapeNode's copy loop excludes only _id/_source/embedding/stableId), so
block→graph→block re-harvest round-trips the declaration; `emitEmbeddingRef = !!vectorStore`
(replay-engine.js:846) makes ref-emission-without-store impossible at harvest.

### N-2 — Attack B verdict (zalgo fix): right site, contract improved
embedding-client.js:360. With the fix, ALL success completions of cachedEmbedTexts are
asynchronous (miss path unwinds via HTTP; zero-miss path now setImmediate); the only
remaining in-frame completions are error paths, which terminate serial pipes rather than
recurse — no stack growth. Observable ordering change is exactly the completion tick, which
callers running callback pipes cannot legally depend on. The fix does not mask a deeper
issue; the deeper issue (sqlite-instance callbacks are synchronous) is the documented
project-wide hazard the engine's own eachEntrySequentialStackSafe exists for.

### N-3 — Attack C verdict (R-P2-1 seam): production cannot receive the stub without a code edit
build.js's default is the real `runCedsFidelityGate`
(`deps.cedsFidelityGateRunner || runCedsFidelityGate`, the sanctioned documented-default
idiom); the ONLY production call path (actions.js:438) passes neither
`cedsFidelityGateRunner` nor `vectorStoreResolver` — verified by grep, no non-test injection
exists in the tree. The stub's output ("[fidelity] HERMETIC STUB — R-1 NOT RUN for ...")
cannot be mistaken for the real gate's "[fidelity] PASSED"/statement counts, and test-build
asserts the announcement by regex (test-build.js:578-583). The devlog's real-gate proof (R-1
PASSED lines inside both full-build logs) is the correct three-state complement.
`materializeSchemaBlocks` refuses an absent runner. Tombstone in referenceSubgraph.js
verified comment-only (13 added comment lines, zero code changes).

### N-4 — Attack D verdict (gate honesty): gates assert; twins run on deep clones
G-7/G-13 are declared in hubGates.jsonc with `comparator: isEmpty` over measured violation
arrays and judged by the same roundTripGates harness as Phase 1 — assertions, not
computations; a judged-but-unsupplied measure fails as UNMEASURED (the measure-prefix filter
keeps each suite honest about the other's gates). `runTwins` deep-clones the measurement
bundle (roundTripGates.js:416), so dropOneVector's in-place mutation hits the clone;
dropOneVector re-runs the REAL measure computer over the corruption. The two forge runs are
full independent executions through the registry seam (only the vector cache shared — by
design). Residual weakness is S-3's hash-level determinism twin. `.slice(0,25)` caps only
violation MESSAGES; the filter runs over the full population.

### N-5 — Attack E verdict (vector store): verify-on-read real; absence at materialize is a named refusal with one cosmetic side effect
Verify-on-read has three independent guards (structural, determinant re-hash, payload
re-hash) plus a NUL-tamper guard, and the corruption twin corrupts the row OUT-OF-BAND
(spawned sqlite3 CLI) and observes the refusal — honest. Float32 round-trip: proven exact for
the test's dyadic-rational fixtures; the general contract is double→float32 narrowing on
write with post-narrow comparison — correct as designed (encodeVectorBlob's documented wire
dtype), not bit-exactness of arbitrary doubles. Absent store file at materialize: the lazy
resolver CREATES an empty `<std>.sqlite3` (sqlite init) and then the first getVector absence
triggers the named transport-gap refusal before any write — fail-loud, correct, but it leaves
a misleading empty store file at the canonical home as a side effect. Concurrency: see S-4.

### N-6 — The ref-style flip applies to EVERY vectorized standard's next build, not just ceds
build.js resolves a store whenever a forge report declares embeddingDims, so all future base
blocks (edfi, sif, ...) become ref-style with new blockIds, and their vectors land in the
canonical-home stores (which for lowercase tokens are the incumbent's existing files — the
M-3 commingling generalizes). Sanctioned by TQ's churn ruling; named here because the
deploy-runbook consequence in devlog open item 2 is per-standard, not ceds-only.

### N-7 — Minor test brittleness: stageHubFoldedIntoBase assumes forgeHub calls back synchronously
test-build.js (~line 1277-1287): `expected` is captured from cedsHubForge's callback and used
on the following lines on the strength of a comment ("forgeHub calls back synchronously"). If
the module ever defers, `expected` is undefined at use and the stage fails confusingly. A
guard (`if (!expected) throw`) would make the assumption self-announcing. Same pattern:
embedHubReferenceCards selects cards by `role === HUB_REFERENCE`; a forge-emitted card
missing `role` would skip embedding silently at that seam — defended downstream by G-7's
full-population width check, so noted rather than ranked.

---

## Positive verifications (what passing did NOT hide)

- Census math independently confirmed: 2,750 + 91,825 + 27 = 94,602; 117,786 store rows −
  94,562 distinct card texts ≈ the ~23k vectorized base population (consistent with the
  devlog's dedup note).
- Namespace single home: exactly 1 tree hit for the hub URI (forger.js:331), per the
  registry-row design.
- test-embedSourceProperty proves declared addressing and the original rule by INDEPENDENT
  recomputation against contentAddress — not a mirror of shapeNode's internals.
- The R-P2-1 stub injection appears in every hermetic build call site in test-build/
  test-replay; the -replay path's real-gate no-op (no 'ceds' in standardTokens) matches the
  devlog's claim exactly (build.js runCedsFidelityGate early return).
- Absolute /Users/tqwhite dataStores paths follow the existing actions.js precedent
  (judgmentCache/matchForensics/cedsRoundTrip) — house convention, though M-3/N-6 make them
  newly load-bearing for deployment.
