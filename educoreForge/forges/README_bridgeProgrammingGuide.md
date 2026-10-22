# A Programmer's Guide to Bridging — today (standard × hub), and the history before it

## Bridges today: one standard × one hub (deCeds R2–R4, 2026-10-21; written R7, 2026-10-22)

CEDS is a hub, and no framework file knows that. A bridge is no longer a file a programmer writes whole: it is
**composed** from two declarations, one per side, and the framework builds the same plugin it always ran. Every claim
below is a code fact read at `deCeds/r7` (main b0c6b8e5 plus R7's comment edits); the header of each named file is the
authority and says more.

**The two halves.**

| half | file | contract | what it holds |
|---|---|---|---|
| the STANDARD's | `forges/<standard>/bridges/<standard>Bridging.js`, exporting exactly `{ standardBridging, bridgeHooksByFacetName }` | `lib/bridge-framework/standardBridgingContract.js` | `standardKey`, `bridgeNameStem`, and a `facetList`: one row per subject family (`facetName` `''` for a standard's only family, else a capitalised word such as `OptionSet`), each with its `declarationTemplate`, its `subjectRenderingAllowList`, and `pairByHubToken`, ONE PAIR ROW PER HUB IT BRIDGES TO |
| the HUB's | `forges/<hub>/lib/<hub>HubBridging.js`, exporting exactly `{ hubBridging }`, located by the hub bundle's `parserDescriptor.ini` `hubBridgingModule=` (`hubBridgingLoader.js`) | `lib/bridge-framework/hubBridgingContract.js` (every key required; an empty value is stated, never omitted) | `candidateRenderingAllowList`, `promptIdentifierScan`, `sourceAnchorBlindingNameList`, `judgeWording`, `declaredTargetRuleList`, `termKeyForm`, `embeddingModelVersion`, `remodelTableRefList`, `retrievalTier` |

Two hubs declare one today: `forges/ceds/lib/cedsHubBridging.js` and `forges/ctdl/lib/ctdlHubBridging.js`. The hub file
is SEPARATE from the hub declaration on purpose: the hub kit never requires it, so nothing in it can move a hub block
id (plan trap T4; see the header of `lib/hub-framework/hub-framework.js`).

**The composition.** `pluginRegistry.js` discovers every `forges/*/bridges/*.js` at seam-face construction. A standard
bridging file is composed by `bridgeComposer.js`, for each (facet, paired hub), into an ordinary plugin module
`{ bridgeDeclaration, bridgeHooks, bridgeTarget }`, which is registered exactly as a hand-written plugin file was. The
registry's entries, the run, the materialiser and the decision store kept their contracts. The composition reproduces
each existing declaration byte for byte, because its digest (`declarationDigest`) is in the frozen decision block and a
drifted digest refuses the materialise. So every hub-bearing string is DERIVED by rule:

- `bridgeName` = `<bridgeNameStem><facetName><Hub><suffix>`, suffix `DerivedPlugin` | `StandardPlugin` |
  `DeclaredCorrespondence` by `matchBasis` (`BASIS_NAME_SUFFIX_BY_MATCH_BASIS`). The hub token `ceds` gives
  `edfiCedsDerivedPlugin`: the names in every frozen pairKey are reproduced, with no literal (ruling Q-R3);
- `identifierListPath` = `bridges/<stem><Hub>IdList.json` for every existing pair (that string is digested, so the old
  per-plugin list files stay where they are);
- `blindingDeclaration` = the pair row's `blindingOrder` in TODAY'S ORDER, each `{ hubAnchor: i }` replaced by the hub's
  i-th anchor name. A hub edit that changes the length of a list a pair reads by position refuses that pair by name.

A bridge created AFTER the refactor declares the newer forms instead: `blindingOrder: { standardBlindingNameList,
pairedHubAnchors: 'union' }` (blind the anchors of EVERY hub the standard pairs with) and `promptIdentifierScan: 'fromHub'`
(the pair hub's own patterns and list). Existing pairs keep the array form (SCARLET_ARROW, Q-R6 revised: zero re-key
beats uniformity).

A third module shape lives under `bridges/` too: a file exporting exactly `{ structuralDeclaration }` is a STRUCTURAL
producer (`structuralProducerContract.js`; today `forges/ctdl/bridges/ctdlFamilyStructure.js`). Anything else there is
a stray file, refused.

**The recipe names a standard and its hubs, never a bridge** (`apps/graph-builder/lib/recipe-bridge-expansion.js`):

```jsonc
"bridges": [ { "source": "edfi", "hubs": ["ceds"], "dependencies": ["edfi", "ceds"] } ]   // recipes/goldCtdlHub.recipe.jsonc
```

Each entry expands to one pair per hub, in order. `facet` is required when the standard has more than one facet. A hub
the standard's facet does not declare in `pairByHubToken` is refused: a pairing exists only when the standard declares
it. The OLD form `{ source, hub, bridge }` still loads and gives the same digests; refusing it is docketed
(`DEFERRED-rekey-102126.md` row R7-1). A converted recipe's text changed, so its `recipeHash` changed; that is metadata
beside the manifest, never part of its refId.

**Adding a pairing.** Add a pair row under the hub's token in the standard's bridging file, then name the hub in a
recipe. Until someone runs `--rebridge` for it, the pair has no frozen decision block: a `golden` recipe REFUSES it by
name (`apps/graph-builder/lib/frozenDecisionBlockRule.js`, plan trap T1), and a `dev` recipe reports zero edges. Composing
a pair therefore costs nothing until someone asks it to judge. Two measured cautions before the first JUDGED bridge to
CTDL: the CTDL forge makes no embed-text nodes, so `embedTextVote-v1` cannot target it (DEFERRED R3-F1); and CTDL's own
prose cites `ceterms:` CURIEs that the CTDL hub's identifier scan refuses (DEFERRED R3-F2).

**The judge's words come from the hub** (R4, TQ ruling Q-R1 (i)). The tool description's candidate noun is
`hubBridging.judgeWording.toolCandidateNoun`, carried per bridge in `bridgeTarget` and handed to every render
(`apps/graph-builder/apps/bridge-maker/lib/selectCandidateSchema.js`). CEDS declares today's exact text, `'CEDS candidate'`,
so every existing prompt, tool-schema sha and judgment-cache key is byte-identical. CTDL declares `'CTDL candidate'`. A
judge asked without a noun refuses by name; there is no default.

**What a build spent** (R1). Every judge and embedding call is recorded with provider, model, tokens, latency, cache hit
and `usd`, priced from `spendPricing.ini` (`graphBuilder.ini [spendLedger] spendPricingFilePath`). A model with no
price is refused by name; a debug-judge unit is $0, priced by `'debug'`. Each `-build` writes `<run dir>/spendLedger.json`
and appends one line to the lifetime ledger; `graphBuilder -spendLedger [--since=…] [--recipe=…]` reads it
(`lib/spend-ledger/`; `graphBuilder -help`).

**Running without spending.** `--useDebugJudge` answers every unit with a zero-cost debug judgment, never cached.
`--embeddingCacheOnly=true` answers embeddings only from the vector cache and refuses by name, before any provider
call, on the first batch with a miss (`lib/embedding/embedding-client.js`). Together they make a run zero-spend by
construction. `--bridgingOverlayDirPath=<dir>` (dev recipes only) replaces a tree bridging file for one run, so a
pairing nobody has shipped can be exercised (the fixture `apps/graph-builder/test/fixtures/deCedsPcOverlay` carries an
Ed-Fi → CTDL row; it is not shipped).

**The no-rebuild proof kit** (R0; plan §4.5). A refactor of this layer must prove it changed nothing, at no cost:

| proof | what it shows | where |
|---|---|---|
| P-a1 | every bridge of every recipe of record resolves to a frozen pairKey, and its composed `declarationDigest` equals the frozen one | `apps/graph-builder/test/test-noRebuildDigestGate.js` (in runAllTests) |
| P-a2 | every gated recipe of record re-materialises in process from its frozen blocks to the same relationship-block refIds | `node --max-old-space-size=16000 apps/graph-builder/tools/noRebuildMaterialiseAll.js` |
| P-b | a fixed sample of real judge questions re-rendered under this tree: the re-keyed set (judgment-cache keys that would move) | `apps/graph-builder/tools/renderOnlyJudgeDiff.js -capture` / `-compare` |
| P-c | the composed path end to end under the debug judge and cache-only embedding, on a new pairing (the overlay fixture) | a dev recipe, `-build --rebridge=<source> --useDebugJudge=digest --embeddingCacheOnly=true --bridgingOverlayDirPath=…` |
| P-d | the DME question set answers as before, except named text | the educore repository |
| P-z | one plain zero-spend `-build` of the gold recipe over copied stores and caches: the manifest identical but the recipe hash | the supervisor's certificate |

The baselines the kit reads are declared in `graphBuilder.ini [noRebuildProof] baselineDirectoryPath`. Two tools
support it: `apps/graph-builder/tools/blockCompare.js` (two stores' frozen blocks or manifests, compared with the
frameworkFingerprint substituted, never by sha) and `apps/graph-builder/tools/hubLiteralCensus.js --hubToken=<hub>`
(a hub's name outside its own bundle, by class; the code class may never rise).

---

**Which property names a hub's version.** On a built graph the `:HubDefinition` carries its hub's release in `version`
(measured on GOLD_EVAL_261021_ctdlHub, 2026-10-22, zeroBacklog lane D: `"14.0.0.0"` and `"Release 20260327"`). There is no
`hubVersion` property; a query for it reads NULL for every hub, which is how deCeds P-c's green Cypher came to report none.
The query: `MATCH (h:HubDefinition) RETURN h.hubName, h.version`.

## History


> ⚠️ **SUPERSEDED AND REWRITTEN AS HISTORY (2026-08-16, B2 of the Bridge System order, BR-142).** This
> file once documented the PRE-RESET mapping side (`genericBridge`, `sifEvidenceBridge`, `caseEvidenceBridge`,
> `MATERIALIZER_CONFIG`, the evidence kit, MATERIALIZE vs REBRIDGE, the three-directory bridge search path).
> All of that was REMOVED from `system/code` in Phase 3 of the root-and-branch reset (2026-08-15,
> RULINGS-supervisor-phase2.md §2) and is recoverable from `system/codeAttic/` and tag `preDemolition-081526`;
> the full text of THIS guide as it stood on 2026-07-30 is `git show preDemolition-081526:./forges/README_bridgeProgrammingGuide.md` (run from this tree; the repo root is one level up).
>
> **To write a bridge TODAY read, in this order:** `apps/graph-builder/README_BridgeDocumentation/README_BridgeProfile.md`
> (the EDUcore Bridge Profile — predicates, `mapping_justification`, `matchBasis`/`resolution`, provenance),
> `apps/graph-builder/README_BridgeDocumentation/README_BridgeFrameworkSpecification.md` (the framework that runs every
> plugin; the old `forgeDefinitionV2/SPEC-*` files are MOVED stubs since 2026-10-11), and
> `lib/bridge-framework/README.md` (the plugin shape: a DECLARATION + a walk + a subject rule; the toy fixture
> under `lib/bridge-framework/test/fixtures/toyBridge/` is the first worked instance). Nothing below is how the
> tree is wired now.

## What the pre-reset mapping side was (past tense throughout)

**A bridge was a module that produced mapping judgments as graph edges.** CEDS was the hub. A bridge walked a
source standard's forged elements, gathered CEDS candidates, had an LLM judge the evidence, froze the decisions
into a content-addressed block, and materialized edges through an injected, guarded writer. Two properties
defined the layer: decisions were frozen once per `--rebridge` and replayed verbatim by every plain `-build`;
and a bridge never touched the substrate — all writes went through `kit.writer`.

**The zero-code path was `genericBridge`.** A recipe named the library bridge in `bridges[]` and the standard
was evidence-judged against CEDS with no bridge code of its own. Custom bridges (`caseEvidenceBridge`,
`sifEvidenceBridge`, `ctdlAuthoredBridge`, `authoredAnchorBridge`) composed the identical shape.

**The evidence architecture was a per-source pipeline:** walk → read CEDS HubReference candidates → vectorize
(embed every source and candidate `defText`) → per source: compose evidence (`kit.evidenceComposer` +
`kit.cedsHubModule`) → the ⟪A3⟫ evidence-package shape gate → render one prompt (`kit.evidenceRenderer`) →
select (`kit.evidenceSelect`, the injected `llmClient` — Opus judged) → normalize confidence
(`kit.confidenceNormalizer`) → freeze into a content-addressed decision block (`kit.evidenceFreezer`) →
materialize. Six contracts lived in `apps/graph-builder/apps/bridge-maker/lib/evidenceContracts.js`
(`CONTRACT_STATUS = 'HARDENED'`): evidence package, match/compose, hub module, renderer (with a required
`RENDERER_VERSION`), select, normalizer — each enforced by a named gate function, the renderer and normalizer
gates proving determinism mechanically by calling twice. R7 (TQ ruling 2026-07-29): every contract callable was
callback-shaped whether it needed one or not.

**MATERIALIZE vs REBRIDGE** was dispatched off `kit.rebridge`, the literal last statement of every bridge
module. MATERIALIZE (the plain-build default, zero LLM calls) loaded the pair's frozen block by
`pairKey 'CEDS::<SOURCE>'` and replayed it; with no block it reported zero inferred edges explicitly
(`noDecisionBlock: true`). REBRIDGE ran the full evidence flow and froze a fresh block.

**Where a bridge lived and how it was found:** `forges/<standard>/bridges/<name>.js` for a standard-local
bridge, `forges/bridges/` for a shared one, found by a THREE-scope directory search with no precedence — a
same-named file in two scopes threw. Requires from a bundle-local bridge climbed three levels to the tree root.
Each bridge carried its own `EVIDENCE_GENERATION` constant.

**What replaced all of it, and why.** The reset judged the layer irreducibly per-standard: each bridge
re-implemented the pipeline, the search path resolved by directory rather than by registry, and nothing
guaranteed that two bridges made the Profile's choices the same way. Under the framework a plugin is DATA plus
two hooks; the pipeline, the multimap, cardinality classification, the judge, the freeze/replay, SSSOM export,
every refusal and the census are made once in `lib/bridge-framework` and observed red once in its gate suite.
There is no `genericBridge`, no evidence kit, no embedding in the bridge, no reranking pre-pass, no directory
search: `forges/<standardKey>/bridges/*.js` is DISCOVERED into a frozen registry at seam-face construction and a
recipe names a plugin by its declared `bridgeName`.

*Rewritten from the 2026-07-30 text by FROZEN_STREAM (B2), 2026-08-16. The text as it stood immediately before
this rewrite — including the one in-place Phase 4 K2 correction to the old `MATERIALIZER_CONFIG` justification
line — is `git show preBridgeFramework-081626:./forges/README_bridgeProgrammingGuide.md`.*
