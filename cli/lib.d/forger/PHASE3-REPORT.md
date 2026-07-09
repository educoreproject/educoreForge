# Phase 3 Report — `edf-forge` CLI + CEDS forge bundle

**Session:** SILENT_STONE (programmer sub-agent) — **Branch:** `forger-firstApp` — **Verdict: GREEN**

Builds the forger (first app): the `edf-forge` CLI and the CEDS forge bundle, adapted to the
universal forge property contract. All four test-gate categories pass; full CEDS forged and
materialized into a real Neo4j validation graph and read back by cypher.

---

## Files created

### CLI — `cli/lib.d/edf-forge/`
- `edfForge.js` — Layer-1 orchestrator. Bootstraps `process.global` (xLog console-based; getConfig
  via qtools-config-file-processor over `system/configs`; commandLineParameters via
  qtools-parse-command-line). Instantiates shared resources (forge-store, credential-accessor,
  instance-lifecycle, embedding-client), resolves the bundle from `--standardName` via the
  registry, runs `bundle.forge(...)`, then materializes. `-help` matches `helpSpec.md`.
- `lib/standard-registry.js` — Layer-2 `standardName → forge-bundle` REGISTRY (registry, not
  switch). One row adds a standard; no CLI code changes.
- `lib/materializer.js` — Layer-2. Serializes ONE `standard` block via `replay-block.serializeBlock`
  (header: blockType `standard`, standardKey, stableUriPropertyName/resolutionKey `uri`,
  serializerVersion `1`, embedding* fields, embeddingDims 1024), provisions/reuses the destination
  validation graph via the 1B instance-lifecycle, replays via the Phase-2 engine. **Never tears
  down on error.**
- `test/test-end-to-end.js` — the GATE end-to-end run.
- `package.json` — main `edfForge.js` (symlink command name `edfForge`).
- `PHASE3-REPORT.md` — this file.

### CEDS bundle — `cli/lib.d/forge-ceds/`
- `forgeCeds.js` — Layer-3 forge bundle. `buildContractGraph` (PURE/deterministic) emits the six
  Dme* roles with the universal contract; `embedNodes` is a batched 1C `embedTexts` pass;
  `forge()` orchestrates parse → build → embed.
- `lib/parser.js` — CEDS RDF/XML reader (harvested+adapted from trackA; see below).
- `lib/normalize.js` — R3 anchor normalization to canonical `cedsId`.
- `test/test-forge-ceds.js` — embedding-free fast gate (R3 + contract + edges + determinism).
- `assets/standardSourceData/01/CEDS-Ontology.rdf` — the 19 MB source asset, copied into the bundle.
- `package.json` + `node_modules/` — declares & installs `xml2js` (the only bundle dep).

---

## standardName → bundle registry

```
ceds → { standardName: 'CEDS',
         bundleFactoryPath: lib.d/forge-ceds/forgeCeds,
         defaultSource: lib.d/forge-ceds/assets/standardSourceData/01/CEDS-Ontology.rdf }
```
Lookup is case-insensitive on `--standardName`. A second standard is one new row.

---

## Harvested-from-trackA vs rewrote

**Harvested (kept, proven):** the RDF/XML element extraction in `lib/parser.js` —
`getText`/`getAttr`/`getResourceRefs`/`isCedsUri`/`hasConceptSchemeType` and the
class/property/optionSet/optionValue extractors, plus the discipline of keeping only entities
with a native `dc:identifier`. trackA's filtered counts (classes=402, properties=2324,
optionSets≈965, optionValues=19546) reproduce exactly.

**Rewrote (adapted to the contract):** trackA's node-shaping. trackA emitted private `Ceds*`
nodes with a hand-rolled `name: description` searchText, `PART_OF` edges, and per-node counts on
the root. The new `forgeCeds.js`:
- emits the six canonical **Dme\*** roles (triple-labeled `:ForgedNode` + per-standard `:Ceds*` +
  role), with **DmeStandardRoot** as the per-standard top carrying the provenance block,
  `stableUriPropertyName:'uri'`, and a DECLARED-but-unpopulated `mappingInstruction` (§12);
- builds `searchText` via the **ONE shared 1C builder** (a Property carries its owning Class name —
  the CEDS hub fix; empty ⇒ ValidationError at forge time, R4);
- normalizes native anchors to canonical `cedsId` (`P000113`/`C000113`/`OS…`/`OV…`, R3), keeping
  native forms in `cedsOriginalAnchorPropertyName`;
- writes the **canonical ownership edges** `HAS_CLASS`/`HAS_PROPERTY`/`HAS_OPTION_SET`/`HAS_VALUE`
  (+ `SUBCLASS_OF`/`REFERENCES`), **all stamped `provenanceTier:'structural'`** — no `PART_OF`;
- stores `crossRefs` as a JSON property (§9), stableId = the node's `uri` (§D);
- carries `parentId`/`depth`/`path` on structural nodes;
- is PURE/deterministic for (source, module) on the build layer; embeddings are a separate pass.

`lib/normalize.js` is new (R3). `customEmbedHandler.js` was NOT harvested — the batched 1C
`embedTexts` pass replaces it (CEDS option values ARE embedded; no per-role exclusion).

---

## embedTexts addition + 1C re-test

Added ONE additive, non-breaking method `embedTexts({texts}, cb)` to the 1C embedding client
(`npm/qtools-graph-forge-core/lib/embedding/embedding-client.js`): a BATCHED `voyage-4-large` call
returning `{ vectors: Float32Array[], embeddingModelVersion }` aligned 1:1 with input order. The
existing `embedText` and all other exports are unchanged (the provider's `embed` already accepted a
text array, so no provider change). Exported alongside `embedText`.

**1C regression re-test — `lib/embedding/test/embedding-client-test.js`: 3 passed, 0 failed**
(base64 round-trip + live voyage-4-large 1024-dim call + stamped model version). No regression.

---

## Full test output

### Fast gate — `forge-ceds/test/test-forge-ceds.js`: **31 passed, 0 failed**
- **R3 parser suite (15 checks):** URL / `ceds:` prefix / bare-number / already-canonical forms all
  normalize to canonical `P/C/OS/OV` ids; a no-digit input and an unknown role kind both surface an
  error (never silent). Built graph: 23,238 nodes / 24,015 edges.
- **universal-contract (11 checks):** every node carries `_id/_source/name/searchText/stableId/role`
  + `:ForgedNode`; valid role from the six; structural nodes carry `parentId/depth/path` + canonical
  `cedsId`; exactly one DmeStandardRoot with `stableUriPropertyName='uri'` + declared
  `mappingInstruction`; DmeProperty.stableId == its uri; crossRefs is a JSON string.
- **edges:** tally `{HAS_CLASS:402, SUBCLASS_OF:398, HAS_PROPERTY:2324, HAS_OPTION_SET:994,
  REFERENCES:351, HAS_VALUE:19546}`; canonical ownership types present; every edge
  `provenanceTier='structural'`; no `PART_OF`.
- **determinism (3 checks):** two builds of the same source produce byte-identical node/edge JSON
  (ingestedAt timestamp stripped; embeddings inherently absent on the pure layer); equal counts.

### End-to-end gate — `edf-forge/test/test-end-to-end.js`: **13 passed, 0 failed**
Forge FULL CEDS → materialize (1B provision + Phase-2 replay) → read back by cypher → teardown.
- forge: 23,238 nodes, 24,015 edges, **182 embedding calls** (128/batch), every node a 1024-dim
  embedding.
- replay: nodesMerged 23,238, edgesMerged 24,015, **0 dangling refs**, indexes built
  `["replay_reskey", "__TEST_cedsValidation_vector"]` (real GA vector index — neo4j:5.26).
- read-back: node count 23,238 ✓, edge count 24,015 ✓, DmeStandardRoot exists with
  `stableUriPropertyName='uri'` ✓, sample `DmeProperty` (stableId
  `https://w3id.org/CEDStandards/terms/P002029`) has stableId+searchText+1024-dim embedding ✓.
- **wall-clock: 456.8s.** Validation graph torn down at the end (force). No teardown on error path.

### CEDS counts forged + materialized
- **Nodes: 23,238** (1 DmeStandardRoot + 402 DmeClass + 2,324 DmeProperty + 965 DmeOptionSet +
  19,546 DmeOptionValue).
- **Edges: 24,015** (402 HAS_CLASS, 398 SUBCLASS_OF, 2,324 HAS_PROPERTY, 994 HAS_OPTION_SET,
  351 REFERENCES, 19,546 HAS_VALUE), all `provenanceTier='structural'`.

---

## Deviations + rationale

1. **CLI command name is `edfForge`, not `edf-forge`.** `initCli.js` derives the symlink command from
   `package.json.main` (`edfForge.js` → `edfForge`), the project's filename-based convention. The
   `-help` text, banner, and helpSpec semantics all read `edf-forge`; only the shell command differs.
   No code beyond the symlink name depends on this.
2. **`forgeCeds` gets a spurious symlink.** `initCli.js` symlinks any lib.d directory's `main`, so the
   library bundle `forge-ceds` is registered as a `forgeCeds` command. It is a library (no standalone
   bootstrap), so invoking it directly is a no-op; harmless. Left as-is to avoid touching shared
   initCli logic.
3. **Determinism comparison strips `ingestedAt`** (a wall-clock provenance timestamp on the root) and
   excludes embeddings (voyage is not re-called twice). The structural parse/build layer is otherwise
   byte-identical, which is the determinism claim that matters.
4. **REFERENCES edges added** for property ranges that point at a CEDS class rather than an option
   set (DESIGN §F). Not in trackA; conforms to the spec's reference taxonomy. Stamped `structural`.
5. **forge-store lands at `system/dataStores/forgeStore.sqlite3`** for real CLI runs (created if
   absent); tests use a temp sqlite under the OS tmpdir and clean it up.

## Confirmations
- **No secret leaked:** the Voyage key is read ONLY by the 1C embedding-client from
  `voyageEmbedding.ini` via qtools-config-file-processor — never on the command line, in env, logged,
  echoed, or committed. Grep of all new files finds no secret literals.
- **No stray Docker:** the validation graph container + volume are torn down on success; a post-run
  scan finds no `__TEST_`/`cedsValidation` containers or volumes. Teardown is suppressed on the error
  path by design (DECISIONS §14).
- **Hard rules honored:** no git operations; no `npm install`/`package.json` edits in the core
  package; the only core change is the additive `embedTexts` (re-tested GREEN). xml2js installed only
  in the new `forge-ceds` bundle. qtools async paradigm throughout (taskListPlus/pipeRunner, no
  async/await, no try/catch-for-control-flow except localized parse boundaries); registry-not-switch;
  curried moduleFunction DI; camelCase only.
