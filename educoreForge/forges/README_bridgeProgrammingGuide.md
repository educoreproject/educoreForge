# A Programmer's Guide to Bridging a Standard into the CEDS Hub — HISTORY

> ⚠️ **SUPERSEDED AND REWRITTEN AS HISTORY (2026-08-16, B2 of the Bridge System order, BR-142).** This
> file once documented the PRE-RESET mapping side (`genericBridge`, `sifEvidenceBridge`, `caseEvidenceBridge`,
> `MATERIALIZER_CONFIG`, the evidence kit, MATERIALIZE vs REBRIDGE, the three-directory bridge search path).
> All of that was REMOVED from `system/code` in Phase 3 of the root-and-branch reset (2026-08-15,
> RULINGS-supervisor-phase2.md §2) and is recoverable from `system/codeAttic/` and tag `preDemolition-081526`;
> the full text of THIS guide as it stood on 2026-07-30 is `git show preDemolition-081526:./forges/README_bridgeProgrammingGuide.md` (run from this tree; the repo root is one level up).
>
> **To write a bridge TODAY read, in this order:** `system/management/zNotesPlansDocs/forgeDefinitionV2/SPEC-educoreBridgeProfile-v1.0.md`
> (the EDUcore Bridge Profile — predicates, `mapping_justification`, `matchBasis`/`resolution`, provenance),
> `forgeDefinitionV2/SPEC-bridgeFramework-v1.md` (the framework that runs every plugin), and
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
