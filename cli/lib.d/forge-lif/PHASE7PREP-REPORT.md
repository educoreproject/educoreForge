# forge-lif — Phase-7-prep report (the SECOND standard)

**Session:** SILENT_STONE programmer sub-agent — **Date:** 2026-06-19 — **Branch:** `forger-firstApp`
**Verdict:** GREEN. Embedding-free gate 38/38; end-to-end gate 15/15.

This bundle is "Phase 3 for LIF": it harvests-and-adapts the trackA LIF OpenAPI parser into the
universal forge property contract, exactly as `forge-ceds` was built. It mirrors the forge-ceds
structure precisely.

---

## Files (new — all under `cli/lib.d/forge-lif/`)

| File | Role |
|---|---|
| `forgeLif.js` | The bundle: curried factory `({moduleName}) => ({embedder}) => { forge, buildContractGraph, STANDARD_KEY, STANDARD_SOURCE, STABLE_URI_PROPERTY_NAME }`. Emits the universal contract. |
| `lib/parser.js` | LIF OpenAPI reader — returns raw intermediate entities + maps + metadata (no shaping). |
| `lib/normalize.js` | R3 normalization: CEDS element id → canonical `P<6-digit>` cedsId; clean dotted `lifPath` stableId minting + predicates. |
| `test/test-forge-lif.js` | Embedding-free gate (R3 suite, universal-contract, cedsId capture, edges, determinism). |
| `test/test-end-to-end.js` | Full forge → materialize (1B + replay engine) → read-back gate; tears down on success only. |
| `.gitignore` | Ignores `node_modules/`, sqlite, and the large `assets/**/*.json` source blob. |
| `package.json` | `main: forgeLif.js`; no runtime deps (LIF parses JSON natively — no xml2js). |
| `assets/standardSourceData/01/` | Source blob `data_model_1_bare_openapi_schema.1.json` (gitignored), `standardSourceLocation` pointer, `.gitkeep`. |

## What was adapted from trackA forge-lif

- **KEPT (harvested in substance):** the `components.schemas` walk; the three structural patterns
  (flat property, Ref property matching `/Ref([A-Z]\w*)$/`, composite = `type:array` + `.properties`
  up to 3 deep); the composite-name pre-scan index for Ref resolution; enum → optionSet/optionValue;
  the `JUNK_ENTITIES` filter (`TammieEntity`, `Frank Test Entity`); and the **CEDS-element-URL harvest**
  (`extractCedsIds` over `description`/`use_recommendations` at any depth → `cedsGlobalIds`).
- **ADAPTED AWAY:** trackA emitted private `Lif*` nodes (LifEntity/LifComposite/LifProperty/
  LifOptionSet/LifOptionValue) with `HAS_ENTITY`/`HAS_COMPOSITE`/`_parentEdge` plumbing, a hand-rolled
  pipe-joined searchText, and used the graphForge `forgeRunner` parser contract
  `(sourcePath, options, cb) -> {nodes, metadata}`. THIS bundle:
  - Emits the **six canonical Dme\* roles** with **DmeStandardRoot** on top. LIF entities AND
    composites map to **DmeClass** (composites are array-of-object structural containers);
    LifProperty→DmeProperty, LifOptionSet→DmeOptionSet, LifOptionValue→DmeOptionValue.
  - Builds **searchText via the ONE shared 1C builder** (`build-search-text`); empty → `ValidationError`
    (R4). A DmeProperty carries its owning entity/composite name; an OptionValue carries set + owner.
  - **stableUriPropertyName = `lifPath`** (DESIGN §D case 3: LIF identity is structural, like SIF's
    XPath; LIF has no native URIs). `stableId` = the clean dotted `lif:Entity.path...` value, minted
    deterministically; the parser's composite pre-scan paths align so Ref endpoints resolve.
  - Captures LIF's harvested **`cedsGlobalIds`** into a `crossRefs` JSON property **AND** normalizes the
    first to a canonical CEDS **`cedsId`** (R3 — `P<6-digit>`, since CEDS elements are CEDS properties),
    recording origin in **`cedsOriginalAnchorPropertyName: ['cedsGlobalIds']`**. The `DmeStandardRoot`
    `mappingInstruction` likewise names `cedsGlobalIds` as the CEDS anchor field. **This is the LIF→CEDS
    bridge fuel the `specifiedBridgeMaker` consumes at Phase-7 acceptance.**
  - Canonical ownership edges `HAS_CLASS`/`HAS_PROPERTY`/`HAS_OPTION_SET`/`HAS_VALUE` + `REFERENCES`
    (Ref → target), all stamped `provenanceTier: 'structural'` (DECISIONS §10/§11). No legacy edge names.
  - `buildContractGraph` is **pure/deterministic** for `(source, module)`; embeddings added in a
    separate `embedNodes` batch pass (voyage-4-large, batch 128) — identical to forge-ceds.

## EXACT standard-registry row to add (orchestrator applies — I did NOT edit standard-registry.js)

Add to `cli/lib.d/edf-forge/lib/standard-registry.js`, in the `registry` object, mirroring the `ceds` row:

```js
	lif: {
		standardName: 'LIF',
		bundleFactoryPath: path.join(FORGE_BUNDLE_DIR, 'forge-lif', 'forgeLif'),
		defaultSource: path.join(
			FORGE_BUNDLE_DIR,
			'forge-lif',
			'assets',
			'standardSourceData',
			'01',
			'data_model_1_bare_openapi_schema.1.json',
		),
	},
```

(`FORGE_BUNDLE_DIR` and `path` already exist in that file. Key is lowercased `lif` for the
case-insensitive lookup; `standardName` 'LIF'; `bundleFactoryPath` points at `forgeLif` (no `.js`).)

> NOTE: edf-forge's `lib/materializer.js` hardcodes `ref: { source: 'CEDS', ... }`. That stamps
> `_source='CEDS'` on every materialized node regardless of standard. The forge-lif **bundle** is
> correct (every node carries `_source: 'LIF'`); but a real `edf-forge -forge --standardName=LIF`
> run would currently mis-stamp `_source` and the node `ref.source` to 'CEDS' via that shared
> materializer. The forge-lif **e2e test serializes its own LIF-sourced standard block** to validate
> the bundle end-to-end. **Flagged for the orchestrator:** the shared materializer should derive
> `source` from `forged.standardKey`/`STANDARD_SOURCE` rather than hardcoding 'CEDS' before LIF is
> materialized through edf-forge in production. (Edge resolution itself is unaffected — the replay
> engine resolves endpoints globally on `stableId`, ignoring `source` — so this is a provenance-stamp
> correctness issue, not a wiring break.)

## Test commands + full output

### Embedding-free gate — `node test/test-forge-lif.js`  → **38 passed, 0 failed**

```
R3 parser/normalization:  (15 checks)  — all PASS
  R3 normalize CEDS 'https://ceds.ed.gov/element/000021' -> P000021 ... and bare/padded/prefixed forms
  R3 CEDS normalization miss surfaces an error (never silent); unknown kind errors
  R3 lifPath clean dotted form + sanitization + empty-miss errors
universal-contract:  (11 checks) — all PASS
  every node carries _id/_source/name/searchText/lifPath/role; valid role; :ForgedNode; non-empty
  searchText; clean lifPath stableId; structural parentId/depth/path; stableId == lifPath;
  exactly one DmeStandardRoot with stableUriPropertyName='lifPath'; mappingInstruction declared +
  names cedsGlobalIds anchor.
crossRefs / cedsId capture:  (4 checks) — all PASS
  a NON-ZERO count of nodes carry a canonical cedsId (got 6); crossRefs JSON present;
  cedsOriginalAnchorPropertyName=['cedsGlobalIds']; crossRef.id IS the canonical (normalized) cedsId.
edges:  (4 checks) — all PASS
  edge tally: {"HAS_CLASS":62,"HAS_PROPERTY":1023,"REFERENCES":77,"HAS_OPTION_SET":23,"HAS_VALUE":1873}
  canonical ownership types present; every edge provenanceTier='structural'; no legacy
  HAS_ENTITY/HAS_COMPOSITE; 0 dangling internal edges.
determinism:  (3 checks) — all PASS
  identical node/edge structure across two builds (embeddings excluded); identical node/edge counts.

forge-lif gate: 38 passed, 0 failed
  LIF counts: 2982 nodes, 3058 edges, 6 nodes with canonical cedsId
```

### End-to-end gate — `node test/test-end-to-end.js`  → **15 passed, 0 failed** (Docker + live Voyage)

```
forge produced nodes/edges; made embedding calls; captured non-zero canonical cedsId nodes;
every forged node carries a 1024-dim embedding.
replay: nodesMerged=2982, edgesMerged=3058, indexes=["replay_reskey","__TEST_lifValidation_vector"]
replay merged all nodes/edges; no dangling refs.
read-back node count 2982 == 2982; edge count 3058 == 3058.
DmeStandardRoot exists with stableUriPropertyName='lifPath'.
sample DmeProperty lif:Assessment.identifier has lifPath+searchText+1024-dim embedding.
read-back: 6 nodes carry a canonical cedsId (6 in graph == 6 forged).
tore down validation graph '__TEST_lifValidation'.

wall-clock: 23.9s   |   embedding calls: 24   |   nodes-with-cedsId: 6
forge-lif e2e gate: 15 passed, 0 failed
```

## LIF counts
- **Nodes:** 2982 — 1 DmeStandardRoot, 62 DmeClass (entities incl. stubs + composites),
  ~1023 DmeProperty, 23 DmeOptionSet, 1873 DmeOptionValue.
- **Edges:** 3058 — HAS_CLASS 62, HAS_PROPERTY 1023, REFERENCES 77, HAS_OPTION_SET 23, HAS_VALUE 1873.
- **Nodes with canonical cedsId:** **6** (> 0, required) — the LIF→CEDS crossRefs (CEDS element ids
  `000021`→`P000021`, etc.) captured + normalized for Phase-7 specified bridging.

## Deviations
- LIF entities AND composites both map to `DmeClass` (composites are structural array-of-object
  containers; no separate role fits better in the six-role taxonomy). Documented in code.
- LIF's only native cross-reference is to CEDS (the harvested element ids); `cedsOptionId` / value-level
  anchors do not appear in this LIF source, so `cedsOptionOriginalAnchorPropertyName` stays empty.
- The e2e serializes its own LIF-sourced standard block rather than reusing edf-forge's materializer
  (see the registry-row NOTE above re: the materializer's hardcoded 'CEDS' source stamp).

## Confirmations
- **No secret leaked:** Voyage key read ONLY by the core `embedding-client` from
  `voyageEmbedding.ini` via `qtools-config-file-processor`; never on a command line, in env, logged,
  echoed, or committed. Source scan found no hardcoded secrets.
- **No stray Docker:** `__TEST_lifValidation` container + volume torn down (force) at end of the
  successful e2e; `docker ps -a` / `docker volume ls` confirm none remain.
- **No standard-registry edit:** `cli/lib.d/edf-forge/lib/standard-registry.js` was NOT touched
  (git status clean for it). No `git add`/`commit`/`checkout`; no core `package.json` edit; no other
  committed module modified (all required, not edited). Only the new `cli/lib.d/forge-lif/` dir added.
```
