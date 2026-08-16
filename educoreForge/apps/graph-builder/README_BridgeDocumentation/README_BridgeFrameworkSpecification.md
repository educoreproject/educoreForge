# EDUcore Bridge Framework — specification v1.1.3

> **v1.1.3 (supervisor, 2026-08-16 21:20, at B2 CLEAR — HEAD `611888f`):** the specification is amended to match the
> code where B2 deviated with a NAMED reason (the code wins, then the spec is amended, never silently), and to carry
> the B2 adversarial-review rulings (`reviews/REVIEW-B2-adversarial-081626.md`; `RULINGS-supervisor-bridgeFramework.md`
> "B2 review rulings" BR1–BR12). **Deviations accepted (a)–(j):** (a) `graphSeamRules.js` is the pure module shared by
> both bolt files AND `test/testSupport/graphDouble.js` — the I/O halves are thin; (b) the hub is MEASURED from the
> cards, one hub per pairing; (c) the remodel table is hub-owned DATA at `forges/<hubToken>/bridgeData/`, digested into
> the block; (d) `MappingReview` is a matchForensics record, not a graph node; (e) the SSSOM TSV lands at
> `<matchForensicsDirPath>/<pairKey>/<blockId>.sssom.tsv`; (f) BG-JUDGE(g) exempts the debug double; (g)
> `consistencyCheckValueByColumn` runs on walk assertions; (h) `subjectStableIdFor` I/O keyed by `subjectKey`; (i) the
> framework drops AND counts sentinel rows; (j) `MAX_JUDGMENT_COUNT_PER_RUN` is framework data (20 000) with a
> test-only override, and its declared value is PINNED by a conjunct. **Review rulings now normative:** BR1 — a NEW
> gate family **BG-BOLT** proves the two bolt files (`graphReader.js`, `graphWriter.js`) by BEHAVIOURAL parity with the
> double through a driver double (both endpoints stamped; `forEvidence()` blinded — nodes AND edges (BR6); `_source`
> scope; refusals at the seam), each conjunct with a production-mutation twin of the BOLT file; a containerised
> smoke gate BG-BOLT-LIVE is B3's. BR2 — §8: `subject_id` is the forged stableId VERBATIM (it already carries the
> standard prefix); a stableId not beginning with `<subjectCuriePrefix>:` REFUSES by name, never prepended; BG-P7 gains
> the single-prefix/colon-free-reference conjunct. BR3 — the MAPPING_PROPERTIES closed set has a twin (a stray property
> refused). BR4 — §4.1 `globalGuidanceList` is CONDITIONAL: REQUIRED iff `evidenceHooksDeclared.globalGuidance` is
> true, FORBIDDEN otherwise (supersedes the v1.1.1 BF18 wording; §10.1 as printed — no key — validates). BR5 — every
> channel's `headerColumnList`, value tier included, is verified count AND names. BR7 — §5.5 the sibling conflict
> lookup spans the PAIRING: every REGISTERED bridge × every vocabulary producerKind (a de-registered bridge's block is
> out of scope in v1 — noted). BR10 — BG-CENSUS(c) asserts `subjectCount` against the WALK's surviving distinct
> subjects (independent source; the tautological sum invariant is retired); BG-THREE(g) `matchId` distinct per edge.
> Gate totals at CLEAR: 12 files, 280 conjuncts, 286 twin runs, every conjunct observed red; fleet 80/80 with
> `test-embeddedEndToEnd` excluded by ruling (needs Docker + Voyage). Sections touched by reference only — the
> normative text below is read WITH this note; a later editorial pass may fold it in.
>
> **v1.1.2 (supervisor, 2026-08-16 12:20, B2 ruling):** replay-engine GUARD 3 refuses any edge without a valid `provenanceTier` and replay is untouched — so §5.7's "PROVENANCE_TIER retires" and BG-THREE(f)'s "absent" are SUPERSEDED: the writer stamps the FIXED engine-level value derived from producerKind (authored → `'spec-authoritative'`, inferred → `'embedding-inferred'`, debug → `'invalid-debug'`); BG-THREE(f) asserts that value; it is never exported to SSSOM and carries no mapping semantics (Bridge Profile v1.0.6 §4.6). MAPPING_EDGE_PERMITTED_PROVENANCE_TIER_LIST = those three.

> **v1.1.1, 2026-08-16 11:50 — micro-pass BF18** (supervisor, on the two items the synthesizer flagged
> un-ruled): §4.1 gains `globalGuidanceList: string[]` (the value shape for the `globalGuidance` hook;
> refused if `evidenceHooksDeclared.globalGuidance` is false and the list is non-empty; each string
> candidate-blind); BG-PRODUCER gains conjunct (d) — every `PRODUCER_KIND_LIST` entry has a NON-EMPTY
> suffix in `RELATIONSHIP_PRODUCER_SUFFIX` (the `build.js:1741` truthiness-guard hazard, REVIEW A1),
> twin = a vocabulary registry double with `''` for `authored`. Sections touched: header, §4.1, §4.2, §13.2.
>
> **v1.1, 2026-08-16 10:55–11:40** — remediated after the independent adversarial review
> (`reviews/REVIEW-bridgeFramework-adversarial-081626.md`, verdict NOT-BUILDABLE: three foundations
> wrong against the code — the judge's return shape, the single global `applyLabel`, the relationship
> block's contents — and the Ed-Fi worked example failing its own validator and its own run-refusal)
> under the supervisor's batched rulings **BF1–BF17** (`RULINGS-supervisor-bridgeFramework.md`, 10:55
> block; where the review offered a choice the ruling picks; where the review and a ruling differ the
> ruling wins). Every code citation added here re-verified at HEAD `bc3167f` (`grep -a`). Sections
> touched: header; §1 (terms: relationship block, pair-scoped label, rendered pool order); §3.2 (tree
> libs — `fingerprint.js` struck; `applyLabel` pair-scoped); §3.3 (`refuse.byName` returns an Error;
> `RUN_REPORT_RESULT_KEYS` carries `blocks`); §4.1 (per-channel `columnClassification`,
> `headerOverrideByIndex`, `channelPropertyList`, `segmentNormalisationRuleList`, `range` declarable,
> `sentinelOnly` disposition, `identity`/`globalIdToPrefixedKey` transforms, `RUN_CONFIG_KEY_LIST`); §4.2
> (`sourceReader.forWalk()`/`forEvidence()`); §4.3 (lift struck — mirror; per-channel coverage); §5.0
> (unknown `config` keys refused; `cacheMode`/`pinBlockId` refusal dropped); §5.2 (step 1 purpose-scoped
> reader; step 6 sentinel-scoped label census); §5.4 (explicit first-match DISPATCH ORDER; overlapping
> tentative rows merged); §5.5 (conflict = refusal of the SECOND plugin's materialisation; "withheld"
> struck); §5.6 (BF1: the judge's REAL return, ordinal→stableId in the framework, `putJudgment` payload,
> no predicate slot; `llmClient`/`debugJudge` UNCHANGED); §5.7 (pair-scoped label; `MAPPING_PROPERTIES`
> closed-set check is NEW code); §5.8 (per-subject PRECEDENCE rule; `conflictCount` report-only;
> `labelRefusedCount`, `sentinelLabelledRowCount`); §5.9 (BF2: `blocks[]` with pair-scoped `applyLabel`);
> §6 (writer label; conservativity = no non-mapping EDGE); §7 (BF3: the relationship block carries NODES
> and EDGES; id coupling; `frameworkFingerprint` new code; `decision-store` citation corrected); §7.4;
> §8 (SIF `subject_match_field` = `sif:cedsId`); §10.1 (Ed-Fi declaration REWRITTEN to pass BG-DECL:
> per-channel classification, `Not in CEDS` row, `headerOverrideByIndex`, option-value blinding names,
> full label census); §10.3 (`segmentNormalisationRuleList` declared); §10.4 (BF4: census FROZEN from
> the first accepted classifier run; measured inputs; per-row counts); §11 (BF13: `crossRefs` JSON
> string, `identity` transform, `channelPropertyList`, option-value blinding); §12 (artefact freezing
> order); §12.1 (BF9: `test/acceptance/` excluded; base tag); §13 (BG-JUDGE re-specified; BG-CONSERV(d);
> BG-HARVEST added; BG-CONFLICT, BG-CENSUS, BG-LABEL-RUN, BG-BLIND, BG-THREE(d), BG-DEBUG(d), BG-NOSUB,
> BG-SEAM-UNTOUCHED (base tag; exception (iii) struck; BF10 scope), BG-P7(g) `author_id`, BG-CENSUS
> sourceSideMismatch reconciliation); §14.1 (file list: `graphWriter` closed-set check, fingerprint
> hasher, writer double new); §14.3 (BF12 reuse table corrected); §14.4 (BF10 budget); §15 (items 4, 7,
> 12, 14 reworded); §17; Appendix A (rulings-file annotations G4/G5). Line references to the Profile now
> at **v1.0.5** (BF16, supervisor edits).
>
> Written 2026-08-16 by CELESTIAL_SIGNAL (B1 SYNTHESIZER) under SABLE_RIVER, from the three B1
> position papers — `drafts/B1-architect.md` (COBALT_RIDGE), `drafts/B1-pluginImplementer.md`
> (OCEAN_PEAK), `drafts/B1-riskTester.md` (COPPER_TIDE) — under the binding rulings in
> `RULINGS-supervisor-bridgeFramework.md` (which override any paper), against
> `SPEC-educoreBridgeProfile-v1.0.md` at **v1.0.5** (the Profile), `REQUIREMENTS-bridgeSystem-v1.md`
> (BR-001..BR-145 with R3 rulings), `PLAN-bridgeSystem-v1.md` (the seven "Be smart" rulings, settled),
> `FINDING-edfiCrosswalkColumns.md`, `SEAM-bridgeMakerStub.md`, `HARVEST-bridgeKnowledge.md`,
> `RULINGS-supervisor-phase2.md` C1–C8, `RULINGS-supervisor-phase6.md` (+addendum), and the idiom to
> mirror, `README_ForgeFrameworkSpecification.md` v1.1 (`⟨FF §n⟩`). Code read read-only at
> `architecture-improvement` HEAD `bc3167f` (`grep -a`); the seam facts this document leans on hardest
> (`build.js` producer inference `:1736-1745`, `vocabulary.js` `RELATIONSHIP_PRODUCER_SUFFIX` `:158-178`
> and `MAPPING_PROPERTIES`, `interfaces.js` `resultKeys`/`BRIDGE_MODULE_SHAPE`, the surviving
> `apps/bridge-maker/{bridgeMaker.js, lib/*}` and `lib/forge-framework/*` file lists) were re-read in the
> tree. Nothing was built, run, or committed to write this.
>
> **Every MUST carries a trace in angle brackets to its source.** `⟨Profile §n⟩`; `⟨BR-nnn⟩`;
> `⟨PLAN Be-smart n⟩`; `⟨ARCH §n⟩` / `⟨IMPL §n⟩` / `⟨RISK §n⟩` (the three papers); `⟨RULING An⟩` /
> `⟨RULING Rn⟩` / `⟨RULING Pn⟩` (the rulings file's three tables, rows numbered top to bottom:
> A1–A12 after the architect, R1–R10 after the risk-tester, P1–P12 after the plugin-implementer);
> `⟨RULING BFn⟩` (the 10:55 post-review block, BF1–BF17); `⟨REVIEW §x⟩` (the adversarial review);
> `⟨SEAM §n⟩`; `⟨HARVEST §n⟩`; `⟨FF §n⟩`; `⟨C n⟩` (phase-2 rulings); `⟨DOCTRINE⟩`. Where the papers
> disagreed, the disagreement is stated and the ruling that settled it is named (Appendix A); where
> no ruling exists, §15 carries the decision as MUST DECIDE with a recommendation. `[code fact]`,
> `[measured]`, `[design]` carry the Profile's meanings; `[design]` is the default for unmarked
> normative text here, because this IS the design.

This specification defines the Bridge Framework: ONE shared library that satisfies the EDUcore Bridge
Profile for every mapping bridge with shared code, so that each of the Profile's choices — tuple
addressing, the multimap, cardinality classification, the judge and its double, the frozen block and
its replay, SSSOM export, every refusal and the census — is made once and observed red once. It
specifies the framework object and its public surface, the declaration object a plugin author writes
instead of code, the two hooks a plugin author supplies, the pipeline that satisfies `build.js`
Phase C's seam unchanged, the kit-only door for edges, the two content-addressed artifacts and their
replay, the exporter, the plugin registry, the Ed-Fi plugin as the first instance and the SIF plugin as
the composability proof, the acceptance test, the gate suite with a red twin per conjunct, what the
framework refuses to offer, where it lives, and the decisions left to the supervisor.

TQ's mandate ⟨PLAN⟩: "if by specification you are talking about bridge-framework and its ed-fi
implementation, I agree that's first. Go for it. Be smart." The seven Be-smart rulings are elaborated
here, not reopened.

**The acceptance test, binding on every section** ⟨PLAN Be-smart 6⟩ ⟨RULING P3, P12⟩ ⟨RISK §0.1⟩: a
bridge plugin on the framework is correct when, run through the UNCHANGED graphBuilder Phase C
(`bridgeMaker.run` as `build.js` calls it), it produces (i) a frozen, content-addressed DECISION BLOCK
whose per-subject cardinality census EQUALS — no tolerance band — a frozen fixture measured on a NAMED
graph and keyed by that graph's id and the plugin's label-table digest (Ed-Fi Elements on
`GOLD_EVAL_260816`: **992 specified / 151 judged / 3 orphan** per subject — the PROJECTED figure,
FROZEN from the first accepted classifier run in B3 ⟨RULING BF4⟩), and (ii) a RELATIONSHIP BLOCK
harvested from the graph (nodes AND edges) under a PAIR-SCOPED label, whose id is a function of the
decision block's; every mapping edge carries `matchBasis`, `resolution`, a SKOS predicate and
`decisionBlockHash`; zero `semapv:UnspecifiedMatching`; the SSSOM/TSV export validates; the Profile
§7 seven gates and the BR §8 thirteen (BR-100..BR-112) are green with their twins observed red per
conjunct; `-goldEvalCheck` still PASSES; and the
composability gate — a SECOND plugin (SIF, `matchBasis: standard`) through the same seam with ZERO
framework change, asserted three ways mechanically (§12.1) — is green.

---

## 1. Terms

Terms defined in the Profile §1 (card, canonicalKey, crosswalk, matchBasis, resolution, semapv, SSSOM,
tuple) and in the Forge Framework spec §1 (refusal by name, block determinism, polyArch2, the doctrine,
gate, twin, conjunct) keep their meanings. This document adds:

**the framework** — `lib/bridge-framework/`, the library this document specifies; its factory returns
**the framework object** (`bridgeFramework`) whose ONE orchestration member is `run`.

**the seam face** — `apps/graph-builder/apps/bridge-maker/bridgeMaker.js`, the module `build.js`
constructs with no arguments and calls `run(spec, callback)` on. It replaces the stub. It constructs
the framework with the real registry and the real reader/writer factories and forwards `run` ⟨RULING A2⟩.

**plugin** — a file `forges/<standardKey>/bridges/<name>.js` exporting `{ bridgeDeclaration, bridgeHooks }`:
a declaration object (DATA) and exactly the hooks §4.2 names. A plugin declares assertions; it never
mints an edge, addresses a card, or reaches a judge ⟨PLAN Be-smart 1, 3⟩ ⟨BR-018..023⟩.

**assertion** — one thing a source says: "this subject maps to the CEDS idea named by these tuple
fields", with the source's own labels and notes, RAW. The unit the walk yields.

**subject** — the unit at which cardinality is classified: for Ed-Fi the crosswalk triple
(entity, path, elementName) ⟨BR-136⟩; for SIF the forged `SifField` node ⟨IMPL §2.2⟩. A subject resolves
to ONE forged node's `stableId`, the `subject_id` ⟨BR-138⟩.

**decision block** — the frozen, content-addressed record of every classification the framework made
for one pairing under one plugin: the artifact ⟨PLAN Be-smart 5⟩ ⟨BR-071⟩. Lives in `lib/decision-store`.

**relationship block** — what `build.js` harvests by label from the dependency graph after
materialisation and enters into the manifest ⟨RISK §1.1⟩. It carries the labelled endpoint NODES
(with their embeddings) AND the mapping edges — `[code fact]` `replay-engine.js` `harvestBlock` collects
nodes for a label-scoped selector (`build.js:1782-1790` declares the embedding width/model for exactly
this reason) ⟨RULING BF3⟩ ⟨REVIEW A4⟩. Its id is therefore a function of the decision block's AND of the
hub-card content, the embedding model and `--vectorize`.

**pair-scoped label** — the `applyLabel` a plugin's block declares and the writer stamps:
`<spec.applyLabel>_<SOURCE>_<HUB>` (`BridgedRelation_EDFI_CEDS`), following the
`BridgedRelation_CTDL_CTDLASN` precedent `[code fact]` `test-build.js:836-838` ⟨RULING BF2⟩. Two plugins
never harvest each other's edges.

**rendered pool order** — the `stableId`-sorted candidate list as the renderer showed it to the judge;
recorded on the decision record and in forensics; the ONE authority for mapping the judge's ordinal
`choice` back to a card ⟨RULING BF1⟩.

**pairKey** — the decision-store key: `<hubToken>@<hubVersion>::<sourceToken>@<sourceVersion>::<bridgeName>::<producerKind>` ⟨RULING R3⟩.

**frameworkFingerprint** — sha256 over the sorted, path-labelled contents of the framework's own
source files, computed by the framework about itself at freeze time and written into every decision
block's generation ⟨RULING R4⟩ ⟨RISK §2.3⟩.

**tentative label** — a source label the plugin's table declares as asserting NO predicate on its own
(Ed-Fi `Maybe`); a subject whose labels are all tentative is `judged` regardless of cardinality
⟨Profile §5.1 v1.0.4⟩ ⟨RULING P3⟩.

---

## 2. Purpose and scope

The framework owns: resolution, cardinality classification, the judge call and its debug double, the
judgment cache and forensics use, freezing, content addressing, materialising, the write seam, the
SSSOM export, every refusal, and the census ⟨PLAN Be-smart 1⟩ ⟨ARCH §0⟩. A plugin owns: a declaration
object and two hooks ⟨RULING A3⟩. Ed-Fi is the FIRST INSTANCE of the plugin shape, not a special case;
SIF is the second and the proof ⟨PLAN Be-smart 3⟩ ⟨BR-024⟩.

In scope for v1: `matchBasis: standard` and `crosswalk`; `producerKind: authored`; the property tier;
two modes (materialise, re-judge); the debug judge; SSSOM/TSV export. Out of scope for v1, each REFUSED
BY NAME rather than left silent (§15): `matchBasis: derived` and everything only it needs ⟨RULING R6⟩;
the value tier ⟨BR-080 RULED⟩; structural bridges ⟨BR-017⟩; judgment dedupe ⟨BR-074⟩;
`cacheMode`/`pinBlockId` ⟨BR-073 RULED⟩; a human-review writer; `MappingAssertion` reification;
JSON/RDF/OWL SSSOM serialisations.

---

## 3. The object

### 3.1 The factory — two layers, one shape ⟨RULING A2⟩ ⟨FF §3.1⟩ ⟨PLAN Be-smart 2⟩

```
lib/bridge-framework/bridge-framework.js      require(<lib>/bridge-framework/bridge-framework)(deps) → bridgeFramework
apps/graph-builder/apps/bridge-maker/bridgeMaker.js   the SEAM FACE — bridgeMaker() → { run }, exactly as build.js calls it
```

- The framework MUST be ONE tree library in the house two-stage form
  `moduleFunction({ moduleName }) => (deps) => bridgeFramework`, exported applied, holding NO per-run
  state: every index, census counter and decision list lives inside one `run` invocation ⟨FF §3.1⟩
  ⟨BR-006, BR-072⟩ ⟨ARCH §1.1⟩.
- The seam face MUST keep a zero-argument factory for `build.js` (`[code fact]` `build.js:1087`
  `components.bridgeMaker()`), MUST refuse by name any construction argument (as `interfaces.js`
  promises today), MUST build the real registry (§9) and the real reader/writer factories inside, and
  MUST forward `run(spec, callback)` to `bridgeFramework.run` unchanged ⟨RULING A2⟩ ⟨ARCH §1.1⟩. Test
  injection goes through the FRAMEWORK factory only (fixture registry, reader/writer doubles); the seam
  face is proven by `test-interfaces` (call shape) and BG-MODES (§12) ⟨ARCH D1 recommendation, adopted;
  §16 D-S1⟩.
- The seam face MUST also host the ONE thing that spans two runs: the cross-block CONFLICT detector
  (§5.5) ⟨RULING A11⟩.

### 3.2 `deps` — what comes in, and from where ⟨ARCH §1.2⟩ ⟨FF §3.2⟩

Receive the stateful, instantiate the stateless (polyArch2). Nothing is reached for.

| dep | arrives via | rule |
|---|---|---|
| `graphReaderFactory({ inGraph, dependencyStandardNameList })` → reader | framework factory `deps`; the seam face passes the real one | the ONLY way any framework module (or, transitively, a plugin hook) reads the dependency graph; scoped at construction to the recipe's declared dependencies ⟨BR-002, BR-093⟩; the reader's ONE flatten applies the blinding declaration at entry ⟨BR-090, BR-091⟩ and RE-WIDENS list slots (§5.2) ⟨RULING P8⟩; absent → refused by name |
| `graphWriterFactory({ inGraph, applyLabel })` → writer | framework factory `deps`; `applyLabel` = the PAIR-SCOPED label the block declares (§5.9) ⟨RULING BF2⟩ | the ONLY door an edge goes through (§6); absent → refused |
| `pluginRegistry` | framework factory `deps`; the seam face passes the discovery-built one (§9) | frozen data `entryByBridgeName`; a suite passes a fixture registry |
| `xLog` | explicit dep wins; else `process.global.xLog`; else REFUSED by name | never a do-nothing logger ⟨FF §3.2⟩ |
| judge client | `run` args: `spec.inferenceConfig.llmClient` — the real Anthropic client OR the debug judge, `[code fact]` selected by `build.js` `resolveInferenceConfig` (`:807-865`); both answer `rerank` | absent + a judged decision needed + `rebridge: true` → refused by name at the FIRST judged subject, naming it (a specified-only run needs no judge); `rebridge: false` → never consulted |
| `decisionStore`, `judgmentCache`, `matchForensics` | `run` args `[code fact]` `build.js:1677-1679` | required KEYS on a re-judge; on materialise `decisionStore` required, the other two unread; a missing key refused by name — the framework opens NO store of its own ⟨BR-021 converse⟩ ⟨ARCH §1.2⟩ |
| `rebridge`, `config.limit/offset`, `config.sourceStandardName`, `config.sourceVersion`, `config.hubVersion` | `run` args | read as handed; nothing re-resolved from an ini or a forger ⟨HARVEST R-H7⟩ |
| tree libs | `require`d as pure modules | `qtools-asynchronous-pipe-plus`, `lib/vocabulary`, `lib/content-address`, `lib/forge-framework/refuse.js`, `lib/forge-framework/sourceVerification.js`, `lib/forge-framework/roundTripHarness/{twinRegistry,gateEvaluator}` (tests), `apps/bridge-maker/lib/{evidenceContracts,sourceWindow,debugJudge}` — the reuse list §14.3 |
| config | none | the framework reads NO ini; the Anthropic ini is llmClient's `[code fact]` `build.js:840-854`, and llmClient is handed in |

The framework MUST NOT `require` `neo4j-driver` outside the two bolt-facing files (§14.1), nor
`apps/graph-builder/lib/**`, nor `forges/**` (the registry LOADS plugin files by discovered path; the
framework's own tree never requires a standard by name), nor `lib/replay/**` ⟨ARCH §1.2⟩ ⟨BG-CONTAIN,
BG-NOSUB⟩.

### 3.3 The public surface ⟨ARCH §1.3⟩

Orchestration-side and I/O members are `callback(errString, result)`; pure declaration-side helpers
are synchronous and return values. There is no synchronous throwing kit: the whole bridge pipeline is
orchestration-side, so the forge framework's ONE adapter idiom is not needed and not offered.

| member | signature | what | refuses by name |
|---|---|---|---|
| `run(spec, callback)` | as `build.js` calls it | §5 the pipeline; returns the runReport (§5.9) | §5.0 |
| `registerPlugin({ pluginModule, pluginFilePath, bundleDirPath })` → registry entry | pure | validates declaration (table walk over `BRIDGE_DECLARATION_CONTRACT`) + hooks (`BRIDGE_HOOK_CONTRACT`) + the static file scan; refuses drift BEFORE any run ⟨BR-004⟩; the seam face calls it once per discovered file at construction | §4.3 |
| `contracts.BRIDGE_DECLARATION_CONTRACT`, `contracts.BRIDGE_HOOK_CONTRACT` | frozen data | §4.1, §4.2 | — |
| `contracts.MATCH_BASIS_LIST` (`standard`, `crosswalk`), `PRODUCER_KIND_LIST` (`authored`), `RESOLUTION_LIST`, `CLASSIFICATION_REGISTRY`, `PREDICATE_SOURCE_KIND_LIST` (`column`, `labelTable`, `channelAssertion`), `PREDICATE_ASSERTED_BY_LIST` (`source`, `labelTable`, `channelAssertion`), `LABEL_DISPOSITION_LIST` (`predicate`, `tentative`, `refused`, `sentinelOnly`), `TRANSFORM_REGISTRY` (`identity`, `globalIdToPrefixedKey`, `uriFragment`, `verbatim`), `RUN_CONFIG_KEY_LIST` (exactly the `config` keys `build.js` composes — `limit`, `offset`, `sourceStandard`, `sourceStandardName`, `sourceVersion`, `hubVersion`, `pairWith`, `pairWithVersion`, `familyStandards`, `[code fact]` `build.js:1685-1697`), `CONFIDENCE_BAND_TABLE` | frozen data | the closed vocabularies the record carries ⟨RULING A4, R6, P5, BF5, BF11, BF13, BF14⟩ | — |
| `contracts.RUN_REPORT_RESULT_KEYS` | frozen data | what `run` returns — INCLUDING `blocks` (§5.9); the value `interfaces.js` `COMPONENT_SHAPES.bridgeMaker.run.resultKeys` (`null` today, `[code fact]` `interfaces.js:400`) is set to in the B2 commit ⟨BR-140⟩ ⟨RULING A8, BF10⟩ | — |
| `census.cardinalityCensus({ decisionRecordList, refusalList })` → census | pure | §5.8; the acceptance instrument; mirrors `lib/forge-framework/census.js` | non-array |
| `census.contentionCensus({ cardList })` → `{ cardCount, distinctKeyCount, contendedKeyCount, worstContention, tier }` | pure | ⟨BR-034⟩ measured PER RUN, never carried as a constant | — |
| `decisionBlock.frozenTextFor({ header, decisionRecordList, refusalList, census })` → canonical text; `decisionBlock.blockIdFor({ frozenText })` → 64-hex | pure | §7 content addressing over `lib/content-address` `blockIdForText` (the same function `decision-store` verifies on read `[code fact]` `decision-store.js:82`) | — |
| `refuse.byName` | re-export of `lib/forge-framework/refuse.js` | every framework refusal — REUSED, not forked. `[code fact]` `refuse.js:18-21` RETURNS an `Error` ("PURE and synchronous"); the pipeline is error-STRING-first, so every framework module stringifies at its callback boundary (`String(err.message)`) and the seam face stringifies once more at the seam ⟨RULING BF12⟩ ⟨REVIEW F2⟩ | — |
| `judge.judgeOne({ question, judgeClient, judgmentCache, matchForensics, budget }, cb)` | callback | §5.6; exported so a fixture can drive it | §5.6 |
| `exporter.toSssomTsv({ decisionBlock, curieMap, setLevelSlots, outputPath }, cb)` | callback | §8 | undeclared prefix; banned justification; unverified `mapping_provider` |
| `frameworkFingerprint()` → 64-hex | pure | §7.2; NEW code — sha256 over sorted path + contents of the framework's own tree (`lib/forge-framework/fingerprint.js` hashes a GRAPH RESULT, `pureLayerFingerprint({ nodes, edges })`, and is NOT reused) ⟨RULING BF12⟩ ⟨REVIEW D4⟩ | — |

---

## 4. The plugin contract — declaration (data) + hooks (methods) ⟨PLAN Be-smart 3⟩ ⟨RULING A3⟩ ⟨FF §4, §5⟩

TQ's "method or methods" is answered as the forge framework answered it: a small HOOK SET, each hook with
one job and one declared shape, plus a declaration object larger than a descriptor. The one-method form
is a plugin whose walk yields complete per-assertion tuples and whose subject rule is identity — that IS
"the plugin's method". No `bridge(everything)` method exists ⟨ARCH §2.3⟩ ⟨FF §5.1⟩.

### 4.1 `BRIDGE_DECLARATION_CONTRACT` — the declaration object

One frozen object per plugin. Every key is DATA; anything that would need code is a hook (§4.2). Ed-Fi's
values are in §10, SIF's in §11.

| key | kind | required | rule / trace |
|---|---|---|---|
| `bridgeName` | lowerCamel string | yes | the registry key; MUST equal what a recipe's `bridges[].bridge` names ⟨BR-003⟩; the string `build.js` passes as `spec.bridge` |
| `standardKey` | lowercase string | yes | MUST equal the bundle directory the plugin sits under AND `spec.source` at run ⟨BR-009⟩ |
| `pluginVersion` | string | yes | stamped into the block header (§7.1): a re-judge under a changed declaration is a different generation |
| `producerKind` | closed: `authored` | yes | v1 admits ONLY `authored`; MUST agree with `matchBasis` (`standard`/`crosswalk` → `authored`) — declared AND checked, so the block suffix can never be inferred by `build.js` (§5.9) ⟨Profile §4.7⟩ ⟨RULING A1⟩. `inferred` and `structural` are refused by name in v1 ⟨RULING R6⟩ ⟨BR-017⟩ |
| `matchBasis` | closed: `standard` \| `crosswalk` | yes | ONE per plugin. `derived` is REFUSED BY NAME in v1 ⟨RULING R6⟩. A standard with two channels (its own column AND a third-party crosswalk) is TWO plugins on two recipe entries; their disagreement is CONFLICT (§5.5) ⟨Profile §3.1, §5.1⟩ ⟨C4⟩ |
| `mappingProvider` | `{ url, verifiedBy }` | yes | becomes `mapping_provider` ⟨Profile §4.3⟩ ⟨BR-041⟩. `url` MUST be a URL; the exporter REFUSES by name a provider the B3/B4 builder has not recorded as verified-to-resolve (`verifiedBy: { sessionName, date, note }`) — never a placeholder ⟨RULING P7⟩ |
| `sourceCuriePrefix` | `{ prefix, iri }` | yes | for `crosswalk`: the DOCUMENT's prefix (`edfiCedsCrosswalk`); for `standard`: the standard's own — becomes the `subject_match_field` prefix and a `curie_map` entry ⟨Profile §4.5, §4.6⟩ ⟨BR-052, BR-054⟩ |
| `subjectCuriePrefix` | string | yes | the `subject_id` CURIE prefix (`edfi`, `sif`) — the forged stableId's own prefix ⟨Profile §4.1⟩ |
| `sourceChannelList` | list of channel objects (below); non-empty | yes | every place the walk reads. `{ channelKey, sourceKind: 'document' \| 'forgedGraph', relativePathFromBundleRoot?, checksumListRelativePathFromBundleRoot?, encoding?, headerOverrideByIndex?, channelPropertyList?, tier: 'property' \| 'value', disposition: 'walk' \| 'refuseByNameAndCount', absentTargetSentinelList, columnClassification }`. **Column classification is PER CHANNEL** ⟨RULING BF6⟩ ⟨REVIEW C1–C3⟩: `columnClassification = { subjectIdentityColumnList, tupleFieldColumnList, sourceLabelColumnList, carriedRecordColumnList, evidenceOnlyColumnList, consistencyCheckColumnList, ignoredColumnList }` and COVERAGE = every column of the channel's header (a `document` channel's header row after `headerOverrideByIndex`; a `forgedGraph` channel's `channelPropertyList`) appears in EXACTLY ONE of those seven lists — an unclassified column, or a listed column absent from the header, is refused by name at load. `headerOverrideByIndex` (`{ 8: 'EdFiElementDescription' }`, the `crosswalkCarrier.js:48` precedent) renames a DUPLICATED header name positionally BEFORE coverage; a duplicate that survives is refused. A `refuseByNameAndCount` channel is EXEMPT from coverage but MUST still list its header (`headerColumnList`) so the count is honest. The top-level `tupleFieldColumnMap`, `predicateSource.column`, `evidenceColumnMap` and `consistencyCheckColumnList` are REFERENCES into a walk channel's classification lists, not classifications: each referenced column MUST be classified in every `walk` channel (`tupleFieldColumnMap.*.column` ∈ `tupleFieldColumnList`; `predicateSource.column` ∈ `sourceLabelColumnList`; `evidenceColumnMap.*` ⊆ `evidenceOnlyColumnList` ∪ `carriedRecordColumnList` ∪ `sourceLabelColumnList`; `consistencyCheckColumnList[].column` ∈ `consistencyCheckColumnList`), else refused. A `document` channel MUST name a file under the plugin's bundle and a `SHA256SUMS`; the framework RESOLVES it against `bundleDirPath`, VERIFIES it through `lib/forge-framework/sourceVerification.verifySnapshotChecksums` (REUSED), and hands the walk `sourceChannelPathByKey` — never a path the plugin composes, never located by search ⟨RULING A5⟩ ⟨FF §4.1⟩. A `forgedGraph` channel is read THROUGH `sourceReader.forWalk()` (§4.2) and MUST declare `channelPropertyList` — the node properties the walk may read UNBLINDED and nothing else ⟨RULING BF7⟩. `tier: 'value'` MUST carry `disposition: 'refuseByNameAndCount'` in v1 ⟨BR-080, BR-134⟩ ⟨RULING P1⟩. `absentTargetSentinelList` is per channel (`['000000']` Elements; `['']` descriptors, SIF) — a raw target on the list is "no assertion", counted, never an orphan ⟨IMPL §1.1⟩. A declared `encoding` the bytes fail to decode → refused ⟨IMPL §1.7⟩ |
| `subjectIdentity` | `{ kind: 'columnTuple', columnList }` (a REFERENCE: `columnList` ⊆ the walk channel's `subjectIdentityColumnList`) \| `{ kind: 'forgedNode', property: 'stableId' }` | yes | the SUBJECT KEY the framework groups assertions by ⟨BR-136⟩. The framework REFUSES a walk that yields two assertions with equal subject key and unequal identity values (a path-blind key) — enforced by the framework so no plugin can forget it ⟨ARCH §2.1⟩ |
| `tupleFieldColumnMap` | object `tupleField → { column, transform }` | yes | THE COLUMN MAP ⟨PLAN Be-smart 3⟩ ⟨Profile §5.1 v1.0.3⟩ ⟨BR-011, BR-060⟩. `canonicalKey` REQUIRED; `domainId`, `propertyKey`, `range`, `valueKey`, `qualifierKeys` optional (`range` declarable per Profile v1.0.5 ⟨RULING BF16⟩ — unused by both v1 plugins); nothing else accepted; a field not listed is NEVER inferred. `transform` is a key into `TRANSFORM_REGISTRY` (`identity`, `globalIdToPrefixedKey` — `'P' + six digits`; renamed from `cedsPropertyKeyFromGlobalId` so the framework tree passes its own token ban ⟨RULING BF14⟩ ⟨REVIEW C11⟩ — `uriFragment`, `verbatim`) — the plugin names a transform, never supplies a function ⟨IMPL §3.1⟩. `column` is a REFERENCE into the walk channel's `tupleFieldColumnList` (a `forgedGraph` channel's `column` is a property NAME, e.g. `cedsId`). Exported as `subject_match_field` per used field ⟨Profile §4.5⟩ |
| `predicateSource` | one of the closed registry: `{ kind: 'column', column, table }` \| `{ kind: 'labelTable', column, table }` \| `{ kind: 'channelAssertion', predicate, assertedBy: { documentName, citation } }` | yes | ⟨RULING P5⟩ ⟨Profile §5.3⟩ ⟨BR-012, BR-019, BR-046⟩. `none` is NOT a kind: a plugin that cannot fill one is refused at registration — "declare what the source asserts or do not register the channel". `judge` is REMOVED for v1 with `derived` ⟨RULING R6⟩. `channelAssertion` = the plugin declares, as data WITH A CITATION of the source's own documented column semantics, the ONE predicate the whole channel asserts (SIF: `exactMatch`, §11) — a source-attributed claim, not a producer constant ⟨BR-044⟩ ⟨RULING R9, P5⟩ |
| `table` (inside `column`/`labelTable`) | object `sourceLabel → { disposition: 'predicate', predicate } \| { disposition: 'tentative', predicateIfPicked } \| { disposition: 'refused', reason } \| { disposition: 'sentinelOnly' }` | with those kinds | DATA-DECLARED, exported with the set's provenance ⟨BR-046, BR-047⟩. Every `predicate`/`predicateIfPicked` MUST be one of `vocabulary.SKOS_PREDICATES` (`[code fact]` `vocabulary.js` `isValidSkosPredicate`); an OWL predicate anywhere → refused ⟨Profile §4.4⟩ ⟨BR-051⟩. `tentative` = asserts no predicate on its own; forces `judged` (§5.4) ⟨Profile §5.1 v1.0.4⟩ ⟨RULING P3⟩. `refused` = "we decided not to map X" as data ⟨IMPL §1.4⟩ — such rows are refused by name and COUNTED (`labelRefusedCount`) without refusing the run. `sentinelOnly` = a label that is lawful ONLY on a row whose target is the channel's absent-target sentinel (Ed-Fi `Not in CEDS`, 473 rows `[measured]` ⟨REVIEW B5⟩); on a REAL-target row it refuses the RUN by name ⟨RULING BF5⟩ |
| `evidenceColumnMap` | `{ subject: [columns], assertion: [columns] }` (either may be `[]`) | yes | a REFERENCE (BF6): which classified columns are shown to the judge as source-side / assertion-side material ⟨BR-092⟩; a `carriedRecord`-classified column MAY also be referenced as evidence (Ed-Fi `CEDSMappingNotes`); subject to blinding where a column restates an anchor. The classification lists themselves (`sourceLabelColumnList` — carried on the record as SOURCE labels, raw, never as `confidence` ⟨BR-013, BR-047⟩; `carriedRecordColumnList` — carried BY NAME ⟨RULING P1⟩; `evidenceOnlyColumnList`; `ignoredColumnList` — named so silence is not mistaken for coverage) live PER CHANNEL in `columnClassification` |
| `consistencyCheckColumnList` | list of `{ column, transform, against: 'canonicalKey' \| 'card.<property>', disposition: 'refuse' \| 'report' }` (may be `[]`) | yes | a REFERENCE (each `column` ∈ the walk channel's `consistencyCheckColumnList`); a column that must AGREE with a tuple field or a card property; `refuse` → a disagreeing row is refused by name; `report` → counted and listed ⟨RULING P1⟩. MUST NOT be read as a tuple field ⟨BR-131⟩ |
| `segmentNormalisationRuleList` | list of `{ appliesTo: 'entity' \| 'segment' \| 'lastSegment', match, action: 'stripSuffix' \| 'stripPrefix' \| 'invertDescriptor' }` (may be `[]`) | yes | DATA consumed by the plugin's `subjectStableIdFor` hook (Ed-Fi: strip ` (TPDM)`, ` - DEPRECATED`, ` (from TPDM)`; the `Descriptor` inversion on the last segment) ⟨RULING BF17⟩ ⟨REVIEW C10⟩; the framework validates the shape and never applies it |
| `remodelTableRef` | string naming a HUB-owned table (`ceds14PropertyRemodel`) or `null` | yes | the property-side remodel table is HUB-OWNED DATA keyed `hubName@hubVersion`, REFERENCED by plugins, never copied ⟨RULING P11⟩ ⟨BR-015 read as provide-by-reference, BR-035, BR-132⟩. Applied BEFORE direct resolution; an entry resolves to a specific TUPLE, never a bare base property; a table target absent → orphan with that reason ⟨HARVEST R-H2⟩ |
| `classSideRemodelTable` | list of `{ canonicalKey, sourceDomainId, sourceSubjectQualifier?, targetDomainId }` (may be `[]`) | yes | ⟨BR-036 SHOULD⟩; each entry MUST resolve to exactly one card or is refused; `[]` in v1 for both plugins — the P000590/P000591 case is not writable as (property, oldDomain)→newDomain and falls to MANY → judged ⟨RULING P11⟩ ⟨IMPL §1.6⟩ |
| `blindingDeclaration` | list of property names on the SOURCE nodes (`[]` valid, ABSENT refused) | yes | EVERY specification-declared mapping property of the source's nodes ⟨BR-090⟩ — for the two v1 forges the property-node triple `cedsId`, `crossRefs`, `cedsOriginalAnchorPropertyName` AND the option-value pair `cedsOptionCode`, `cedsOptionOriginalAnchorPropertyName` (`[code fact]` `forgeEdfiContractGraph.js:907-908`; `forgeSif.js:81`) ⟨RULING BF17⟩ ⟨REVIEW C9⟩. Enforced at the CONSUMER boundary of the ONE reader (§4.2): `sourceReader.forEvidence()`, the judge path and forensics see the blinded view; `sourceReader.forWalk()` is the SOLE exemption and only for a channel's declared `channelPropertyList` ⟨RULING BF7⟩; echoed BY NAME in the run report ⟨BR-014⟩ ⟨HARVEST R-H5⟩. Home: the plugin, validated at construction before any forge is spent; a recipe param MAY NOT override it ⟨RULING A6⟩ |
| `evidenceHooksDeclared` | `{ nominate: boolean, walkEvidence: boolean, globalGuidance: boolean }` | yes | the framework holds the hook set to this: a declared-true hook missing, or an undeclared hook present, is refused at registration ⟨BR-016⟩ ⟨RULING A3⟩ |
| `globalGuidanceList` | `string[]` (may be `[]`) | yes | the VALUE of the `globalGuidance` hook — declaration-side data, each string candidate-blind (the A2/A3 smuggling gate refuses a string naming a pool candidate); REFUSED at registration if `evidenceHooksDeclared.globalGuidance` is `false` and the list is non-empty ⟨RULING BF18⟩ ⟨BR-067⟩ |
| `compatibilityDeclarationList` | list; `[]` | yes | mirrors ⟨FF §7⟩. v1 ships an EMPTY closed `BRIDGE_ALLOWANCE_REGISTRY` — nothing pre-existing must be reproduced, so no row exists; a non-empty list is refused. The KEY exists so the mechanism is the forge framework's, not a later bolt-on ⟨ARCH D5, adopted; §16 D-S2⟩ |

**Not in the declaration, and why** ⟨FF §4.2⟩ ⟨ARCH §2.1⟩: no `confidence`, `mappingJustification`,
`resolution` (derived by the framework from the outcome ⟨BR-022⟩); no floor or threshold (the judge's are
framework data ⟨BR-066⟩); no cache path, store path, model name or budget (handed in ⟨BR-021⟩); no
`mapping_date` (data-only, and neither source carries one ⟨BR-053⟩ ⟨Profile §4.6⟩); no edge type (the SKOS
predicate selects it through `vocabulary.SKOS_EDGE_TYPES`).

### 4.2 `BRIDGE_HOOK_CONTRACT` — the hook set ⟨RULING A3⟩

| hook | required | called from | signature | contract |
|---|---|---|---|---|
| `walkSourceAssertions` | yes | orchestration, ONCE per run | `({ sourceChannelPathByKey, sourceReader, xLog }, callback(errString, { assertionList, channelReport }))` | THE SOURCE WALK ⟨BR-010⟩. Enumerates EVERY assertion the source makes, RAW: `{ channelKey, subjectIdentity: { <field>: value … }, rawTargetList: [{ sourceColumnName, rawValue }] (EVERY id the row names, in row order — never the first ⟨BR-133⟩), tupleFieldValues: { canonicalKey, domainId?, … } (as READ from the declared columns), sourcePredicate: <SKOS> \| null (only for `predicateSource.kind: 'column'`), sourceLabelByColumn, sourceNoteByColumn, carriedRecord, evidence: { subject: {…}, assertion: {…} }, sourceLocator: { channelKey, rowNumber } \| { stableId } }`. `channelReport` per channel: `{ rowsRead, assertionsYielded, sentinelDropped, malformedRows, valueTierRows }` — reconciliation at zero is a framework gate ⟨BG-INPUT e⟩. For a `document` channel it reads the VERIFIED bytes; for a `forgedGraph` channel it reads the standard's own forged nodes THROUGH `sourceReader` (SIF: `cedsId` + `crossRefs.raw` on `SifField`, `[measured]` 2,231 nodes over 354 keys ⟨RULING A12, R10⟩) — the plugin opens nothing. It MUST NOT resolve, filter, dedupe, or address anything; values pass through untouched (no trim, no `String()`); an assertion carrying `resolution`, `confidence`, `matchBasis`, `mappingJustification`, `objectStableId`, or any card `stableId` is refused by name ⟨BR-022⟩ ⟨BG-HOOK⟩ |
| `subjectStableIdFor` | yes | orchestration, ONCE per run, after grouping | `({ subjectIdentityList, sourceReader, xLog }, callback(errString, { resolutionBySubjectKey }))` where each value is `{ subjectStableId } \| { unresolvable: <reasonKey>, detail }` | ⟨BR-138⟩ HOW a source subject names a forged node. Called ONCE with the DISTINCT subject list so a plugin may build its own indexes once (Ed-Fi's walk over constructs and `REFERENCES` edges, §10.3); SIF's is identity ⟨IMPL §1.5, §2.2⟩ ⟨RULING P2⟩. The FRAMEWORK then verifies every `subjectStableId` exists among the declared subject nodes (else `sourceGap` ⟨HARVEST R-H4⟩), COUNTS many-to-one per subject, and REFUSES BY NAME as `subjectCollision` a `subjectStableId` whose merged subjects carry DIFFERENT target sets — the plugin cannot see across subjects, so this cannot be the plugin's gate ⟨RULING P2⟩ ⟨ARCH §2.2⟩ |
| `nominateCandidates` | only if `evidenceHooksDeclared.nominate` | judged path | `({ sourceElement, candidatePool }, callback(err, [{ candidateStableId, rationale }]))` | ⟨BR-016⟩ ⟨HARVEST R-H17⟩; a nomination without rationale refused; a nominated stableId not in the (already filtered) pool refused — the hook adds EVIDENCE, never a candidate |
| `walkEvidence` | only if declared | judged path | `({ sourceElement, candidatePool, sourceReader }, callback(err, { perCandidateNoteByStableId, promptSegmentList }))` | reach bounded to declared dependencies by the reader itself ⟨BR-093⟩; a segment naming a pool candidate refused (A2 smuggling gate — REUSE `evidenceContracts.js`) |
| `globalGuidance` | only if declared | judged path | not a function: the declaration key `globalGuidanceList: string[]` (§4.1) rendered into every judged question | candidate-blind ⟨BR-067⟩ ⟨RULING BF18⟩ |

**`sourceReader` — the ONE reader, PURPOSE-scoped** ⟨RULING BF7⟩ ⟨REVIEW C4⟩ ⟨ARCH §4⟩ ⟨RISK §4⟩:
scoped to the SOURCE standard's forged nodes ONLY (the hub is NOT in the plugin's reader scope even
though it is in `inGraph` — the framework reads cards); no card index, no `readHubCards`, no lookup by
`canonicalKey` of any kind ⟨BR-018⟩. It hands out TWO views, both with the same closed member set
`readSourceNodes({ roleList })`, `readNodesByStableId({ stableIdList })`, `readEdgesAmongSource({ edgeTypeList })`:
- `sourceReader.forWalk()` — handed ONLY to `walkSourceAssertions` and `subjectStableIdFor`; exposes the
  channel's declared `channelPropertyList` UNBLINDED (SIF's walk reads `cedsId` and the JSON-string
  `crossRefs` through it) and NOTHING ELSE that is on the blinding list — a read of an undeclared blinded
  property is REFUSED by name (a Proxy on the record). This is the SOLE blinding exemption.
- `sourceReader.forEvidence()` — handed to `nominateCandidates` / `walkEvidence`, and the view the
  renderer, the judge path and forensics are built from; every record BLINDED.
Blinding is thereby enforced at the CONSUMER boundary of one reader (one flatten, two views), never by a
second reader ⟨BR-091⟩. Member sets are CLOSED shapes asserted by a Proxy in BG-CONTAIN; BG-BLIND (f)
proves an evidence hook cannot read `cedsId`.

**Struck, deliberately** ⟨ARCH §2.2⟩: no `resolve`, `classify`, `judge`, `freeze`, `write`, `export`,
`run` or `bridge(everything)` hook of any name. A plugin file that DEFINES a function named
`resolveTarget`, `writeEdge`, `openDriver`, `rerank`, or that `require`s `neo4j-driver`, `sqlite`,
`lib/decision-store`, `lib/judgment-cache`, `lib/match-forensics`, `apps/bridge-maker/lib/llmClient`,
`debugJudge`, `@anthropic-ai/*`, `lib/embedding/**`, `lib/vector-store/**`, `lib/replay/**` is refused
by name at registration ⟨BR-111⟩ ⟨HARVEST R-H12⟩ (the FORBIDDEN_SUBSTRATE scan the stub header says
"comes back with the writer" — it comes back here).

### 4.3 Validation refusals — at registration, before any I/O ⟨FF §5.2⟩ ⟨BR-004⟩

A TABLE WALK over `BRIDGE_DECLARATION_CONTRACT` (one kind-checker registry, closed values as data —
the `forgeDeclarationContract.js` idiom, MIRRORED — the lift into a shared `contractTableWalk.js` is
STRUCK: `[code fact]` the forge walk closes over a module-level `KIND_CHECKER_REGISTRY` and passes a
forge-shaped context to every checker, so a byte-neutral lift is not achievable ⟨RULING BF12⟩ ⟨REVIEW F3⟩)
and over `BRIDGE_HOOK_CONTRACT`.
Refused by name, one twin each (BG-DECL, BG-HOOK): missing required key; UNKNOWN key; wrong kind; a
closed value outside its list (`matchBasis: 'derived'`, `producerKind: 'inferred'`); `producerKind`
disagreeing with `matchBasis`; `predicateSource.kind` outside the three; `table` present without a
`column`/`labelTable` kind or absent with one; a table entry whose predicate is not SKOS; an OWL
predicate anywhere; `tupleFieldColumnMap` lacking `canonicalKey` or naming a field outside the tuple or
a transform outside the registry; a `document` channel whose file or checksum list is absent on disk
(resolved at registration, verified at run — a build with an unrelated broken plugin refuses at
construction, "declared-but-broken is a refusal on every build" ⟨FF §5.4⟩); a `value` channel not
`refuseByNameAndCount`; a header column unclassified in its channel, a classified column absent from
the header, a duplicated header name not resolved by `headerOverrideByIndex`, or a top-level reference
(`tupleFieldColumnMap`, `predicateSource.column`, `evidenceColumnMap`, `consistencyCheckColumnList`,
`subjectIdentity.columnList`) naming a column a walk channel did not classify ⟨RULING BF6⟩; a
`forgedGraph` channel without `channelPropertyList`, or whose list names a property outside the source
nodes ⟨RULING BF7⟩; a hook missing /
unknown / wrong arity; a hook declared false but present; a forbidden require or function name; a
non-empty `compatibilityDeclarationList`; `mappingProvider.url` not a URL.

---

## 5. The framework pipeline — `run(spec, callback)` ⟨ARCH §3⟩

Sequenced with `taskListPlus` + `pipeRunner`; `callback(errString, runReport)`; the ONLY promise
consumption is `.then().catch()`-to-callback at the leaf inside the two bolt-facing files (§14.1). A
cheap refusal precedes a costly step ⟨FF §13⟩.

### 5.0 Refusals before anything runs

`inGraph` / `bridge` / `applyLabel` absent (the stub's own three, kept verbatim `[code fact]`
`bridgeMaker.js`); `spec.bridge` unregistered (refusal LISTS the registered names); registered plugin's
`standardKey` ≠ `spec.source`; `config.sourceStandardName`, `config.sourceVersion`, `config.hubVersion`
absent or blank (a block that cannot name both versions has no address ⟨BR-056⟩ ⟨Profile §4.7⟩ —
refused HERE, before the spend, not later by `relationshipSubject`); `spec.hub` absent (a mapping plugin
without a hub is a category error ⟨BR-017 mirror⟩); `decisionStore` absent; `limit`/`offset` malformed
(REUSE `sourceWindow.parsePositiveInteger`); **any `spec.config` key outside `RUN_CONFIG_KEY_LIST` →
refused by name** ⟨RULING BF11⟩ ⟨REVIEW A8⟩ — `[code fact]` `build.js:1687` spreads `...(bridge.params
|| {})` into `config` FIRST and `recipe.js:150` leaves `params` unchecked, so this is the ONE unbounded
channel from a recipe into the framework and it is CLOSED here; in v1 a recipe's `bridges[].params`
therefore carries NOTHING the framework reads, which is the mechanism by which "a recipe param MAY NOT
override the blinding declaration" ⟨RULING A6⟩ holds. `cacheMode`/`pinBlockId` are NOT refused here —
`build.js` never passes them (zero occurrences); their removal from the recipe schema in B2 ⟨BR-073
RULED⟩ is the whole answer ⟨RULING BF11⟩.

### 5.1 Two modes, one code path after freeze ⟨PLAN Be-smart 5⟩ ⟨BR-070⟩ ⟨HARVEST R-H16⟩

- **MATERIALISE** (`rebridge: false`, a plain `-build`): `decisionStore.getDecisionBlock({ pairKey })` →
  absent → runReport `{ edgesWritten: 0, decisionBlock: null, producer: 'authored', note: 'no frozen
  decision block for <pairKey>; zero edges; nothing judged' }` SAID ALOUD on `xLog`, no graph read, no
  spend ⟨BR-110⟩; present → parse, verify (the store re-hashes on read `[code fact]`
  `decision-store.js:82-90`), RE-VERIFY the block's `sourceChannelDigestByKey`, `hubVersion`,
  `sourceVersion`, `declarationDigest` against the run's — a drifted document, a re-versioned endpoint,
  or a changed declaration is refused by name ("re-judge required"), never replayed onto the wrong graph
  ⟨ARCH §5⟩ ⟨RISK D7–D10⟩ — then §5.7 materialise VERBATIM. ZERO judge calls, ZERO embedder calls
  (spies in the suite, BG-REPLAY a).
- **RE-JUDGE** (`rebridge: true`, `--rebridge=<token>` scoped by `build.js` `[code fact]` `:1660`):
  §5.2–§5.6 → FREEZE (§7) → `saveDecisionBlock` (idempotent; a recording failure is FATAL, never a
  warning ⟨BR-069⟩) → then §5.7 materialise FROM THE BLOCK JUST FROZEN → §8 export → §5.8 report. A
  re-judge and its later replays are byte-identical by construction.

### 5.2 Read: cards, subjects, the walk, the window ⟨ARCH §3.2⟩

1. `graphReaderFactory({ inGraph, dependencyStandardNameList: [config.sourceStandardName, <hub>] })` →
   `reader`. The reader's ONE flatten produces the two purpose-scoped views of §4.2 (`forWalk()`
   unblinded for declared channel properties; `forEvidence()` and the framework's own judge path
   blinded ⟨BR-090⟩ ⟨RULING BF7⟩) and RE-WIDENS every LIST slot read from a card (`qualifierKeys`, `qualifierNames`) at the read boundary — `[code
   fact]` `lib/replay/replay-engine.js:68-77` stores a one-element PG-JSON array as a SCALAR, so the 27
   qualified property cards in the golden carry `qualifierKeys` as a STRING `[measured]`; the tuple
   filter compares lists ⟨RULING P8⟩ ⟨BR-033⟩ (twin BG-QUALIFIER-WIDEN). The blinding declaration is
   echoed by name into the report before the first read.
2. **Cards**: `reader.readHubCards({ referenceTier: 'property' })` → tuple fields, `stableId`/`uri`,
   `name`, `propertyDefinition`, `domainName`, `domainDefinition`, `propertyNotation`, `rangeDatatype`,
   `embedding` present-or-refused ⟨BR-123⟩. `[measured]` `GOLD_EVAL_260816`: 2,777 property cards /
   2,324 distinct keys / 260 contended / worst 13 ⟨RULING A12⟩ — the run REPORTS its own numbers
   (`census.contentionCensus`) and never carries these forward ⟨BR-034⟩ ⟨Profile §6⟩. Value-tier cards
   are NOT read in v1 ⟨BR-080⟩.
3. **Candidate index**: a MULTIMAP `cardListByCanonicalKey` (never a bare assignment ⟨BR-032 RULED⟩
   ⟨Profile §2.2⟩ ⟨gate 1⟩) built inside this run; `indexCollisionCount` equals `contendedKeyCount` by
   construction (asserted, BG-P1).
4. **Subjects**: `reader.readSourceNodes(...)` scoped to `config.sourceStandardName` EXACT ⟨BR-023⟩ →
   the forged source nodes, flattened+blinded, indexed by `stableId` (`[code fact]`
   `UNIQUENESS_KEYS.STABLE_ID`).
5. **Walk**: `verifySnapshotChecksums` on every `document` channel, then
   `hooks.walkSourceAssertions({ sourceChannelPathByKey, sourceReader: reader.forWalk(), xLog })`.
   Empty `assertionList` → REFUSED by name ⟨BR-094⟩ ⟨HARVEST R-H6⟩; `channelReport` reconciliation
   `rowsRead === assertionsYielded + sentinelDropped + malformedRows + valueTierRows` → else refused
   (BG-INPUT e). Value-tier channels are walked ONLY to be counted (`refusedValueTierAssertionCount`,
   raw form retained) ⟨BR-080, BR-134⟩ ⟨ARCH D11, adopted⟩.
6. **Source census before resolution** ⟨RULING P4, BF5⟩ ⟨REVIEW B5⟩: SCOPED to rows whose target is
   NOT the channel's absent-target sentinel. On those rows every label in `predicateSource.column` is
   checked against `table`; a label with no row (blank included), or a `sentinelOnly` label on a
   real-target row → the RUN is refused by name — "label `X` in column `Y` (N rows) has no entry in the
   table; add the row or refuse the label explicitly" — with the count and three sample subjects
   ⟨BR-046⟩. Likewise a `column`-kind row whose cell maps to no SKOS predicate. Sentinel rows carrying
   any label OTHER than a `sentinelOnly` one are COUNTED in the report (`sentinelLabelledRowCount`; Ed-Fi
   today 14: 10 `Derived`, 4 `Maybe` `[measured]` ⟨REVIEW B5⟩) and never judged. A table that has quietly
   stopped covering its source MUST NOT stay green.
7. **Window**: `sourceWindow.applySourceWindow` (REUSED) over the SUBJECT list sorted by subject key;
   zero-match window refused; the window mark joins the generation ⟨BR-075⟩.

### 5.3 Group by subject; resolve `subject_id`; apply the remodel table ⟨ARCH §3.3⟩ ⟨IMPL §1.5⟩

For each assertion: sentinel targets dropped and counted; assertions grouped by subject key
(`subjectIdentity` values joined) — the CARDINALITY UNIT ⟨BR-136⟩; `subjectStableIdFor` called ONCE
with the distinct list; each result verified against the subject index (unresolvable or absent →
`sourceGap`, recorded with reason, no edge); many-to-one `subjectStableId` counted per subject and
reported (one decision record per (leaf, target) with `assertingSubjectList` on the record ⟨RULING P2⟩);
a merged `subjectStableId` whose subjects carry DIFFERENT target sets → REFUSED by name as
`subjectCollision`, all targets named with their asserting subjects, routed to human review, counted
⟨BR-138⟩ ⟨RULING P2⟩ (Ed-Fi: 7 leaves / 31 subjects `[measured]`, §10.3). `remodelTable.propertySide`
rewrites a raw target to a specific TUPLE, then `classSideRemodelTable` rewrites a supplied `domainId`
for that key — both recorded on the record as `remodelApplied: { side, from, to }` ⟨BR-035, BR-036⟩; a
row's own supplied domain that the property-side entry supersedes is recorded `sourceDomainSuperseded`
⟨IMPL §1.6⟩.

### 5.4 Filter, count, classify — the Profile §5.1 table as ONE closed registry with an EXPLICIT DISPATCH ORDER ⟨RULING A4, BF4, BF15⟩

For each subject, for each DISTINCT target it names ⟨BR-064 REVISED⟩:

```
pool = cardListByCanonicalKey[canonicalKey]                       // multimap; [] when absent
pool = pool.filter(every supplied tupleField equals the card's)   // domainId, propertyKey, range, qualifierKeys (as sorted lists), …
pool = sortByStableId(pool)                                       // ⟨RULING R2⟩ — BEFORE any render or pick; this ORDER is the rendered pool order (§5.6)
```

`CLASSIFICATION_REGISTRY` is closed data; every value has a census row and a report line; and the
registry is walked **FIRST-MATCH in the order below** ⟨RULING BF15⟩ ⟨REVIEW G2⟩ — an ordered list, not
a set, so no two rows can both apply. Rows 1–3 are decided per SUBJECT before any target is looked at;
rows 4–9 per (subject, target).

| # | condition (first match wins) | classification | record | edge |
|---|---|---|---|---|
| 1 | the walk subject is unresolvable, or its `subjectStableId` is not a declared subject node | `sourceGap` — the whole subject | counted with reason | no ⟨HARVEST R-H4⟩ |
| 2 | the resolved `subjectStableId` is shared by subjects carrying DIFFERENT target sets | `subjectCollision` — the whole merged subject | counted, all targets named with asserting subjects | no ⟨BR-138⟩ ⟨RULING P2⟩ |
| 3 | the target is value tier (a `value` channel row, a `valueKey`-bearing assertion) | `valueTierRefused`, raw form retained | counted | no ⟨BR-080⟩ |
| 4 | EVERY label the subject's rows carry for this target is `tentative`-disposition (any cardinality ≥ 1 after the filter) | `judged` — confirm-or-abstain over the filtered pool, possibly ONE card | as judged; predicate = the tentative row's `predicateIfPicked` (§16 D-S3), `predicateAssertedBy: labelTable`, `sourceLabel` raw | as judged ⟨Profile §5.1 v1.0.4⟩ ⟨RULING P3⟩ |
| 5 | the pool is EMPTY and the key pool is EMPTY | `orphan` — reason `noCardUnderKey` \| `remodelTargetAbsent` | recorded | no ⟨Profile §5.1⟩ |
| 6 | the pool is EMPTY under a NON-empty key pool | `sourceSideMismatch` → JUDGED over the key's pool ⟨BR-062 RULED⟩, `{ tupleField, suppliedValue, survivingCandidateCount }` recorded; COUNTED under `judged` in the per-target table AND separately as `sourceSideMismatchCount` (a sub-count of judged, reconciled by BG-CENSUS f) | as judged | as judged |
| 7 | the pool has MORE than one card | `judged` → §5.6 | `resolution: 'judged'`, `'semapv:CompositeMatching'`, `confidence` from the judge's category band (data), predicate from the SOURCE (never the judge) | yes if the judge picks; `abstained` record and none otherwise |
| 8 | the pool has EXACTLY one card and every label for this target is `predicate`-disposition | `specified` | `resolution: 'specified'`, `mappingJustification: 'semapv:ManualMappingCuration'`, predicate from `predicateSource` (§5.6.0), NO `confidence` | yes |
| 9 | (unreachable — every combination is caught above; the registry REFUSES by name if reached) | — | — | — |

Multi-target subjects fall out of the per-target walk ⟨BR-064 REVISED⟩: a subject naming several
targets whose labels are ALL `predicate`-disposition yields N × row 8 (N `specified`) ⟨BR-064 b⟩; a
subject whose labels MIX `predicate` and `tentative` is judged over the UNION of the named targets'
filtered pools — implemented as ONE (subject, union-target) row 7 record whose predicate is the table row
of the ROW that named the picked card ⟨BR-064 c⟩ (row 4 catches the all-`tentative` case first, so the
former overlap ⟨REVIEW G2⟩ is gone).

**Cross-plugin CONFLICT is NOT a row here** — it cannot be: it is detected in the seam face across two
runs (§5.5) and lives in the REPORT, never in a frozen block ⟨RULING BF8⟩.

Zero and many are never collapsed ⟨BR-060⟩. Nothing selects silently: `judged` is the ONLY path to a
pick among several, and it goes through the judge ⟨PLAN Be-smart 4⟩. `labelUnmapped` and
`predicateAbsent` are RUN refusals (§5.2 step 6), not census buckets ⟨RULING P4⟩.

### 5.5 Where CONFLICT lives ⟨RULING A11⟩ ⟨ARCH §3.4⟩

Within ONE plugin there is ONE source and there is no conflict — a lossy scalar echo is `judged` ⟨C4⟩.
Two SOURCES = two plugins on the same pairing (`recipe.js` allows two names on one pairing `[code fact]`
⟨SEAM §1⟩) — but each `run` sees one plugin. Conflict detection is therefore a run-level CROSS-BLOCK
check in the SEAM FACE ⟨RULING BF8⟩ ⟨REVIEW B7⟩: when the SECOND plugin's `run` on a pairing reaches
materialise, the seam face compares its just-frozen block against the FIRST plugin's block already
materialised in the same build; for each `subjectStableId` present in both with different
`objectStableId`, the SECOND plugin's materialisation is REFUSED by name for that subject — its
decision block is RECORDED (frozen and saved), its conflicting edges are NOT written, a `conflict`
record naming both targets is written to the REPORT and to a `MappingReview` queue in the decision
store, and the FIRST plugin's edges STAND (nothing already written is retracted; "withheld" is struck).
`conflictCount` is a REPORT member, never a member of any frozen census (§5.8, §7.1) — a conflict is
known only after both blocks exist. v1 ships the detector with a FIXTURE twin (two toy plugins); no
second live plugin per pairing exists, and the report line says "0 conflicts (one plugin on this
pairing — detector exercised by fixture only)" — never faked ⟨RULING A11⟩.

### 5.6 The judge component — framework-owned, debug double, plugin cannot reach it ⟨PLAN Be-smart 4⟩

**5.6.0 Predicate for a specified or judged mapping** ⟨Profile §5.3⟩ ⟨BR-019, BR-044⟩: `column` → the
row's own SKOS through `table`; `labelTable` → `table[sourceLabel]`; `channelAssertion` → the declared
predicate. The record stamps `predicateAssertedBy` accordingly. The judge is NEVER asked for a predicate
in v1 (`derived` is out ⟨RULING R6⟩); a volunteered one cannot land — the tool schema has NO predicate
slot ⟨BR-065⟩ — and the discard is COUNTED (BG-P6 b).

`judge.judgeOne({ question, judgeClient, judgmentCache, matchForensics, budget }, cb)`:

1. **Frame** the question — `evidenceRenderer.js`, NEW, Profile-shaped, `RENDERER_VERSION =
   'bridgeEvidenceRenderer-v1'` as data: the SOURCE ELEMENT by name + blinded material + the source's
   own labels/notes/evidence columns ⟨BR-092⟩; the candidate pool AFTER the filter, SORTED BY
   `stableId` ⟨RULING R2⟩, each with tuple + definitions + the reason it is in the pool
   (`filteredOnKeyAndDomain`, `nominatedBy`…) — a REPRESENTATION POLICY as data, per-seat provenance
   ⟨BR-068⟩; global guidance candidate-blind ⟨BR-067⟩; the smuggling gate (REUSE `evidenceContracts.js`
   A2/A3) refuses a segment that names a candidate; a package without a named source refused
   ⟨HARVEST §1.14⟩. The rendered text's sha256 is `promptHash`.
2. **Cache** ⟨BR-069, BR-120⟩ ⟨HARVEST R-H9⟩: key `(promptHash, model, rendererVersion)` — REUSE
   `lib/judgment-cache` `getJudgment`/`putJudgment` as they ARE; a hit is RE-VERIFIED (the remembered
   `chosenStableId` present in the CURRENT `renderedPoolStableIdList`) else refused and re-asked. Every v1 judgment starts
   COLD (the 4,719 warm rows are keyed to the retired renderer ⟨RISK §1.5⟩); the report says
   `liveJudgmentCount` / `cacheHitCount`.
3. **Ask** ⟨RULING BF1⟩ ⟨REVIEW D2, D3, D5⟩: `judgeClient.rerank({ systemPrompt, userPrompt,
   choiceEnum: ['1'..'N','NONE'], requireJudgment: true })` — the ONE contract both `llmClient` and
   `debugJudge` satisfy. **The judge's REAL return is** `[code fact]` `llmClient.js:441-450`
   `{ choice, model, attempts, category, rationale, usage, stopReason, retryReasons }` where `choice`
   is an ORDINAL STRING from `choiceEnum` (`'1'..'N'` or `'NONE'`), and there is NO `predicate` key
   anywhere in `llmClient.js` or `debugJudge.js`. **`llmClient.js` and `debugJudge.js` are UNCHANGED in
   v1** — no predicate slot exists and none is added; a `derived`-era predicate question is a
   `llmClient` change inside the fingerprint tree, out of scope. The framework's judge COMPONENT
   adapts, in `judgeComponent.js`: (a) it renders the pool in `stableId` order (step 1) and RECORDS that
   ordered list as `renderedPoolStableIdList` on the decision record and in the forensic record — the
   ONE authority for the pick; (b) it maps the returned ORDINAL `choice` to `chosenCardStableId =
   renderedPoolStableIdList[choice - 1]`, and `'NONE'` to an abstention (`chosenCardStableId: null`);
   (c) a `choice` outside `choiceEnum`, or a `category`/`rationale` absent or blank, is REFUSED by name,
   never defaulted ⟨BR-066⟩. Abstain is a first-class return that emits nothing ⟨BR-066⟩; the rationale
   must name the choice by `canonicalKey`+name, never by ordinal ⟨BR-067⟩ — checked lexically.
   `confidence` is DERIVED from `category` by `CONFIDENCE_BAND_TABLE` (data), never a float from the
   judge ⟨BR-066⟩ ⟨C1⟩. Predicate authority ⟨BR-065⟩ is satisfied STRUCTURALLY: the tool schema has no
   predicate slot, so nothing can be volunteered; BG-P6 (b) asserts no `predicate` key survives from
   the return into the record.
4. **Record** ⟨RULING BF1⟩: the framework BUILDS `putJudgment`'s payload ITSELF —
   `{ choice, category, rationale, chosenStableId }` (`chosenStableId` = the mapped `chosenCardStableId`,
   `null` on abstain) — exactly what `[code fact]` `judgment-cache.js:219-251` REQUIRES (`choice`,
   `category`, `rationale` non-empty strings; `chosenStableId` present, null allowed); `putJudgment`
   BEFORE delivery (decided = persisted; put failure FATAL); a cache HIT is re-verified by its
   `chosenStableId` against the CURRENT pool (step 2). `matchForensics.appendRecord` with prompt text
   inline, `renderedPoolStableIdList` beside the ordinal `choice`, usage, latency (REUSE
   `lib/match-forensics`) — the truth-set source ⟨BR-122⟩;
   budget: a DECLARED per-run `maxJudgmentCount` + the client's cost report HALTS the run by name, never
   trims ⟨BR-069, BR-120⟩.
5. **Debug double** ⟨RULING R5⟩ ⟨RISK §3.2⟩: `debugJudge.js` REUSED as-is (`first | abstain | digest`
   register; `model: debugJudge-<rule>-v1-INVALID_DEBUG`; `decisionAlgorithm: INVALID_DEBUG`; `usage:
   null`; self-announcing rationale; no caching). The framework reads `debugMarkFromLlmClient` and MUST
   (a) NOT `putJudgment` (cache row count UNCHANGED across a debug run); (b) suffix the block generation
   with the mark (`generationWithDebugMark`); (c) stamp EVERY edge of a debug block — specified ones
   included — `provenanceTier: 'invalid-debug'` (`[code fact]` `vocabulary.js` carries the tier) and
   every judged edge `mappingTool` = the debug model id, on freeze AND on plain replay
   (`debugMarkFromGeneration`; `[code fact]` `debugMarkFromLlmClient` reads `kit.inferenceConfig.llmClient`
   — the framework, having no `kit`, calls it with `{ inferenceConfig: spec.inferenceConfig }`, a local
   nesting, not an edit ⟨REVIEW D6⟩); (d) return the SAME `{ choice, category, rationale, … }` shape as
   the real client — no predicate key; (e) be refused outside an active
   `--rebridge` scope or beside an injected client (`build.js:807-823`, already red in
   `test-useDebugJudge.js`). The gate-suite default rule is `digest` (`first` is degenerate and, with a
   stableId-sorted pool, hides an ordering fault); `abstain` runs once per suite. A debug block is
   detectable by ONE cypher: `MATCH ()-[r]->() WHERE r.provenanceTier = 'invalid-debug' RETURN count(r)`.

The plugin never sees `judgeClient`, `judgmentCache`, or `matchForensics` — destructured off `spec`
inside `run` and passed to `judgeOne` only ⟨BR-021⟩; BG-CONTAIN's Proxy asserts a hook receives no key
of those names.

### 5.7 Materialise — from the frozen block ONLY, through the writer ONLY ⟨ARCH §3.6⟩

For each decision record with a pick: `writer.writeMappingEdge({ subjectStableId, objectStableId,
edgeType: SKOS_EDGE_TYPES[predicate], edgeProperties })` — `objectStableId` READ OFF THE RECORD
⟨BR-031⟩ ⟨HARVEST R-H1⟩; the writer refuses by name if either endpoint node is absent in `inGraph`.
Records sorted by (`subjectStableId`, `objectStableId`, `predicate`) before writing ⟨BR-072⟩. ONE EDGE
PER DISTINCT (`subjectStableId`, `predicate`, `objectStableId`), attestation channels as DATA on that
edge ⟨BR-045⟩; a (`subject`, `object`) pair carrying two predicates is refused at freeze (BG-EDGE-UNIQUE).
Edge properties (camelCase internal ⟨BR-057 RULED⟩; the CLOSED set = `vocabulary.MAPPING_PROPERTIES`
as extended in B2 ⟨RULING A7, R7⟩ — `[code fact]` today it holds 10 names, has ZERO consumers, and no
closed-set check exists anywhere in the tree; the closed-set enforcement is NEW code in
`graphWriter.js`, budgeted in B2 ⟨RULING BF12⟩ ⟨REVIEW F7⟩): `predicate`, `mappingJustification`, `matchBasis`, `resolution`,
`confidence` (judged only — ABSENT on specified, never `1.0`, never `null` ⟨C1⟩), `mappingProvider`,
`mappingTool` + `mappingToolVersion` (judged only), `subjectMatchField`, `objectMatchField`,
`subjectSource`/`subjectVersion`, `objectSource`/`objectVersion`, `sourceLabel` (raw),
`predicateAssertedBy`, `attestationChannelList`, `decisionBlockHash` (EVERY edge ⟨RULING R1⟩), `matchId`
(internal, never exported), and `provenanceTier: 'invalid-debug'` on a debug block only —
`PROVENANCE_TIER` otherwise retires from mapping edges ⟨BR-143⟩ ⟨C6⟩ ⟨Profile §4.6 v1.0.5 carve-out,
RULING BF16⟩. The writer stamps the block's PAIR-SCOPED `applyLabel` (§5.9) on BOTH endpoints
(harvest-by-label needs labelled endpoints and the edge, `[code fact]` `replay-engine.js:833-853`;
`labelMatch` joins labels conjunctively) and MERGEs the edge on (`from`, `type`, `to`); returns
`edgeWritten` ("an un-counted write cannot be gated" ⟨HARVEST §1.14⟩). Because the bridge's writer
writes through its own bolt session (not through `replay-engine`'s write path), a one-element
`attestationChannelList` is stored as a real list; the `pgToStored` scalar collapse (§5.2) is a
CARD-side fact only ⟨REVIEW A5⟩.

### 5.8 The census and the run report ⟨PLAN Be-smart 6⟩ ⟨BR-007⟩

`census.cardinalityCensus` (pure) → TWO tables ⟨RULING BF4⟩:

**(i) the per-TARGET table** — one row per (subject, target) record as classified by §5.4:
`targetCount`, `specifiedCount`, `judgedCount` (of which `sourceSideMismatchCount`, `tentativeCount`),
`abstainedCount`, `orphanCount`, `valueTierRefusedCount`, plus `sentinelDroppedCount`,
`sentinelLabelledRowCount`, `labelRefusedCount` (rows under a `refused`-disposition label ⟨RULING BF17⟩),
`manyToOneSubjectCount`, `remodelAppliedCount { propertySide, classSide }`, `distinctTripleCount`,
`edgeCount`, `contentionCensus`, `indexCollisionCount`; and per ROW of the source the same counts.

**(ii) the per-SUBJECT table** — ONE bucket per subject, chosen by the NORMATIVE PRECEDENCE RULE
⟨RULING BF4⟩ ⟨REVIEW B6⟩, first match wins:
`subjectCollision` (§5.4 row 2) › `sourceGap` (row 1) › `specified` (the subject has ≥ 1 specified
target) › `judged` (≥ 1 judged target, none specified) › `orphan` (every target orphaned or
value-tier-refused). Members: `subjectCount`, `specifiedSubjectCount`, `judgedSubjectCount`,
`orphanSubjectCount`, `subjectCollisionCount`, `sourceGapCount`; invariant
`specifiedSubjectCount + judgedSubjectCount + orphanSubjectCount + subjectCollisionCount + sourceGapCount === subjectCount`
(BG-CENSUS c). Under this rule the `Address.AddressType` combination subject (2 specified + 1 orphan
target) is ONE `specified` subject; the acceptance figures (§10.4) are per-SUBJECT figures from THIS
table, the per-target table is frozen beside them. `abstained` is a per-target outcome inside a
`judged` subject, never a subject bucket.

`conflictCount` is a REPORT member ONLY (§5.5) — a conflict is known only after two blocks exist, so it
can never be a member of a frozen census; a report line names it above `conflict` › everything in the
seam face's own per-pairing roll-up ⟨RULING BF8⟩ ⟨REVIEW B7⟩. Both census tables are MEMBERS of the
frozen text (§7) ⟨RULING R7⟩. Run-variable counters — `judgeSpend { asked, servedFromCache, abstained,
usd }`, `conflictCount`, wall clock — go in the REPORT, never the block. The report also carries: `blindingDeclarationEcho`, `refusalList` (every refusal's reason and
count), the subject→node report (resolved / refused / leaves / shared / same-target / collisions), the
consistency-check report, the value-tier count, and the label-table digest. Printed on `xLog` line by
line, not only counted.

### 5.9 The runReport — what `run` returns; the producer ALWAYS named ⟨RULING A1⟩ ⟨ARCH §0, §3.9⟩

`{ inGraph, bridge, applyLabel, producer: 'authored', decisionBlock: { decisionBlockHash, pairKey } |
null, blocks: [ ONE block ], edgesWritten, counts (the census), generation, rendererVersion,
mode: 'materialise' | 'rejudge', sssomExportPath?, note }` — declared as `RUN_REPORT_RESULT_KEYS` and
mirrored into `COMPONENT_SHAPES.bridgeMaker.run.resultKeys` in the B2 commit ⟨BR-140⟩ ⟨RULING A8⟩.

**`blocks[]` with a PAIR-SCOPED `applyLabel`** ⟨RULING BF2⟩ ⟨REVIEW A3⟩. `[code fact]` `build.js:1722`
synthesises a silent producer's block with `applyLabel: RELATION_LABEL`, and `RELATION_LABEL =
'BridgedRelation'` (`build.js:299`) is ONE global constant; harvest is label-scoped
(`replay-engine.js:837-840`), not pairing-scoped — so with Ed-Fi and SIF in one recipe (the B4 end
state) the second harvest would return BOTH plugins' edges, because both writers stamp the same label
on their subjects and on the SHARED hub cards, and neither relationship-block id would be reproducible
in isolation. The framework therefore ALWAYS returns `blocks: [{ applyLabel: <pairScopedLabel>,
firstStandard: config.sourceStandardName, secondStandard: <hub name>, producer: 'authored',
decisionBlock }]` — exactly ONE block — where `pairScopedLabel` = `spec.applyLabel + '_' + SOURCE + '_' + HUB`
with the recipe tokens upper-cased (`BridgedRelation_EDFI_CEDS`), the path `build.js` already
exercises for the CTDL family (`[code fact]` `test-build.js:836-838`, `'BridgedRelation_CTDL_CTDLASN'`);
`graphWriter` stamps THAT label on both endpoints (§5.7); `build.js` untouched. `spec.applyLabel` as
handed in is the label FAMILY prefix, never stamped bare.

**The trap, defused by naming.** `[code fact]` `build.js:1736-1745` BELIEVES a named producer and
infers only a SILENT one from `decisionBlock` (null → `authored`/`_exact`; non-null →
`inferred`/`_close`). A crosswalk plugin FREEZES a block AND is `authored` ⟨Profile §4.7⟩, so a silent
framework would have every Ed-Fi block named `_close`. The framework MUST ALWAYS return `producer`
explicitly from the plugin's declared `producerKind` (= `matchBasis` standard/crosswalk → `authored` →
`_exact`) through the vocabulary's own `RELATIONSHIP_PRODUCER_SUFFIX` rows (`[code fact]`
`vocabulary.js:158-169`, three rows: `authored`/`inferred`/`structural`; note the guard at `build.js:1741` is a TRUTHINESS test on the suffix, so a producer whose registered suffix were `''` would fall through — the three registered suffixes are all non-empty ⟨REVIEW A1⟩), zero `build.js` change (BG-PRODUCER) ⟨RULING A1⟩. ONE relationship block per
pairing, suffix `_exact`, `resolution` + predicate on every edge — the suffix is keyed by PRODUCER KIND,
never by predicate ⟨RULING R8⟩ (this CORRECTS the architect paper's `_exact`/`_close`-per-predicate
note; Appendix A).

---

## 6. The kit-only door for edges ⟨PLAN Be-smart 1⟩ ⟨BR-018..023⟩ ⟨ARCH §4⟩

There is no `kit` handed to a bridge plugin: a forge WALK creates nodes, a bridge plugin creates
NOTHING. What a plugin can do is bounded by the ARGUMENT OBJECTS its hooks receive (§4.2): verified
channel paths, the source-scoped blinded reader, `xLog`. Consequently a plugin:

- **cannot mint an edge** — no writer, no driver, no `addEdge`; the writer is constructed inside `run`
  and handed to `materialise` only; the plugin file may not `require` a driver ⟨BR-020⟩;
- **cannot address by join key** — `cardListByCanonicalKey` is a `run`-local closure; no reader member
  returns a card by key ⟨BR-018⟩;
- **cannot override a predicate** — the walk yields the SOURCE's predicate or `null`; the framework
  applies `predicateSource`; the record stamps `predicateAssertedBy` ⟨BR-019, BR-044⟩;
- **cannot emit to an unresolved target** — `objectStableId` exists only on a framework-made record after
  the filter; the plugin never sees a card's `stableId`;
- **cannot reach the judge, cache, forensics, store, embedder** ⟨BR-021⟩;
- **cannot set `confidence`, `mappingJustification`, `resolution`, `matchBasis`** ⟨BR-022⟩ — a walk
  assertion carrying any of them is refused by name;
- **cannot normalise a standard name** ⟨BR-023⟩ — the reader is scoped by `config.sourceStandardName`
  EXACT.

The WRITE SEAM (`lib/bridge-framework/graphWriter.js`, §14.1): refuses an `edgeType` outside
`SKOS_EDGE_TYPES`; a `predicate` property that disagrees with the type; a judged edge without
`confidence` + `decisionBlockHash`; a specified edge WITH `confidence`; a `mappingJustification` outside
the three; a missing endpoint; an object endpoint that is not a `HubReference` or a subject endpoint
whose `_source` ≠ the pairing's source; any NON-mapping edge type under the pair-scoped label
(conservativity, BG-CONSERV — "no non-mapping EDGE under the label", since the harvested block carries
nodes by construction ⟨RULING BF3⟩) ⟨HARVEST "guarded write seam"⟩. The writer stamps the block's
PAIR-SCOPED `applyLabel` (§5.9) ⟨RULING BF2⟩.

---

## 7. The decision block, content addressing, and replay ⟨PLAN Be-smart 5⟩ ⟨BR-070..075⟩ ⟨RULING R1⟩

**Two content-addressed artifacts; the acceptance test names BOTH** ⟨RULING R1⟩ ⟨RISK §1.1⟩:

```
plugin walk ──assertions──▶ framework resolver ──decision records──▶ FREEZE ──▶ DECISION BLOCK  (decision-store, pairKey, seq; id = sha256(frozenText))
                                                                                    ▼
                                                                    MATERIALISE: edges under the PAIR-SCOPED applyLabel, each carrying decisionBlockHash; both endpoints labelled
                                                                                    ▼
                                                        replay.harvest(pairScopedLabel) ──▶ RELATIONSHIP BLOCK ──▶ manifest
                                                                                    (NODES — every labelled endpoint incl. hub cards, with embeddings — AND EDGES;
                                                                                     id = sha256(canonical block text) — coupled to the decision block AND to hub-card content, embedding model, --vectorize)
```

**The relationship block carries NODES and EDGES** ⟨RULING BF3⟩ ⟨REVIEW A4⟩: `[code fact]`
`replay-engine.js` `harvestBlock` skips node collection only for a `pairA` selector; `build.js` harvests
by `selectionLabels`, so `fetchNodesByLabelsPaged` runs and every labelled endpoint — each source leaf
and every hub card that was an endpoint — enters the block as a full node record with its embedding
(`build.js:1782-1790` declares embedding width/model in the header for exactly this reason). The block's
id is therefore a function of the decision block's (via `decisionBlockHash` on every edge) AND of
hub-card content, the embedding model and `--vectorize`; the frozen command (§7.4) pins the latter two.
`[code fact]` `shapeEdgeProps` (`replay-engine.js:696`) wraps EVERY edge property in a one-element list
on harvest (`pgArray`, `:85`) — the harvested block's edges are list-wrapped; this is STATED here and
never asserted against: every edge-property gate reads the GRAPH (the writer's own view), and ONE
conjunct (BG-HARVEST) compares the harvested block's EDGE COUNT to `edgesWritten` ⟨RULING BF3⟩ ⟨REVIEW
A5, A10⟩.

### 7.1 The frozen text ⟨ARCH §5⟩ ⟨RISK §1.2⟩

CANONICAL JSON: header keys in a declared order; `decisionRecordList` sorted by (`subjectStableId`,
`objectStableId`, `predicate`); inside a record, keys sorted; every list of stableIds sorted; no
`undefined`/`NaN`/`Infinity` (refused); no timestamps, run ids, or paths (a document is named by
`channelKey` + sha256); evidence BY REFERENCE (`promptHash`, `rendererVersion`, `judgeModel`) never
embedded ⟨HARVEST R-H8⟩. **The predicate and the remodel resolution are FROZEN INTO THE RECORD**; a plain
build never re-consults a table ⟨RULING R7 D-1⟩. **The census is a MEMBER of the frozen text** ⟨RULING R7
D-2⟩. `blockIdFor = contentAddress.blockIdForText(frozenText)`.

Header (self-description ⟨BR-071⟩): `{ frameworkGeneration: 'bridgeFramework-v1', frameworkFingerprint
(§7.2), rendererVersion, bridgeName, pluginVersion, declarationDigest (sha256 over the canonical
declaration — a changed label table or column map is a different generation), labelTableDigest,
remodelTableDigest, matchBasis, producerKind: 'authored', judgeKind: 'anthropic:<model>' | 'debug:<rule>'
| 'none', sourceWindow: windowMark | null, blindingDeclaration, sourceStandardName, sourceVersion,
hubName, hubVersion, sourceChannelDigestByKey, contentionCensus, cardinalityCensus (both tables of §5.8;
never `conflictCount`) }`. A `--limit` run's
block carries `windowMark` and every edge from it is legible as PARTIAL; a debug run's generation ends in
the debug mark. `mapping_date` appears ONLY as data from the source (none for Ed-Fi/SIF).

`pairKey` = `<hubToken>@<hubVersion>::<sourceToken>@<sourceVersion>::<bridgeName>::<producerKind>`
⟨RULING R3⟩ ⟨BR-056⟩ ⟨HARVEST §1.8⟩ — the store is UNTOUCHED (its `pairKey` is a string; the framework
composes it; BG-PAIRKEY asserts it; `[code fact]` `pairKey TEXT` with no constraint, `seq INTEGER PRIMARY
KEY AUTOINCREMENT`); LATEST by `seq`; idempotent re-save is a no-op; the content address is re-checked on
read (`decision-store.js:220-229` — corrected citation ⟨REVIEW D1⟩).

### 7.2 `frameworkFingerprint` ⟨RULING R4⟩ ⟨RISK §2.3 b⟩

sha256 over the sorted, path-labelled contents of `lib/bridge-framework/**/*.js` (excluding `test/`),
`apps/graph-builder/apps/bridge-maker/bridgeMaker.js` and `apps/graph-builder/apps/bridge-maker/lib/*.js`
(all four ⟨RULING D-S7⟩) — NEW code in `decisionBlock.js` (a file-tree hasher; `[code fact]`
`lib/forge-framework/fingerprint.js` exports `pureLayerFingerprint({ nodes, edges })` and `canonicalText`
— a GRAPH-result hasher, not reusable ⟨RULING BF12⟩ ⟨REVIEW D4⟩), computed by the framework about ITSELF at
freeze time and written into the header. It is content-derived, not settable — the F2 rule against a
`frameworkVersion` stamp is honoured; this is what makes "zero framework change" checkable on the
artifacts alone (BG-COMPOSE b) ⟨RISK D-8, adopted⟩.

### 7.3 Determinism ⟨BR-006, BR-072⟩ ⟨RISK §1.2⟩

All reads collected then sorted; the post-filter pool sorted by `stableId` before render (BG-POOL-ORDER
⟨RULING R2⟩); judgments dispatched with a bounded runner collecting by index in SUBJECT ORDER; the freeze
sorts again; two re-judges on one warm cache (or under `digest`) produce the same bytes; two `run`s on
one framework instance are independent; static grep for `Date.now|new Date|Math.random|process.hrtime|
crypto.randomBytes` over the framework tree, the seam face and every plugin file → zero (BG-DET).

### 7.4 Replay — the three-run protocol and the frozen command ⟨RULING R1⟩ ⟨RISK §1.7⟩

1. `-build --rebridge=<std> --useDebugJudge=digest` → decision block **A**, relationship block **R₁**.
2. `-build` (plain, same recipe, same store) → ZERO judge/embedder calls, decision block read = **A**
   (verified), relationship block **R₂ === R₁**.
3. `-build --rebridge=<std> --useDebugJudge=digest` again → **A′ === A**, **R₃ === R₁**. With the REAL
   judge and a warm cache, **A′ === A** with `liveJudgmentCount 0`; on a cold store it is a new block and
   the report says so.

Relationship-block byte-identity across runs 1–3 holds ONLY under the frozen command, because the block
carries nodes with embeddings ⟨RULING BF3⟩: `--vectorize`, the embedding cache and the hub build are
inputs to R₁. ONE frozen command per plugin in `lib/bridge-framework/test/acceptance/acceptanceCommands.jsonc`
(the forge framework's idiom): recipe path, `--vectorize=true`, the warm `--embeddingCacheFilePath`, ABSOLUTE
scratch `--standardsDatabaseFilePath`, `--decisionStoreFilePath`, `--judgmentCacheFilePath`,
`--matchForensicsDirPath`, `--rebridge=<std>` + `--useDebugJudge=<rule>` for steps 1/3, `</dev/null`,
`--max-old-space-size=20000`. A frozen id compared against a run with a different flag set is a broken
test, not a failed gate.

---

## 8. The SSSOM exporter ⟨Profile §4⟩ ⟨BR-054, BR-055⟩ ⟨ARCH §3.7⟩

`exporter.toSssomTsv({ decisionBlock, curieMap, setLevelSlots, outputPath }, cb)` — a first-class member,
run at the end of every re-judge (beside the block in the run's output dir; `outputPath` REQUIRED) and
on demand. Rows: `subject_id` (`subjectCuriePrefix` + the forged id), `object_id` (the card `uri`),
`predicate_id` (`skos:`), `mapping_justification`, `object_label` (MUST), `confidence` (judged only),
`subject_source`/`object_source` + `_version` (`subject_source_version` = the block's `sourceVersion`,
i.e. `selfDescribedVersion ?? 'unknown'` under S3 for SIF ⟨IMPL §2.4⟩; §16 D-S4), `subject_match_field`
(the DOCUMENT prefix for `crosswalk` — `edfiCedsCrosswalk:CEDSGlobalId|edfiCedsCrosswalk:CEDSOntologyClassURI`
when both supplied — for `standard` the standard's prefix + the PROPERTY NAME the walk read, never the header text: SIF `sif:cedsId`, CURIE-safe ⟨RULING BF13⟩ ⟨REVIEW C7⟩), `object_match_field:
EDUcoreCeds:canonicalKey|EDUcoreCeds:domainId|EDUcoreCeds:propertyKey|EDUcoreCeds:qualifierKeys`
⟨Profile §4.5⟩ ⟨BR-052⟩, `mapping_provider` / `mapping_tool` (+version) by the §4.3 table,
`author_id`/`creator_id` where known ⟨BR-058⟩, `mapping_date` ONLY when data. `curie_map` declares every
non-built-in prefix (`EDUcoreCeds`, `edfi`/`sif`, `edfiCedsCrosswalk`); propagatable slots condensed to
set level when uniform; the label table / channel assertion (with citation) exported as set-level
provenance ⟨Profile §5.3⟩ ⟨BR-046⟩. Refuses BEFORE writing: an undeclared prefix; a banned justification
(`vocabulary.sssomJustificationRefusal` — `isValidSssomJustification`'s boolean is REMOVED ⟨BR-145
RULED⟩); a `mappingProvider` not recorded as verified ⟨RULING P7⟩; a `mapping_date` the source did not
supply. TSV only in v1.

---

## 9. The plugin registry — data, built by discovery ⟨RULING A2⟩ ⟨BR-003⟩ ⟨ARCH §1.4⟩

Built ONCE at seam-face construction by discovery over the convention `forges/<standardKey>/bridges/*.js`
and validated then — BEFORE any forge is spent (`[code fact]` `build.js:1087` constructs the bridgeMaker
before Phase A). Each file exports `{ bridgeDeclaration, bridgeHooks }`; the registry KEY is
`bridgeDeclaration.bridgeName`; the registry is frozen data `entryByBridgeName[bridgeName] = { bridgeName,
standardKey, bundleDirPath, pluginFilePath, bridgeDeclaration, bridgeHooks }`. Refusals, all by name, all
at construction: a duplicate `bridgeName` (both paths named); a plugin whose `standardKey` ≠ its directory;
a file under `bridges/` that does not export the two names (a stray file is a REFUSAL, not an ignored
file — "declared-but-broken refuses every build" ⟨FF §5.4⟩; this answers the risk paper's
"registry-that-is-a-directory-search" smell, Appendix A); any declaration/hook drift (§4.3). At `run`: an
unregistered `spec.bridge` → refused naming the registered names; a registered plugin whose
`standardKey` ≠ `spec.source` → refused. No three-directory search path returns ⟨SEAM §3⟩. Adding a
second standard's plugin is one file and NO edit anywhere in the framework — that IS BR-003's "one
registration" and the composability diff (§12.1 a) is therefore EMPTY.

---

## 10. The Ed-Fi plugin — the worked example ⟨RULING P1–P4, P11⟩ ⟨IMPL §1⟩ ⟨BR-130..138⟩

`forges/edfi/bridges/edfiCedsCrosswalkPlugin.js` — `matchBasis: crosswalk`, `producerKind: authored`.
Every value below is `[measured]` by OCEAN_PEAK against the two CSVs and `GOLD_EVAL_260816` unless marked.

### 10.1 The declaration values — rewritten to pass BG-DECL ⟨RULING BF5, BF6, BF14, BF17⟩

The full `CEDSMappingConfidence` census over ALL 1,666 Elements rows `[measured]` ⟨REVIEW B5⟩:
`Yes` 1,046 · `Not in CEDS` 473 · `Maybe` 121 · `Derived` 25 · `Partial` 1 · blank 0. Over the 1,179
real-id rows: `Yes` 1,046 · `Maybe` 117 · `Derived` 15 · `Partial` 1; the 487 sentinel rows carry
`Not in CEDS` 473 + `Derived` 10 + `Maybe` 4 (the 14 `sentinelLabelledRowCount`).

```
bridgeDeclaration = Object.freeze({
  bridgeName:        'edfiCedsCrosswalkPlugin',
  standardKey:       'edfi',
  pluginVersion:     '1.0.0',
  producerKind:      'authored',
  matchBasis:        'crosswalk',
  mappingProvider:   { url: '<published URL of the CEDS-authored Ed-Fi crosswalk>', verifiedBy: null },   // B3 builder verifies and records; export refuses until then
  sourceCuriePrefix: { prefix: 'edfiCedsCrosswalk', iri: '<document IRI>' },
  subjectCuriePrefix:'edfi',
  sourceChannelList: [
    { channelKey: 'elements', sourceKind: 'document', tier: 'property', disposition: 'walk',
      relativePathFromBundleRoot: 'assets/standardSourceData/04/cedsAuthoredCrosswalk/EdFiEntityElementsToCEDS.csv',
      checksumListRelativePathFromBundleRoot: 'assets/standardSourceData/04/SHA256SUMS',
      encoding: 'utf-8', absentTargetSentinelList: ['000000'],                                     // 27 columns, 1,666 rows, 1,179 real ids, 487 sentinel
      columnClassification: {                                                                     // EVERY one of the 27 header columns in EXACTLY ONE list ⟨RULING BF6⟩
        subjectIdentityColumnList:  ['EdFiEntity', 'EdFiEntityPath', 'EdFiElementName'],
        tupleFieldColumnList:       ['CEDSGlobalId', 'CEDSOntologyClassURI'],
        sourceLabelColumnList:      ['CEDSMappingConfidence'],
        carriedRecordColumnList:    ['EdFiElementType', 'EdFiRequired', 'CEDSElementType', 'CEDSMappingNotes',
                                     'CEDSOntologyConceptSchemeURI', 'CEDSOntologyConceptSchemeLabel', 'CEDSOntologyPropertyRangeIncludes'],
        evidenceOnlyColumnList:     ['EdFiElementDescription', 'EdFiEntityDescription', 'CEDSElementName', 'CEDSElementDefinition',
                                     'CEDSOntologyClassLabel', 'CEDSOntologyPropertyLabel'],
        consistencyCheckColumnList: ['CEDSOntologyPropertyURI', 'CEDSOntologyPropertyNotation'],
        ignoredColumnList:          ['CEDSDWTable', 'CEDSDWColumn', 'CEDSDWElementType', 'CEDSStagingTable', 'CEDSStagingColumn', 'CEDSStagingElementType'],
      } },                                                                                        // 3 + 2 + 1 + 7 + 6 + 2 + 6 = 27 ✓
    { channelKey: 'descriptors', sourceKind: 'document', tier: 'value', disposition: 'refuseByNameAndCount',   // EXEMPT from coverage; header listed for the count
      relativePathFromBundleRoot: 'assets/standardSourceData/04/cedsAuthoredCrosswalk/EdFiEntityDescriptorsToCEDS.csv',
      checksumListRelativePathFromBundleRoot: 'assets/standardSourceData/04/SHA256SUMS',
      encoding: 'latin1', absentTargetSentinelList: [''],
      headerOverrideByIndex: { 8: 'EdFiElementDescription' },                                     // `EdFiDescription` appears at index 4 AND 8 [measured]; crosswalkCarrier.js:48 precedent
      headerColumnList: [ /* the 18 names after the override, listed verbatim by the B3 builder */ ] },     // 8,310 rows, 5,970 value-tier assertions — counted, refused ⟨BR-134⟩
  ],
  subjectIdentity:   { kind: 'columnTuple', columnList: ['EdFiEntity', 'EdFiEntityPath', 'EdFiElementName'] },   // ⊆ elements.subjectIdentityColumnList; 1,146 subjects ⟨BR-136⟩
  tupleFieldColumnMap: {                                                                          // references into elements.tupleFieldColumnList
    canonicalKey: { column: 'CEDSGlobalId',         transform: 'globalIdToPrefixedKey' },        // 'P' + id ⟨RULING BF14⟩
    domainId:     { column: 'CEDSOntologyClassURI', transform: 'uriFragment' },                   // fragment after '#'; populated on 1,103 of 1,179 ⟨BR-131⟩
  },
  predicateSource:   { kind: 'labelTable', column: 'CEDSMappingConfidence',                       // ∈ elements.sourceLabelColumnList
    table: { Yes:           { disposition: 'predicate',    predicate: 'exactMatch' },            // 1,046 rows
             Partial:       { disposition: 'predicate',    predicate: 'closeMatch' },            // 1
             Derived:       { disposition: 'predicate',    predicate: 'closeMatch' },            // 15 real-id (+10 on sentinel rows, counted); matchBasis stays crosswalk ⟨BR-047⟩
             Maybe:         { disposition: 'tentative',    predicateIfPicked: 'closeMatch' },    // 117 real-id (+4 sentinel) → judged ⟨RULING P3⟩ ⟨D-S3⟩
             'Not in CEDS': { disposition: 'sentinelOnly' } } },                                  // 473 rows, ALL on the 000000 sentinel; on a real-target row → run refused ⟨RULING BF5⟩
  evidenceColumnMap: { subject:   ['EdFiElementDescription', 'EdFiEntityDescription'],           // references: evidenceOnly ∪ carriedRecord ∪ sourceLabel
                       assertion: ['CEDSElementName', 'CEDSElementDefinition', 'CEDSMappingNotes',
                                   'CEDSOntologyClassLabel', 'CEDSOntologyPropertyLabel'] },
  consistencyCheckColumnList: [                                                                   // references into elements.consistencyCheckColumnList
    { column: 'CEDSOntologyPropertyURI',      transform: 'uriFragment', against: 'canonicalKey',          disposition: 'refuse' },   // agrees 1,103/1,103
    { column: 'CEDSOntologyPropertyNotation', transform: 'verbatim',    against: 'card.propertyNotation', disposition: 'report' },   // 1,065 agree / 9 disagree ⟨D-S10⟩
  ],
  segmentNormalisationRuleList: [                                                                 // consumed by subjectStableIdFor (§10.3) ⟨RULING BF17⟩
    { appliesTo: 'entity',      match: ' (TPDM)',      action: 'stripSuffix' },
    { appliesTo: 'segment',     match: ' - DEPRECATED', action: 'stripSuffix' },
    { appliesTo: 'segment',     match: ' (from TPDM)', action: 'stripSuffix' },
    { appliesTo: 'lastSegment', match: 'Descriptor',   action: 'invertDescriptor' },
  ],
  remodelTableRef:       'ceds14PropertyRemodel',      // hub-owned six-entry table, by reference ⟨RULING P11⟩ ⟨D-S5⟩
  classSideRemodelTable: [],                            // ⟨BR-036⟩ SHOULD; empty in v1
  blindingDeclaration:   ['cedsId', 'crossRefs', 'cedsOriginalAnchorPropertyName',                // property nodes [code fact] forgeEdfiContractGraph.js:781-784
                          'cedsOptionCode', 'cedsOptionOriginalAnchorPropertyName'],              // option-value nodes [code fact] :907-908 ⟨RULING BF17⟩ ⟨REVIEW C9⟩
  evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },
  compatibilityDeclarationList: [],
});
bridgeHooks = { walkSourceAssertions, subjectStableIdFor };
```

Coverage check the validator performs: the elements channel's seven lists partition the 27 header
columns exactly (no column twice — `CEDSMappingConfidence` is classified ONCE as a source label and
REFERENCED by `predicateSource.column`; `CEDSMappingNotes` is classified ONCE as carried and
REFERENCED as assertion evidence ⟨REVIEW C1⟩); the descriptors channel is exempt but lists its 18
resolved header names ⟨REVIEW C2, C3⟩. The descriptor confidence columns (`OptionSetMatchConfidence`,
`ElementMatchConfidence`) are covered by no table in v1 BECAUSE the channel is refused by name ⟨BR-080,
BR-134⟩ — BR-137's "cover the descriptor confidences" is discharged by that refusal until the value tier
is admitted ⟨REVIEW C8⟩.

### 10.2 The walk — `walkSourceAssertions`

Reads the verified Elements bytes (UTF-8 with BOM) row by row with a state-machine CSV parser that
handles quoted embedded newlines; per row: strip ` (TPDM)` from `EdFiEntity`; the subject triple; EVERY
Global ID the row names in `rawTargetList` ⟨BR-133⟩; tuple values as read; the confidence label raw; the
notes and evidence columns; `sourceLocator: { channelKey: 'elements', rowNumber }`. Walks the descriptor
channel ONLY to fill `channelReport.valueTierRows` (5,970). Reconciliation:
`rowsRead === assertionsYielded + sentinelDropped + malformedRows + valueTierRows` per channel.

### 10.3 Subject resolution — `subjectStableIdFor`, the BR-138 walk ⟨RULING P2⟩ ⟨IMPL §1.5⟩

Declared as RULES the hook applies over `sourceReader` (constructs, properties, `SUBCLASS_OF`,
`REFERENCES`/`REFERENCES_TYPE`/`HAS_OPTION_SET` edges of the Ed-Fi source):

1. Entity: the construct named `EdFiEntity` among the property-bearing families (domainEntity,
   association, abstractEntity, common, inlineCommon, choice, subclasses), EXCLUDING
   `EdfiDomain`/`EdfiSubdomain`/`EdfiInterchange*` and `*Extension`; exactly one → continue; else
   `unresolvable: 'entityUnresolved'`.
2. Per segment of `EdFiEntityPath` (strip ` - DEPRECATED`, ` (from TPDM)`; the segment normalisation
   rules are the DECLARED `segmentNormalisationRuleList` (§4.1, §10.1) consumed by this hook through
   `sourceReader.forWalk()`): a BASE construct on the
   current construct's `SUBCLASS_OF` chain → step to it (239 rows); else the property
   `owningConstructName.segment` — on the last segment also `EdFiElementName` minus `Descriptor` (the
   carrier's inversion); exactly one → continue; if not last, follow the reference edge to the target
   construct; else `unresolvable: 'segmentUnresolved'`.
3. The last property is the leaf: `subjectStableId = leaf.stableId`.

`[measured]`: 1,144 of 1,146 resolve (522 leaves owned by the entity, 622 under a referenced construct);
2 refused (`CurriculumUsed | CurriculumUsed | CurriculumUsedDescriptor`; `Assessment |
AssessedGradeLevels | GradeLevelDescriptor`); the carrier's owner.element key resolves only 502. 1,144
subjects → 701 leaves; 89 leaves shared by 532 subjects; 82 with IDENTICAL targets → one record per
(leaf, target) with `assertingSubjectList`; **7 leaves / 31 subjects carry DIFFERENT targets** →
REFUSED by name as `subjectCollision` (Credits Attempted/Earned/Available; MeetingTime Start/End under
ClassPeriod vs Intervention; ContentStandard.Author; PublicationDateChoice.*;
EducationOrganizationIdentificationCode.IdentificationCode by organisation type). Role-anchoring was
measured WORSE (81 collisions / 519 subjects) and is REJECTED ⟨RULING P2⟩ — recorded so it is not
re-proposed. A v2 that wants those 31 needs a Profile position on entity-scoped subject CURIEs, not a
plugin knob.

### 10.4 The Ed-Fi acceptance census — FROZEN from the first accepted classifier run ⟨RULING P3, P12, BF4⟩ ⟨IMPL §4.1⟩ ⟨REVIEW B4, B6, B9⟩

The fixture `test/acceptance/expectedCensus.edfiCedsCrosswalkPlugin.GOLD_EVAL_260816.json` (keyed by
graph id AND `labelTableDigest`) is NOT written from prose arithmetic. It is FROZEN at B3 from the FIRST
classifier run the reviewer ACCEPTS — the run of §5.4's dispatch order and §5.8's precedence rule over
the real inputs — and only then does BG-CENSUS (a) become live. `expectedDecisionBlockIds.json` is
likewise frozen from that run (it is circular otherwise ⟨REVIEW B9⟩). The order of freezing is: (1) B3
runs the classifier under the debug judge; (2) the reviewer reads the per-subject and per-target tables
against the measured inputs and the projection below; (3) if the projection is reproduced (or the
delta is explained by a NAMED mover) the reviewer freezes census + ids; (4) BG-CENSUS/BG-ACCEPT then
gate every later run.

**Measured inputs the classifier runs over** (`[measured]` OCEAN_PEAK, re-verified by the review):
1,146 subjects with a real id; 1,179 real-id rows; **101 subjects whose every row is `Maybe`, of which
93 are single-row**; 22 multi-id subjects / 53 rows (10 all-`Yes` / 12 mixed per the FINDING — the
10/12 split not independently re-verified ⟨REVIEW⟩); 27 `P000590`/`P000591` subjects at `C200257`
(sourceSideMismatch); `P000367` (5 cards) and `P001572` (8 cards) qualifier-contended; `P000144` and
`P001066` absent at every tier; 6 rows / 4 subjects through the property-side remodel table.

**The PROJECTION** (per SUBJECT under §5.8's precedence): **992 specified / 151 judged / 3 orphan** —
`1,146 − 151 − 3`. It is a projection, not a derivation: the earlier decomposition "93 + 27 + 17 + 2 +
12" is NOT a partition (the 12 mixed subjects contain all-`Maybe` multi-row subjects; the 101 vs 93
distinction is single-row vs all-tentative ⟨REVIEW B4⟩), and only the classifier settles it. Per-ROW
counts under v1.0.4 semantics are frozen from the SAME run beside the per-subject table (the FINDING's
per-row 1,101 / 75 / 3 was computed under v1.0.3 and is a sanity row only ⟨REVIEW G6⟩). Orphans:
`P000144` ×3 subjects; the `Address.AddressType` combination subject (2 specified targets + the
`P001066` orphan target) is ONE `specified` SUBJECT under the precedence rule and one orphan TARGET in
the per-target table. Value tier: `refusedValueTierAssertionCount` 5,970. Subject→node report: 1,144
/ 2 / 701 / 89 / 82 / 7 collisions = 31 subjects `subjectCollision` (these 31 are `subjectCollision`
subjects under precedence, i.e. OUTSIDE the 992/151/3 — the classifier run states the exact partition
of all 1,146). Property-side remodel: `P001070/71` → the qualified `P001572` cards; `P001072/73` →
`P000827`; `P001074/75` → `P001571`. Class-side: `[]`, so the 27 mismatch subjects stay judged.

**Tolerance is EQUAL against a NAMED graph** ⟨RULING P12⟩; a percentage would hide the exact regression
the gate exists to catch (one dropped column moves 184). What legitimately moves the numbers — a
re-forged hub (contention 256/11 vs 260/13 already recorded), a ruling, a data-table row — RE-MEASURES
and the reviewer freezes a NEW fixture; the gate compares EQUAL, never approximately. The FINDING's
1,085/58/3 (label-blind semantics) is the SANITY row with the ENUMERATED mover that explains the delta
(all-tentative subjects, specified → judged); anything outside the enumerated list is a red gate ⟨RISK §2.4⟩.

---

## 11. The SIF plugin — the sketch and the composability proof ⟨RULING P5–P7, R9, R10⟩ ⟨IMPL §2⟩

`forges/sif/bridges/sifCedsStandardPlugin.js` — `matchBasis: standard`, `producerKind: authored`. The
standard supplies ONLY the join key ⟨IMPL §2.1⟩: `[code fact]` `forges/sif/lib/parser.js:19,97` reads
`CEDS ID` (column 6) → `cedsId`, ALREADY normalised to `P######` by `normalizeCedsCrossRef` and stamped
with `crossRefs` — a JSON STRING, `[code fact]` `forgeSif.js:355` `crossRefs: JSON.stringify(...)` — and
`cedsOriginalAnchorPropertyName: 'CEDS ID'` on `SifField` ⟨RULING BF13⟩ ⟨REVIEW C5, C6⟩.

```
bridgeDeclaration = Object.freeze({
  bridgeName: 'sifCedsStandardPlugin', standardKey: 'sif', pluginVersion: '1.0.0',
  producerKind: 'authored', matchBasis: 'standard',
  mappingProvider: { url: '<A4L SIF Implementation Specification URL — declared as DATA, VERIFIED to resolve by the B4 builder, recorded with provenance; export REFUSES until then>', verifiedBy: null },   // ⟨RULING P7⟩
  sourceCuriePrefix: { prefix: 'sif', iri: '<the standard's IRI>' }, subjectCuriePrefix: 'sif',
  sourceChannelList: [ { channelKey: 'cedsIdColumn', sourceKind: 'forgedGraph', tier: 'property', disposition: 'walk', absentTargetSentinelList: [''],
      channelPropertyList: ['cedsId', 'crossRefs'],                                                 // read UNBLINDED through sourceReader.forWalk() — the SOLE exemption ⟨RULING BF7⟩; crossRefs is a JSON string, PARSED IN THE WALK ⟨RULING BF13⟩
      columnClassification: { subjectIdentityColumnList: [], tupleFieldColumnList: ['cedsId'], sourceLabelColumnList: [], carriedRecordColumnList: ['crossRefs'],
                              evidenceOnlyColumnList: [], consistencyCheckColumnList: [], ignoredColumnList: [] } } ],   // covers channelPropertyList exactly (2 = 1 + 1) ⟨RULING BF6⟩; the record's XPath/Type/Format/Mandatory/Description come from the SifField node itself via forEvidence()
  subjectIdentity: { kind: 'forgedNode', property: 'stableId' },     // the SifField IS the subject; 1:1; no BR-138 walk
  tupleFieldColumnMap: { canonicalKey: { column: 'cedsId', transform: 'identity' } },   // ALREADY P-prefixed → identity, never globalIdToPrefixedKey (would yield PP000534) ⟨RULING BF13⟩ ⟨REVIEW C6⟩
  predicateSource: { kind: 'channelAssertion', predicate: 'exactMatch',
                     assertedBy: { documentName: 'ImplementationSpecification_031326', citation: '<the specification's own sentence stating what the CEDS ID column asserts>' } },   // ⟨RULING P5, R9⟩ — data with a citation, not a constant
  evidenceColumnMap: { subject: ['description', 'xpath', 'characteristics'], assertion: [] },   // SifField node properties read through forEvidence() (blinded view); names as forged
  consistencyCheckColumnList: [], segmentNormalisationRuleList: [],
  remodelTableRef: 'ceds14PropertyRemodel', classSideRemodelTable: [],
  blindingDeclaration: ['cedsId', 'crossRefs', 'cedsOriginalAnchorPropertyName',                 // both forges stamp the same triple [code fact]
                        'cedsOptionCode', 'cedsOptionOriginalAnchorPropertyName'],               // option-value nodes [code fact] forgeSif.js:81 ⟨RULING BF17⟩ ⟨REVIEW C9⟩
  evidenceHooksDeclared: { nominate: false, walkEvidence: false, globalGuidance: false },   // sifNominate/sifWalk (HARVEST §1.16) are OPTIONAL v2 evidence hooks
  compatibilityDeclarationList: [],
});
bridgeHooks = { walkSourceAssertions, subjectStableIdFor /* identity */ };
```

**The predicate (BR-012)** ⟨RULING P5, R9⟩: SIF names a target and asserts NEITHER a relation NOR a label.
`none` would make the composability gate hollow (an empty block, ⟨BR-094⟩'s shape). The plugin declares a
source-attributed CHANNEL ASSERTION — `exactMatch`, as data, CITING the SIF specification's own column-6
semantics (the standard declaring which CEDS element its field IS). The B4 builder MUST verify the
citation text in the snapshot / `README_PROVENANCE.md`; if the standard's wording is weaker
("related", "corresponds") the row is `closeMatch` — the row is data; changing it is not a framework
change. `predicateAssertedBy: channelAssertion` on every SIF edge; the citation exported at set level;
`subject_match_field: sif:cedsId` (the property NAME, CURIE-safe — never the header text `'CEDS ID'`)
⟨RULING BF13⟩ ⟨REVIEW C7⟩.

**What differs from Ed-Fi, what is shared** ⟨IMPL §2.5, §3.1⟩: different DATA — `matchBasis`, provider,
one tuple field vs two, channel assertion vs label table, subject identity node vs triple, a
`forgedGraph` channel vs two documents. Different BEHAVIOUR — SIF has no subject walk and no consistency
checks; Ed-Fi has no evidence hooks. SHARED — everything the framework owns, INCLUDING the hub-owned
remodel table (6 Ed-Fi rows and 34 SIF elements depend on the same six entries ⟨RULING P11⟩). If SIF needs
a framework edit, the framework has failed ⟨PLAN Be-smart 6⟩.

**SIF census** `[measured]` ⟨RULING P6, R10⟩: over the 2,231 `SifField` nodes with a `cedsId` (354 keys:
278 → one, 55 → many, 21 → zero): **1,875 specified (1,841 on the key + 34 via the shared remodel table)
/ 327 judged / 29 orphan** (OCEAN_PEAK) — reconciled with COPPER_TIDE's 1,841/327/63 by the 34 remodel
rows and the orphan split. B4 MEASURES AGAIN and freezes `expectedCensus.sifCedsStandardPlugin.<graph>.json`
from the real-judged run; gate runs stay on `digest` ⟨RISK D-10⟩. `P000144` and `P001066` orphan in
BOTH plugins and belong on a hub-side watch list, not in either plugin. SIF's judged share (327; the
`SIF_Metadata` block puts 138 elements on `P000534` over 3 cards) is why the debug judge is not optional
for gate runs and why BR-074's dedupe is NOT built in v1.

---

## 12. Acceptance ⟨PLAN Be-smart 6⟩ ⟨RULING P12, R1, R4⟩

A plugin on the framework is ACCEPTED when, under the frozen command (§7.4), run twice:

1. **Census EQUALITY** (BG-CENSUS a): the frozen block's `cardinalityCensus` EQUALS the committed
   `expectedCensus.<plugin>.<graphId>.json` (every member; keyed by graph id + `labelTableDigest`); the
   sum invariant holds; contention is recomputed and reported, never a constant.
2. **Both ids EQUAL** (BG-ACCEPT a, b): decision block id and relationship block id EQUAL
   `expectedDecisionBlockIds.json` per plugin; the three-run replay protocol holds. **Freezing order**
   ⟨RULING BF4⟩ ⟨REVIEW B9⟩: census and ids are FROZEN from the first accepted classifier run of B3
   (Ed-Fi) / B4 (SIF) — §10.4 — and gate every later run; before that run these two conjuncts are
   UNMEASURED, and say so.
3. **Three properties + hash on every edge** (BG-THREE): `matchBasis`, `resolution`, `predicate` (∈ SKOS
   and equal to the edge type's relation), `decisionBlockHash`; `provenanceTier` absent (or
   `invalid-debug` on a debug block only).
4. **Zero `UnspecifiedMatching`; three justifications only** (BG-P4).
5. **SSSOM/TSV validates** (BG-P7) with every prefix declared.
6. **The seven Profile gates green with twins observed red per conjunct** (§13.1) — and the BR §8
   thirteen, BR-100..BR-112 (§13.2).
7. **`-goldEvalCheck` PASS** on the run dir, and its bridge sibling REFUSES any `invalid-debug` edge
   (BG-DEBUG c) ⟨RULING R5⟩.
8. **Composability** (§12.1 / BG-COMPOSE a ∧ b ∧ c) — for the SIF phase.
9. **The mount** (B3): `-goldEvalCheck` PASS before any rename to `GOLD_EVAL_<date>_edfiBridge`
   (GNC-001), never on a debug block.

### 12.1 The composability gate — "zero framework change" asserted MECHANICALLY ⟨RULING R4⟩ ⟨RISK §2.3⟩

| conjunct | asserts | RED TWIN |
|---|---|---|
| **BG-COMPOSE (a) — the diff** | `git diff --numstat <edfiPluginAcceptedCommit>..<sifPluginAcceptedCommit> -- lib/bridge-framework/ ':!lib/bridge-framework/test/acceptance/' apps/graph-builder/apps/bridge-maker/ apps/graph-builder/lib/build.js apps/graph-builder/interfaces.js lib/vocabulary/` is EMPTY — `lib/bridge-framework/test/acceptance/` is EXCLUDED because the per-plugin fixtures (`expectedCensus.<plugin>.<graphId>.json`, `expectedDecisionBlockIds.json`, `acceptanceCommands.jsonc`) change between B3 and B4 BY DESIGN ⟨RULING BF9⟩ ⟨REVIEW E3⟩. Under the discovery registry (§9) there is NO registry row to permit; the SIF plugin file lives under `forges/sif/bridges/` and the recipe entry under the recipe — both outside the diffed paths. The two commit ids are recorded as data in the gate's acceptance file when B3 and B4 clear. (If the supervisor reverses D2 to an explicit list module, the ruling's "except one added registry row with zero deletions" clause applies to that ONE file — Appendix A.) | in a scratch worktree add one comment line to `lib/bridge-framework/classification.js` between the two commits → numstat non-empty → red |
| **BG-COMPOSE (b) — the fingerprint in the artifact** | `frameworkFingerprint` in the SIF decision block's header EQUALS the one in the accepted Ed-Fi block. Works on the artifacts alone, survives history rewrites. | change one byte of one framework file, re-freeze the toy → fingerprint differs → red (the same twin proves the fingerprint is not a constant) |
| **BG-COMPOSE (c) — no per-standard branch** | BG-NOSUB's token grep (`edfi|EdFi|sif|SIF|pesc|ceds` absent from `lib/bridge-framework/**` and the seam face) PLUS a behavioural conjunct: the toy plugin, Ed-Fi's and SIF's all run through `bridgeMaker.run` under a Proxy on the framework's internal dispatch that records every module-level branch keyed on a declaration VALUE (`matchBasis`, `standardKey`, `predicateSource.kind`) — the set of branch sites is IDENTICAL across the three runs and every site is a TABLE lookup | add `if (declaration.standardKey === 'sif')` → grep red; a `switch (matchBasis)` → the branch-site census differs from the table-lookup list → red |

Plus SIF's own BG-CENSUS against its frozen census, and BG-MODES over both plugins. A SIF that needs a
framework edit is a red gate that STOPS B4 and goes to the supervisor with the diff.

---

## 13. The gate suite — every gate with the RED TWIN that turns THAT conjunct red ⟨RISK §2⟩

Conventions, inherited whole from the forge framework's suite ⟨FF §10⟩ (`twinRegistry.js` +
`gateEvaluator.js` REUSED unchanged): every gate ASSERTS; UNPROVEN and UNMEASURED are failures; no
standing `expectFail`; a gate that asserts EXISTENCE where the rule states an EQUALITY is
under-enforcement; every twin faults PRODUCTION input or configuration (`leverKind: productionMutation |
inputFault`), never the gate's expectation (`expectationLever` recorded, does not count); every twin
registered as DATA keyed `gateId + conjunctId` (with `aliasList` carrying the Profile §7 number and the
BR gate id ⟨RISK D-11, adopted⟩); the sweep counts observed-red PER CONJUNCT; the registry is audited for
missing/orphaned twins; the sweep has its own twin (BG-SWEEP). Every gate observed RED before it was made
to pass, three-state, the red observation recorded per conjunct in the B2/B3/B4 DEVLOG.

The suite runs hermetically over `lib/bridge-framework/test/fixtures/toyBridge/`: a tiny toy standard
(forged nodes), a tiny HUB DOUBLE (a dozen cards with real tuple fields, two contended keys, one
qualified card whose `qualifierKeys` arrives as a SCALAR string, one card with no vector), a tiny
crosswalk CSV (~12 rows covering one/many/zero/multi-id/tentative/value-tier/no-URI/remodel/collision
shapes) with `SHA256SUMS`, a `forges`-like dir with TWO toy plugins (`toyCrosswalkPlugin.js`,
`toyStandardPlugin.js` — so the composability gate and the conflict detector both have hermetic
subjects), the graph DOUBLE (`graphDouble.js`, mirrors `roundTripHarness.graphDoubleFrom`), the debug
judge, scratch store/cache/forensics paths. No container, no LLM, no licensed bytes ⟨BR-112⟩. Gates marked
BUILD need a container and are the B3/B4 proofs.

### 13.1 Profile §7 — the seven, one row per conjunct

| id | conjunct (EQUALITY unless said) | RED TWIN | leverKind |
|---|---|---|---|
| **BG-P1** (Profile 7.1, BR-100) no single-valued index | (a) every resolver index over `canonicalKey` is a multimap: `get` returns a LIST for every key and the sum of list lengths EQUALS the card count; (b) `indexCollisionCount === contentionCensus.contendedKeyCount`; (c) a bare-assignment path is unreachable: the index type refuses `set` on an existing key | (a) a resolver double that assigns `indexByKey[key] = card` → 2 cards under a contended key index 1 → sum ≠ count; (b) a double that skips one collision → counts differ; (c) `set` twice → not refused | productionMutation |
| **BG-P2** (7.2, BR-101) tuple addressing | (a) every `objectStableId` in the frozen block is a card `stableId` present in the graph; (b) `count(distinct objectStableId) === count(distinct resolved tuple)`; (c) the materialiser refuses by name a record whose `objectStableId` is absent (never re-derives) | (a) a freezer double writing `canonicalKey` as `objectStableId`; (b) two records naming one card by two tuples (qualifier dropped); (c) delete one card from the double after freezing → refuses naming it | productionMutation / inputFault |
| **BG-P3** (7.3, BR-102) cardinality | (a) many → `judged`; (b) zero → ORPHAN record with `reason`; (c) zero emits NO edge; (d) zero and many are never one bucket: the sum invariant of §5.8 holds and each is COUNTED SEPARATELY against the frozen fixture census | (a) a resolver double returning the first card on many → `specified`; (b) a key naming no card → no orphan record; (c) a materialiser writing a "best guess" on zero; (d) collapse zero into judged → the frozen census differs | productionMutation / inputFault |
| **BG-P4** (7.4, BR-103) justification | (a) no `judged` record carries `ManualMappingCuration`; (b) `UnspecifiedMatching` appears NOWHERE (block, edges, TSV); (c) every justification ∈ the three; (d) `specified` ⇒ `ManualMappingCuration`, `judged` ⇒ `CompositeMatching`, resolved conflict ⇒ `MappingReview` — a TABLE walk | (a) force a judged record to `ManualMappingCuration`; (b) stamp `UnspecifiedMatching` on one mapping; (c) `LexicalMatching` → refused; (d) swap two rows of the derivation table | productionMutation |
| **BG-P5** (7.5, BR-104) confidence | (a) PRESENT on every judged record; (b) ABSENT (key not present — not `null`, not `1.0`) on every specified record and edge; (c) EQUALS the band table's discrete value, never a computed float | (a) drop it from a judged record; (b) `confidence: 1.0` on a specified record; `confidence: null` (the existence trap `!= null`); (c) a judge double returning `0.7314` → refused | productionMutation |
| **BG-P6** (7.6, BR-105) predicate authority | (a) a `judged` mapping carries the SOURCE's predicate (row, table, or channel assertion); (b) NO `predicate` key survives from the judge's return into the record — the framework's judge component reads only `choice`/`category`/`rationale` and a stray `predicate` key on a return is discarded and COUNTED ⟨RULING BF1⟩; (c) `predicateAssertedBy` ∈ {`source`, `labelTable`, `channelAssertion`} on every record | (a) a judge double returning an extra `predicate: 'relatedMatch'` + a freezer double that lands it; (b) same, discard count 0; (c) drop `predicateAssertedBy` → refused | productionMutation |
| **BG-P7** (7.7, BR-106) SSSOM validity | (a) the TSV parses (a real SSSOM/TSV parser — sssom-py in a venv, ONE-MACHINE-ONLY and labelled so — else the framework's own header/row/`curie_map` validator, labelled PROXY); (b) every non-built-in prefix in `curie_map`; (c) `object_match_field` is the Profile §4.5 tuple string on every row/set; (d) `subject_match_field` names the DOCUMENT prefix for `crosswalk`, the standard's for `standard`; (e) `mapping_date` present ONLY if a declared source column supplied it; (f) `mapping_provider` recorded as verified; (g) `author_id`/`creator_id` emitted at set level whenever the declaration carries them (BR-058 SHOULD, made checkable) ⟨RULING BF17⟩ | (a) delete a mandatory column; (b) drop `EDUcoreCeds:`; (c) emit `EDUcoreCeds:canonicalKey` alone; (d) an Ed-Fi row declaring `edfi:cedsId`, or a SIF row declaring `sif:CEDS ID`; (e) an exporter double stamping today; (f) `verifiedBy: null` → export refuses; (g) a declared `author_id` dropped by the exporter | productionMutation |

### 13.2 The requirements' gates and the ones this specification adds

| id | conjunct — what it asserts | RED TWIN | leverKind |
|---|---|---|---|
| **BG-DECL** (BR-004, BR-009..015) | one twin PER required key of §4.1; unknown key → refused; each closed value outside its list → refused (`matchBasis: 'derived'`, `producerKind: 'inferred'`, `predicateSource.kind: 'judge'`/`'none'`); `producerKind`/`matchBasis` disagreement → refused; a table value outside `SKOS_PREDICATES` or an OWL predicate → refused; a `value` channel not `refuseByNameAndCount` → refused; an unclassified header column / a declared column absent from the header → refused naming it; a transform outside the registry → refused; non-empty `compatibilityDeclarationList` → refused | (each) drop / add / alter → the refusal names it | inputFault |
| **BG-HOOK** (BR-010, BR-016, BR-022) | required `walkSourceAssertions` and `subjectStableIdFor`, arity 2, callback-shaped; optional hooks only when declared true; unknown hook name → refused; wrong arity → refused; a walk assertion carrying `resolution`/`confidence`/`matchBasis`/`mappingJustification`/`objectStableId`/a card `stableId` → refused by name; a walk yielding two assertions with equal subject key and unequal identity → refused (path-blind key, BR-136); `subjectStableIdFor` returning a stableId outside the declared subject nodes → `sourceGap` counted, no edge | drop a hook; arity 1; add `judge`; yield `objectStableId`; drop column 2 of the identity; return a card's stableId | inputFault |
| **BG-REG** (BR-003) | (a) `spec.bridge` resolves through the ONE discovery-built frozen registry; (b) an unregistered name → refused LISTING registered names; (c) two files declaring one `bridgeName` → refused at construction naming both; (d) a stray non-conforming file under `bridges/` → refused at construction; (e) `standardKey` ≠ directory or ≠ `spec.source` → refused; (f) `run` returns every `RUN_REPORT_RESULT_KEYS` INCLUDING `blocks` of length ONE whose `applyLabel` is the pair-scoped label, and `COMPONENT_SHAPES.bridgeMaker.run.resultKeys` EQUALS it (BR-140); (g) two toy plugins on one pairing produce two DISTINCT `applyLabel`s and each harvest returns only its own edges ⟨RULING BF2⟩ | (a) a double resolving by ad-hoc path → registry bypassed; (b) `sifCedsStandardPluginX`; (c) duplicate; (d) a file exporting `{}`; (e) mismatch; (f) drop `producer` → `test-interfaces` red; a bare `BridgedRelation` label → red; (g) a writer double stamping the bare family label → the second harvest counts the first plugin's edges → red | inputFault / productionMutation |
| **BG-PRODUCER** ⟨RULING A1⟩ | (a) `runReport.producer === 'authored'` on EVERY run — materialise with and without a block, re-judge — never absent; (b) `vocabulary.relationshipSubject(...)` composed by `build.js` ends in `_exact` for a crosswalk plugin's block that carries a NON-NULL `decisionBlock`; (c) `producerKind` in the frozen header EQUALS `runReport.producer`; (d) every entry of `PRODUCER_KIND_LIST` has a NON-EMPTY string suffix in `vocabulary.RELATIONSHIP_PRODUCER_SUFFIX` — asserted at framework construction, because `[code fact]` `build.js:1741` guards on the suffix's TRUTHINESS, so an `''` suffix would silently fall through to the `decisionBlock`-inference branch ⟨RULING BF18⟩ ⟨REVIEW A1⟩ | (a) a seam-face double omitting `producer` → `build.js` infers `_close` from the non-null block → red; (b) same, asserted on the composed subject; (c) header `inferred`; (d) a vocabulary registry double with `authored: ''` → not refused → red | productionMutation |
| **BG-DET** | (a) static: `Date.now|new Date|Math.random|process.hrtime|crypto.randomBytes` absent from `lib/bridge-framework/**`, `bridgeMaker.js`, `bridge-maker/lib/*.js`, every `forges/*/bridges/*.js`; (b) two freezes with a concurrency double completing in reverse → byte-identical; (c) two freezes with the walk yielding in reverse → byte-identical; (d) the canonical serialiser sorts keys and refuses `undefined`/`NaN`/`Infinity` | (a) `Date.now()` in a fixture plugin; (b) a freezer appending in completion order; (c) keeping walk order; (d) `confidence: NaN` not refused | productionMutation / inputFault |
| **BG-POOL-ORDER** ⟨RULING R2⟩ | (a) the post-filter pool handed to the renderer is sorted by `stableId`; (b) a reader double returning cards in REVERSE order leaves `promptHash`, the debug pick's `stableId` (rule `digest`), and the block id UNCHANGED; (c) the forensic record carries the pool's `stableId` LIST in rendered order beside the ordinal | (a) skip the sort → (b) `promptHash` differs; (c) drop the list | productionMutation |
| **BG-QUALIFIER-WIDEN** ⟨RULING P8⟩ | (a) a card whose `qualifierKeys` arrives as a SCALAR string is re-widened at the read boundary to a one-element list; (b) the remodel table's qualified target (`P001572` + qualifier) MATCHES that card and the row is `specified/remodel`; (c) `[]` and a multi-element list pass through unchanged | (a) a reader double that skips widening → the string ≠ the list → (b) orphan `remodelTargetAbsent` → red; (c) a widener that wraps a list again | productionMutation |
| **BG-GEN** (BR-071) | the frozen text contains EACH of: `frameworkGeneration`, `frameworkFingerprint`, `rendererVersion`, `bridgeName`, `pluginVersion`, `declarationDigest`, `labelTableDigest`, `remodelTableDigest`, `judgeKind`, `sourceWindow`, `hubVersion`, `sourceVersion`, `sourceChannelDigestByKey`, `cardinalityCensus`, `contentionCensus` — one conjunct each; a debug or windowed block's mark appears on EVERY edge it produces (`materialise` reads it back) | (each) strip the member → refused at freeze; a windowed block replayed under a materialiser omitting the mark → an unmarked edge | productionMutation |
| **BG-REPLAY** (BR-070, BR-110) | (a) plain build after re-judge: ZERO judge calls (spy throws) and ZERO embedder calls (spy throws); (b) `R₂ === R₁`; (c) `A′ === A` under `digest`; under the real-judge double with a warm cache `A′ === A` and `liveJudgmentCount 0`; (d) a pick whose `objectStableId` is absent → materialise REFUSES naming it; a subject absent → `sourceGap`, no edge, run says so; (e) a pairing with NO block → `edgesWritten 0`, `decisionBlock: null`, `producer` still `'authored'`, the run output SAYS SO; (f) a block whose `sourceChannelDigestByKey`/`hubVersion`/`sourceVersion`/`declarationDigest` differ from the run's → refused "re-judge required" | (a) a materialiser calling the judge → spy throws; (b) a run counter stamped into an edge → ids differ; (c) `cacheHitCount` leaked into the hashed text → `A′ ≠ A`; (d) delete a card; (e) silent zero; (f) alter one CSV byte in a scratch copy after freezing | productionMutation / inputFault |
| **BG-CACHE** (BR-069, BR-120) | (a) an identical rendered question is served from the cache (spy count 1 across two judgings); (b) a hit whose `chosenStableId` is not in the CURRENT pool is REFUSED; (c) a DEBUG run leaves the row count UNCHANGED and writes NO row whose `model` contains `INVALID_DEBUG`; (d) `putJudgment` failure is FATAL; (e) the report carries `liveJudgmentCount`, `cacheHitCount`, `usdSpent`, and the budget guard HALTS by name | (a) a cache that never stores → 2; (b) serve a stale pick; (c) a debug double that writes; (d) swallow the put error; (e) a client that trims the pool under budget | productionMutation |
| **BG-CENSUS** ⟨RULING P12, BF4, BF17⟩ | (a) the frozen block's census (both tables) EQUALS `expectedCensus.<plugin>.<graphId>.json` — every member EQUAL, no band; (b) the sanity row (FINDING literals) is reproduced within the ENUMERATED mover list, each mover named with its count (§10.4); (c) the per-SUBJECT sum invariant of §5.8 (ii); (d) contention RECOMPUTED per run and reported; (e) every subject is in EXACTLY ONE per-subject bucket under the precedence rule (a subject with a specified target and a judged target counts `specified` once); (f) `sourceSideMismatchCount ≤ judgedCount` in the per-target table and every mismatch record carries `resolution: 'judged'` (the sub-count reconciles); (g) `labelRefusedCount` EQUALS the count of rows under `refused`-disposition labels | (a) drop one fixture crosswalk row → census differs (the trap: "no crash"); (b) flip one fixture row's label `Yes`→`Maybe` (a PRODUCTION-INPUT fault) → the sanity row's named mover count changes by one → red; (c) count a `subjectCollision` subject also as an orphan; (d) a report double printing `260 / 13` from a constant → recompute differs on the fixture; (e) a census double counting the mixed subject twice; (f) a mismatch record stamped `specified`; (g) a `refused` row silently dropped | inputFault / productionMutation |
| **BG-TENTATIVE** ⟨RULING P3⟩ | (a) a subject whose labels for a target are ALL tentative is `judged` even when the filtered pool has ONE card; (b) the record carries `sourceLabel` raw and `predicateAssertedBy: labelTable`; (c) an abstention on a tentative subject emits nothing and is counted `abstained`; (d) a mixed `Yes`+`Maybe` subject → judged over the UNION | (a) a classifier double that specifies a lone-`Maybe` row → census red; (b) drop `sourceLabel`; (c) an abstain that yields an edge; (d) a double reading the mix as N specified | productionMutation |
| **BG-LABEL-RUN** (BR-046) ⟨RULING P4, BF5⟩ | (a) a label in the predicate column with no table row on a NON-sentinel row → the RUN is refused BEFORE resolution, the refusal naming the label, its count and three subjects; (b) a blank label on a non-sentinel row counts as unmapped; (c) a `refused`-disposition row refuses those rows by name and COUNTS them without refusing the run; (d) the label census is SCOPED to non-sentinel rows: a `sentinelOnly` label on a sentinel row is lawful and NOT counted as unmapped; (e) a `sentinelOnly` label on a REAL-target row refuses the run by name; (f) a sentinel row carrying a non-`sentinelOnly` label is counted `sentinelLabelledRowCount` and never judged | (a) inject `Perhaps` into one fixture row → not refused → red; (b) blank not counted; (c) a `refused` row silently dropped; (d) a census double scanning sentinel rows → the fixture's `Not in CEDS` row refuses the run → red; (e) move `Not in CEDS` onto a real-target fixture row → not refused → red; (f) a fixture sentinel row with `Maybe` judged → red | inputFault |
| **BG-SUBJECT** (BR-136, BR-138) ⟨RULING P2⟩ | (a) `subjectStableIdFor` is called ONCE with the DISTINCT subject list; (b) many-to-one is REPORTED per subject with `assertingSubjectList` on the record; (c) a merged `subjectStableId` with DIFFERENT target sets is refused by name as `subjectCollision`, all targets named, no edge, counted; (d) same-target merged subjects yield ONE edge per (leaf, target) | (a) a framework double calling per subject → call count ≠ 1; (b) drop the list; (c) a merger that emits the first target's edge; (d) two edges for one (leaf, target) | productionMutation |
| **BG-THREE** (BR-040) | (a) `matchBasis` ∈ {standard, crosswalk}; (b) `resolution` ∈ {specified, judged}; (c) `predicate` ∈ SKOS and EQUAL to the edge TYPE's relation; (d) `matchBasis` CONSISTENT with `mappingProvider`/`mappingTool` per Profile §4.3 (a table walk in the FORWARD direction: `standard`/`crosswalk` ⇒ provider present, tool absent unless judged; never "derivable" — the two share the slot shape, Profile v1.0.5 §3.1 ⟨RULING BF16⟩ ⟨REVIEW E1⟩); (e) `decisionBlockHash` on EVERY edge and EQUAL to the block's id; (f) `provenanceTier` absent from every mapping edge (or `invalid-debug` on a debug block only) | (each) strip in a writer double; (c) `closeMatch` on an `EXACT_MATCH` edge; (d) `crosswalk` with no provider; (e) drop the hash on one edge; (f) `spec-authoritative` stamped | productionMutation |
| **BG-EDGE-UNIQUE** | (a) `edgeCount === distinctTripleCount`; (b) no (`subject`, `object`) pair carries two predicates; (c) two attestation channels for one target yield ONE edge with `attestationChannelList` of length 2 | (a) emit the 88-repeated-row shape without dedupe; (b) a subject → one card with `Yes` and `Partial` rows kept as two edges; (c) two edges | inputFault / productionMutation |
| **BG-CONFLICT** (BR-063, BR-108) ⟨RULING A11⟩ | (a) two toy plugins on one pairing naming different targets for one subject → the SECOND plugin's materialisation of that subject REFUSED by name (its block recorded, that edge NOT written), the FIRST plugin's edge STANDS, a CONFLICT record naming BOTH in the report and a `MappingReview` queue row, `conflictCount` in the report and ABSENT from both frozen censuses ⟨RULING BF8⟩; (b) the C4 lossy-echo shape (one row, several ids) → `judged`, NOT conflict; (c) BR-064(b) all-`Yes` combination → N specified, NOT conflict; (d) a resolved conflict (fixture human-review record) → `MappingReview`; (e) the report line names the detector as fixture-exercised when one plugin runs | (a) a seam-face double writing the second plugin's edge anyway; a freezer double writing `conflictCount` into the frozen text; (b) raising conflict for one source; (c) reading the combination as alternatives; (d) `ManualMappingCuration` on the resolved one; (e) a report claiming "0 conflicts" without the qualifier | productionMutation / inputFault |
| **BG-BLIND** (BR-090/091, BR-109) ⟨RULING A6⟩ | (a) `blindingDeclaration` required at registration — ABSENT refused BEFORE any forge; `[]` accepted; (b) echoed BY NAME in the run output; (c) enforced at the consumer boundary of the ONE reader: `forEvidence()` records carry none of the declared names, and a plugin requiring a second reader → BG-CONTAIN; (d) the rendered prompt for a judged subject contains NONE of the blinded values; (e) candidate cards' own keys are NOT blinded; (f) `forWalk()` exposes ONLY the channel's `channelPropertyList` unblinded — a walk reading a blinded property outside that list is REFUSED by name, and an EVIDENCE hook (`walkEvidence` over `forEvidence()`) cannot read `cedsId` at all ⟨RULING BF7⟩ | (a) drop the list; (b) silence the echo; (c)/(d) a hook reading `node.properties.cedsId` through a second reader → the fixture anchor appears in the prompt; (e) a blinder stripping the card's `canonicalKey`; (f) a fixture walk reading `cedsOptionCode` (undeclared) → not refused → red; a fixture evidence hook reading `cedsId` → the anchor appears in the prompt → red | inputFault / productionMutation |
| **BG-CONTAIN** (BR-018..021, BR-111) | static, one conjunct per token: no `require` of `neo4j-driver`, `lib/replay/**`, `lib/decision-store`, `lib/judgment-cache`, `lib/match-forensics`, `apps/bridge-maker/lib/llmClient`, `debugJudge`, `@anthropic-ai/*`, `lib/embedding/**`, `lib/vector-store/**` in any plugin file; no `addressSignature`, `HubReference`, `MERGE`, `CREATE`, `session.run` in plugin source; dynamic: the argument object handed to a hook is a CLOSED shape (`sourceChannelPathByKey`, `sourceReader`, `xLog` / `subjectIdentityList`, `sourceReader`, `xLog`) — a Proxy throws on any other read; `sourceReader`'s member set is closed (`forWalk`, `forEvidence`, each yielding `readSourceNodes`, `readNodesByStableId`, `readEdgesAmongSource` and nothing else); a hook that opens a session (a reader double counting sessions opened from plugin frames) → refused | (each) add the require / read `deps.judge` / call `sourceReader.readHubCards` → the Proxy throws | inputFault |
| **BG-INPUT** ⟨RULING BF6⟩ | (a) every `document` channel verified against `SHA256SUMS` before a byte is read (`verifySnapshotChecksums` IGNORES on-disk files absent from the manifest — deliberate; a stray file is not a fault ⟨REVIEW F6⟩); (b) a classified column ABSENT from the header, or a header column UNCLASSIFIED in its channel, → refused by name at load; (b′) a duplicated header name is refused unless `headerOverrideByIndex` resolves it, and the override is applied BEFORE coverage; (c) an empty cell in a tuple-field column → the field is ABSENT (not `''`, not defaulted); (d) sentinel rows COUNTED `sentinelDropped`, never orphans; (e) reconciliation at zero per channel: `rowsRead === assertionsYielded + sentinelDropped + malformedRows + valueTierRows`, every term in the report; (f) a declared `encoding` the bytes fail to decode → refused | (a) flip one byte in a scratch copy; (b) rename `CEDSOntologyClassURI` in the fixture header; (c) a plugin writing `domainId: ''`; (d) drop the sentinel list → 487 orphans → census red; (e) a walk skipping a malformed row silently; (f) declare `utf-8` on the latin-1 fixture | inputFault / productionMutation |
| **BG-VALUE** (BR-080, BR-134) | (a) a value-tier assertion (a `value` channel row, a `valueKey`-bearing assertion, a `referenceTier: value` card) is REFUSED by name; (b) COUNTED with raw form (`refusedValueTierAssertionCount` 5,970 for Ed-Fi at B3); (c) NO edge to a value-tier card exists | (a) a resolver double admitting value cards to the pool; (b) count 0 with descriptor rows present; (c) an edge to a value card | productionMutation |
| **BG-REMODEL** (BR-015, BR-035, BR-036) ⟨RULING P11⟩ | (a) the hub-owned table is applied BEFORE direct resolution; (b) an entry resolves to a specific TUPLE, never a bare base property; (c) a target absent → orphan `remodelTargetAbsent`; (d) both toy plugins REFERENCE the one table (no copy in either plugin); (e) the class-side table, if declared, turns the fixture's mismatch row into `specified` and is a NAMED mover in BG-CENSUS (b) | (a) apply after; (b) resolve `P001070` to bare `P001572`; (c) silently promote; (d) a plugin carrying its own copy → refused; (e) undeclared mover | productionMutation |
| **BG-MISMATCH** (BR-061/062) | a supplied tuple field matching NO card under a NON-empty key pool → `sourceSideMismatch` recorded with the field and survivors named; disposition `judged` over the key pool; NOT promoted to specified on the key alone | a resolver dropping the domain filter and reporting specified; a record without the marker | productionMutation |
| **BG-EMPTY** (BR-094) | empty assertion set → refused by name; a hub double with zero cards → refused; never an empty block frozen green | a zero-row crosswalk → block frozen with census 0 → red; no cards | inputFault |
| **BG-JUDGE** (BR-065..068) ⟨RULING BF1⟩ | (a) the judge component maps the client's ORDINAL `choice` to `chosenCardStableId` through `renderedPoolStableIdList` and REFUSES by name a `choice` outside `choiceEnum` (out of range, non-numeric, not `'NONE'`) or a cache hit whose `chosenStableId` is not in the rendered list; the record carries `renderedPoolStableIdList` and the ordinal beside the stableId; (a′) `putJudgment` receives exactly `{ choice, category, rationale, chosenStableId }`; (b) abstention → NO edge, record `abstained`, counted separately from orphan; (c) a pick without category or rationale → refused; (d) the rendered prompt contains the fixture source element's name (the judge is told what it matches FROM); (e) per-candidate material rides with its candidate; (f) global guidance names no pool candidate; (g) rationale names the choice by hub key + name, never by ordinal | (a) a judge double returning `choice: '9'` against a pool of 3 → not refused → red; a double returning `choice: '2'` with a mapper double that reads the UNSORTED read-order list → the picked stableId differs from the rendered one → red; (a′) a payload lacking `chosenStableId` → `putJudgment` refuses → the run must stop; (b) an abstain that yields an orphan; (c) `category: undefined`; (d) a renderer omitting the source block; (f) guidance containing a pool key; (g) `"picked candidate 2"` | productionMutation |
| **BG-DEBUG** ⟨RULING R5⟩ | (a) with `--useDebugJudge`, the block's `generation` ends in `-INVALID_DEBUG` and `judgeKind` is `debug:<rule>`; (b) EVERY edge of a debug block carries `provenanceTier: invalid-debug` (specified included) and every judged edge `mappingTool` = the debug model id — including on a PLAIN build that replays it; (c) `-goldEvalCheck`'s bridge sibling REFUSES a run whose relationship block contains an `invalid-debug` edge, naming the block; (d) `--useDebugJudge` without `--rebridge` scope refused; two judges refused (`build.js:807-823`) — RE-OBSERVED red in THIS suite's own twin, not borrowed from `test-useDebugJudge.js` ⟨RULING BF17⟩ ⟨REVIEW E5⟩; (e) forensic record `usage: null`, `decisionAlgorithm: INVALID_DEBUG`; (f) the suite's default rule is `digest` and `abstain` runs once | (a) drop the suffix; (b) skip `debugMarkFromGeneration`; (c) a check double passing it; (d) `--useDebugJudge=digest` with no `--rebridge` in the suite's own build double → not refused → red; (e) usage `0`; (f) suite config `first` | productionMutation |
| **BG-CONSERV** conservativity | (a) every mapping edge's object is a `HubReference` and its subject's `_source` EQUALS the pairing's source — any other pair refused at the write seam; (b) no edge type outside `SKOS_EDGE_TYPES`; (c) no mapping edge carries `provenanceTier: structural`; (d) NO NON-MAPPING EDGE under the pair-scoped label — the harvested block carries endpoint NODES by construction ⟨RULING BF3⟩, so the conjunct is on EDGES: every edge harvested under the label has a type in `SKOS_EDGE_TYPES`; (e) `structural-contract` over the depGraph AFTER materialise reports the same `depth`/`parentId` for every source node as before | (a) card→card; (b) `SPECIFIED_MAPPING`; (c) `structural`; (d) a writer also writing `HAS_PROPERTY` under `applyLabel`; (e) a writer stamping `parentId` on a card | productionMutation |
| **BG-PAIRKEY** ⟨RULING R3⟩ | `pairKey` EQUALS `<hub>@<hubVersion>::<source>@<sourceVersion>::<bridgeName>::<producerKind>`; a key lacking any component → refused; two toy plugins on one pairing → two DISTINCT keys | drop the version; drop `producerKind` → the two toy plugins collide → red | inputFault |
| **BG-MODES** (BR-107) | every REGISTERED plugin runs in BOTH modes over its fixture — materialise (with and without a block) and re-judge (debug); a dead `require` in any plugin → red | remove one plugin file → the smoke count differs; break a `require` | productionMutation |
| **BG-HYGIENE** (BR-112) | every suite writes under a scratch root; the canonical `dataStores/judgmentCache`, decision-store, matchForensics, buildLogs are byte-UNCHANGED across a suite run (mtime + hash before/after); fixtures are committed and their hashes asserted (never a regenerated artifact); no gate depends on licensed bytes; a one-machine gate says so by name | a double writing to the canonical cache path; a fixture that is a copy of a `buildLogs` file | productionMutation |
| **BG-NOSUB** (Be-smart 7, polyArch2) | lexical: the f-word (any form) absent from `lib/bridge-framework/**`, `bridgeMaker.js`, `bridge-maker/lib/*.js`, every plugin (comments included); the stub-logger idioms absent; per-standard tokens (`edfi|EdFi|sif|SIF|pesc|ceds`) absent from `lib/bridge-framework/**` and the seam face; behavioural: `xLog` absent → refused; `decisionStore`/`judgmentCache`/`matchForensics` absent on `rebridge: true` → refused; `inferenceConfig.llmClient` absent at the first judged subject → refused; unknown `producerKind` → refused; a `spec.config` key outside `RUN_CONFIG_KEY_LIST` (the `...bridge.params` channel) → refused by name ⟨RULING BF11⟩; a `\|\|` identity chain over a declaration value → lexical red | (each); add `if (standardKey === 'edfi')` to a framework file; a fixture recipe with `params: { blindingDeclaration: [] }` → not refused → red | inputFault |
| **BG-SEAM-UNTOUCHED** (PLAN hard lines) ⟨RULING A8, P10, BF9, BF10, BF12⟩ | `git diff --stat preBridgeFramework-081626 --` (the base tag, CUT AT THE START OF B2 — after the reset, so the diff never shows the reset itself ⟨RULING BF9⟩ ⟨REVIEW E6⟩) `-- apps/graph-builder/lib/build.js apps/graph-builder/interfaces.js apps/graph-builder/apps/forger/ lib/replay/ apps/graph-builder/apps/replay-manager/ forges/*/forge*.js forges/*/lib/*Declaration.js forges/*/lib/*Hooks.js lib/forge-framework/` is EMPTY save the NAMED exceptions, each its own conjunct: (i) the ONE `interfaces.js` commit touching EXACTLY the two declaration blocks — `COMPONENT_SHAPES.bridgeMaker.run.resultKeys` (`null` today, `[code fact]` `:400`) and the `BRIDGE_MODULE_SHAPE`/`@interface BridgeModule` block, which becomes a one-line pointer to `lib/bridge-framework/bridgePluginContract.js` ⟨BR-140⟩ — the call contract (arity/argKeys) byte-identical; the SAME commit re-points the two live probes at `test-interfaces.js:315-343` (`observed.result === undefined`; `resultKeys === null`) and migrates the stub's exports `bridgeModuleShapeViolation` and `NO_BRIDGE_IMPLEMENTATION_REGISTERED` with their consumers ⟨RULING BF10⟩ ⟨REVIEW A9⟩ — `test/` files are not on the diffed path list, so only the `interfaces.js` block conjunct is asserted here; (ii) the ONE `lib/vocabulary/` commit (`MAPPING_PROPERTIES` rows, `PROVENANCE_TIER` retirement) — B2, BEFORE either plugin ⟨RULING A7, R7⟩. Former exception (iii), the `contractTableWalk.js` lift, is STRUCK ⟨RULING BF12⟩. Any OTHER line → red | touch a comment in `build.js` in a scratch worktree; alter `argKeys` in `interfaces.js` | productionMutation |
| **BG-SWEEP** | DEFECTIVE for a conjunct whose registered twin does not redden it; UNPROVEN for a conjunct with no counting twin; the registry audit reports missing/orphaned twins; an `expectationLever`-only conjunct is UNPROVEN | register a no-op twin; delete one twin; register only an expectation lever | productionMutation |
| **BG-HARVEST** ⟨RULING BF3, BF17⟩ ⟨REVIEW A10⟩ | (a) after `build.js` harvests, the relationship block's EDGE COUNT (edges of type ∈ `SKOS_EDGE_TYPES` between two nodes carrying the pair-scoped label) EQUALS `runReport.edgesWritten` — the silent empty-harvest failure `build.js:1656-1661` records is thereby a red gate; (b) the harvested block is NON-EMPTY when `edgesWritten > 0`; (c) every edge in the harvested block carries a one-element-list-wrapped `decisionBlockHash` whose element EQUALS the decision block id (the ONE place the list-wrapping is acknowledged, read from the block, not the graph) | (a) a writer double that labels only ONE endpoint → harvest returns fewer edges (or zero) → count ≠ edgesWritten → red; (b) same, zero; (c) a materialiser stamping a stale hash | productionMutation |
| **BG-ACCEPT** (BUILD; B3/B4) | the frozen command run twice: (a) decision block id EQUALS `expectedDecisionBlockIds.json` per plugin; (b) relationship block id EQUALS its committed value; (c) BG-CENSUS (a) EQUAL; (d) `-goldEvalCheck` PASS on the run dir; (e) the SSSOM TSV validates; (f) BG-COMPOSE a ∧ b ∧ c for SIF | (a) change one label-table row → both ids differ and the report names the predicate line; (d) inject an invented statement in a scratch copy → refuses | productionMutation |

---

## 14. Layering, tests, doctrine, reuse ⟨FF §12⟩ ⟨ARCH §6⟩

### 14.1 Where it lives ⟨RULING A2, A9⟩

FLAT under `lib/`, discovered by `test/runAllTests.js`'s "directory containing a `.js` file" rule (as
`lib/forge-framework/` is); the seam face stays under `apps/graph-builder/apps/bridge-maker/`.

```
apps/graph-builder/apps/bridge-maker/
  bridgeMaker.js                 THE SEAM FACE: bridgeMaker() → { run }; builds the discovery registry over forges/*/bridges/*.js;
                                 constructs lib/bridge-framework with the real reader/writer factories; run → framework.run;
                                 the cross-block CONFLICT detector (§5.5)
  lib/llmClient.js               KEPT (real judge; unchanged in v1 — no predicate slot until derived returns)
  lib/debugJudge.js              KEPT as-is (debug double; DEBUG_MARK helpers reused)
  lib/sourceWindow.js            KEPT (window; reused)
  lib/evidenceContracts.js       KEPT (A2/A3 smuggling + package gates; reused by the renderer)
  test/                          seam-face suite: test-interfaces probes + BG-MODES + BG-CONFLICT (two toy plugins)

lib/bridge-framework/            (flat; its own test/; package.json version never in the block)
  bridge-framework.js            the factory + run (§5): refusals → read → walk → group/subject/remodel → filter/classify → judge → freeze → save → materialise → export → report
  bridgePluginContract.js        BRIDGE_DECLARATION_CONTRACT + BRIDGE_HOOK_CONTRACT + the table-walk validators (MIRRORED from forgeDeclarationContract.js, not lifted ⟨RULING BF12⟩) + the forbidden-substrate/name scan (§4) — the RETIRED BRIDGE_MODULE_SHAPE's successor ⟨RULING P10⟩
  bridgeAllowanceRegistry.js     BRIDGE_ALLOWANCE_REGISTRY (EMPTY in v1) + validator
  pluginRegistry.js              buildRegistryFromDirectory({ forgesDirPath }) → frozen entryByBridgeName; lookup refusals (§9)
  transformRegistry.js           the CLOSED tuple-field transform registry (identity, globalIdToPrefixedKey, uriFragment, verbatim) ⟨RULING BF13, BF14⟩
  predicateSource.js             the closed predicateSource kinds + table application (§5.6.0)
  classification.js              CLASSIFICATION_REGISTRY + the Profile §5.1 filter/count/classify (§5.4), PURE over records; pool sort by stableId
  subjectGrouping.js             group-by-subject, subjectStableIdFor orchestration, remodel application, many-to-one census, BR-136/138 refusals — PURE
  judgeComponent.js              judgeOne (§5.6): frame → cache → ask → verify → record; budget halt; debug-mark handling
  evidenceRenderer.js            RENDERER_VERSION + the Profile-shaped prompt (source, sorted pool with seat provenance)
  representationPolicy.js        pool seat policy as DATA ⟨BR-068⟩
  confidenceBandTable.js         category → discrete confidence, DATA
  decisionBlock.js               canonical freeze text, header, blockIdFor, frameworkFingerprint (§7 — NEW file-tree hasher, not fingerprint.js); parse+verify on materialise
  materialiser.js                records → writer calls in sorted order; edge property assembly from MAPPING_PROPERTIES; debug re-flag
  sssomExporter.js               toSssomTsv (§8)
  census.js                      cardinalityCensus (per-target + per-subject tables, precedence rule), contentionCensus (§5.8) — NEW; shares only the naming style with lib/forge-framework/census.js (collisionCensus/complianceReport are not reusable ⟨RULING BF12⟩)
  boundedRunner.js               index-collecting concurrency (§7.3)
  graphReader.js                 ONE bolt-facing READ file: readHubCards (framework only), forWalk() / forEvidence() views over readSourceNodes, readNodesByStableId, readEdgesAmongSource; ONE flatten; blinding at the forEvidence()/judge boundary, forWalk() unblinded for declared channel properties only ⟨RULING BF7⟩; list re-widen at entry
  graphWriter.js                 ONE bolt-facing WRITE file: writeMappingEdge (pair-scoped label on both endpoints, MERGE edge, the §6 refusals, the MAPPING_PROPERTIES CLOSED-SET check — NEW enforcement, no such check exists in the tree ⟨RULING BF12⟩), close
  graphDouble.js                 the Docker-free reader/writer double — reader mirrors roundTripHarness.graphDoubleFrom ({ readAll, close }, reader-only); the WRITER double is NEW construction ⟨RULING BF12⟩
  README.md                      the header prose once; the kitchen paragraph; the MUST NOT list
  test/
    fixtures/toyBridge/          toy standard, toy hub double, toy crosswalk CSV + SHA256SUMS, forges-like dir with TWO toy plugins, the hub-owned toy remodel table
    test-*.js                    one file per gate family; every twin registered through lib/forge-framework/roundTripHarness/twinRegistry.js, swept with gateEvaluator.js
    acceptance/expectedCensus.<plugin>.<graphId>.json      per plugin, measured; keyed by graph id + labelTableDigest
    acceptance/expectedDecisionBlockIds.json                per plugin: decision block id + relationship block id
    acceptance/acceptanceCommands.jsonc                     ONE frozen -build line per plugin (materialise) and one --rebridge line (debug judge)

<hub data home>/ceds14PropertyRemodel.json   the HUB-owned six-entry remodel table keyed hubName@hubVersion, referenced by both plugins ⟨RULING P11⟩ — home under forges/ceds/ (§16 D-S5)
```

`graphReader.js` and `graphWriter.js` are the TWO new bolt-facing files, named in `DOCTRINE.md` in the
B2 commit ⟨RULING A9⟩ — a writer is unavoidable given harvest-by-label.

### 14.2 Doctrine and polyArch2 compliance ⟨DOCTRINE⟩

Callback error-first everywhere; `pipeRunner`/`taskListPlus`; no `async`/`await`; no `try`/`catch` as
control flow (the ONE accepted `try` is a `JSON.parse` of the frozen text converted to an error value);
the neo4j-driver dispensation taken as `.then().catch()`-to-callback at the leaf in the two bolt files
ONLY; registry over switch (`CLASSIFICATION_REGISTRY`, `PREDICATE_SOURCE_KIND_LIST`, the two contracts,
the allowance registry, the transform registry, `SKOS_EDGE_TYPES`, `RELATIONSHIP_PRODUCER_SUFFIX`,
`CONFIDENCE_BAND_TABLE` — no `if (standardKey === 'edfi')` anywhere); no mutation of global state
(`process.global.xLog` read, never written); a declared interface at every polymorphic seam
(`BRIDGE_DECLARATION_CONTRACT`, `BRIDGE_HOOK_CONTRACT`, `RUN_REPORT_RESULT_KEYS`, the reader/writer factory
shapes, `@interface BridgeMakerComponent` re-pointed); compound greppable names — `bridgeName`,
`standardKey`, `subjectStableId`, `objectStableId`, `canonicalKey`, `pairKey` (kept: the store's own
column name), `decisionBlockHash`, `promptHash`, `channelKey` — never the bare word `key` (the multimap is
`cardListByCanonicalKey`); no silent default (`[]`/`{}` are answers, absence is refused, no `a || b`
identity chain); every gate observed red before green, three-state.

### 14.3 Reuse table — reused as-is, not forked ⟨ARCH §6⟩ ⟨PLAN⟩

| module | how the bridge framework uses it |
|---|---|
| `lib/forge-framework/refuse.js` `byName` | every refusal — RETURNS an `Error` (`[code fact]` `refuse.js:18-21`); each module stringifies at its callback boundary, the seam face once more at the seam ⟨RULING BF12⟩ |
| `lib/forge-framework/sourceVerification.js` `verifySnapshotChecksums` | declared `document` channels against the snapshot's `SHA256SUMS` |
| `lib/forge-framework/roundTripHarness/twinRegistry.js`, `gateEvaluator.js` | the whole gate suite's registry + sweep |
| `lib/forge-framework/census.js` — NAMING only | `[code fact]` exports `collisionCensus` and the forge-declaration-coupled `complianceReport`; no cardinality census exists to mirror; `bridge-framework/census.js` is NEW ⟨RULING BF12⟩ ⟨REVIEW F5⟩ |
| `lib/forge-framework/fingerprint.js` — NOT reused | `[code fact]` `pureLayerFingerprint({ nodes, edges })` hashes a graph result; `frameworkFingerprint` is a NEW file-tree hasher ⟨RULING BF12⟩ ⟨REVIEW D4⟩ |
| `lib/forge-framework/forgeDeclarationContract.js` — IDIOM, mirrored | the lift is STRUCK: `[code fact]` its walk closes over a module-level `KIND_CHECKER_REGISTRY` and passes a forge-shaped context to every checker (5 of 9 checkers forge-domain); a byte-neutral lift is not achievable ⟨RULING BF12⟩ ⟨REVIEW F3⟩ |
| `lib/forge-framework/roundTripHarness/graphDoubleFrom` — IDIOM, reader only | `[code fact]` `{ readAll, close }`, no write path; the bridge's writer double is NEW ⟨RULING BF12⟩ ⟨REVIEW F4⟩ |
| `lib/content-address` `blockIdForText` | block address (identical to decision-store's) |
| `lib/decision-store`, `lib/judgment-cache`, `lib/match-forensics` | HANDED IN via `run` args; used through their existing APIs — no new store, no store change |
| `lib/vocabulary` `SKOS_EDGE_TYPES`, `SKOS_PREDICATES`, `isValidSkosPredicate`, `SSSOM_JUSTIFICATIONS(+_BANNED)`, `sssomJustificationRefusal` (exists with the two-refusal shape `[code fact]` `:454-468`), `MAPPING_PROPERTIES` (extended in B2 — `[code fact]` 10 names today, ZERO consumers, no closed-set check anywhere; the check is NEW in `graphWriter.js` ⟨RULING BF12⟩ ⟨REVIEW F7⟩), `RELATIONSHIP_PRODUCER_SUFFIX`, `relationshipSubject`, `UNIQUENESS_KEYS`, `PROVENANCE_TIER.invalid-debug` | every predicate/type/justification/property name |
| `apps/bridge-maker/lib/{llmClient, debugJudge, sourceWindow, evidenceContracts}` | judge client contract, debug mark, window, A2/A3 gates |

### 14.4 The B2 commit order (so the composability diff is honest) ⟨RULING A7, A8, R7, P10⟩

1. `lib/vocabulary/` — `MAPPING_PROPERTIES` gains `matchBasis`, `resolution`, `mappingProvider`,
   `mappingToolVersion`, `subjectMatchField`, `objectMatchField`, `sourceLabel`, `predicateAssertedBy`,
   `attestationChannelList`, `decisionBlockHash`; `PROVENANCE_TIER` retires from mapping edges (the tier
   list stays for structural / `invalid-debug`); `MATCH_ID` internal ⟨BR-143⟩ ⟨C6⟩; with a twin. ONE
   commit, named in BG-SEAM-UNTOUCHED's allowlist.
2. `interfaces.js` — the two declaration blocks ⟨BR-140⟩ ⟨RULING BF10⟩ ⟨REVIEW A9⟩:
   `COMPONENT_SHAPES.bridgeMaker.run.resultKeys` from `null` (`[code fact]` `interfaces.js:400`) to
   `RUN_REPORT_RESULT_KEYS`; `BRIDGE_MODULE_SHAPE` + the `@interface BridgeModule` prose retired to a
   one-line pointer at `lib/bridge-framework/bridgePluginContract.js`; the TWO LIVE probes at
   `test-interfaces.js:315-343` (`observed.result === undefined`; `resultKeys === null`) re-pointed to
   the refusal probe (an unregistered `bridge` name refused by name, listing registered names) plus the
   resultKeys EQUALITY; the stub's exports `bridgeModuleShapeViolation` and
   `NO_BRIDGE_IMPLEMENTATION_REGISTERED` (`[code fact]` `bridgeMaker.js:51,73`) migrated with their
   `test-interfaces` consumers. Budgeted as ONE commit; BG-SEAM-UNTOUCHED (i) is its conjunct.
3. `lib/bridge-framework/` + the new `bridgeMaker.js` + the toy fixture + the gate suite; `DOCTRINE.md`
   names the two bolt files; every gate observed red per conjunct.
4. Recipe schema: `cacheMode`/`pinBlockId` REMOVED ⟨BR-073⟩ (the WHOLE answer — the framework does not
   refuse them, `build.js` never passes them ⟨RULING BF11⟩); `help.js` audited ⟨BR-141⟩; the two
   superseded docs rewritten as history ⟨BR-142⟩; the spec registered under
   `apps/graph-builder/README_BridgeDocumentation/` when B1 clears ⟨PLAN B1⟩.
0. BEFORE step 1: cut the tag `preBridgeFramework-081626` on the B2 start commit — the base of
   BG-SEAM-UNTOUCHED ⟨RULING BF9⟩ (BRIEF-B2 carries the command).
After B2 the vocabulary and the seam files are FROZEN for B3/B4 and the composability diff includes them
(excluding `lib/bridge-framework/test/acceptance/`, §12.1).

---

## 15. What the framework MUST NOT offer ⟨FF §11⟩ ⟨ARCH §7⟩ ⟨RISK §5⟩

1. **No card lookup by join key** — no member, reader method, or hook argument returns a card for a
   `canonicalKey`/`cedsId`/`crossRefs`; the multimap is run-local ⟨Profile §2.2⟩ ⟨BR-018⟩.
2. **No plugin write path** ⟨BR-020, BR-111⟩.
3. **No plugin judge / cache / store / embedder access**; no per-plugin cache, model, floor or budget ⟨BR-021⟩.
4. **No predicate override; no predicate from the judge in v1** — the schema has no slot; a plugin cannot
   map a label outside its declared table; no producer constant stands in for a predicate ⟨BR-019, BR-044,
   BR-065⟩ ⟨RULING R6⟩.
5. **No silent default, in any form** — no default `matchBasis`, provider, column map, label mapping,
   sentinel list, blinding list, window, judge, version, encoding, or transform; `[]`/`{}` are answers,
   absence is refused; the f-word is absent (BG-NOSUB).
6. **No per-standard branch** — no literal `edfi`/`sif`/`ceds`/`pesc` in the framework tree; every
   difference is a declaration value or a hook (BG-COMPOSE c).
7. **No `matchBasis: derived`** in v1 — refused by name; with it go semantic top-K, the representation
   policy for a retrieval pool, the embedder in the bridge, the judge-predicate question, the `_close`
   inferred block ⟨RULING R6⟩. There is NO predicate slot in the judge's return in v1 (`llmClient`/`debugJudge`
   UNCHANGED ⟨RULING BF1⟩); a `derived`-era predicate question is a `llmClient` change inside the fingerprint tree.
8. **No structural bridging** in this framework in v1 — `producerKind: structural` refused ⟨BR-017⟩; the
   seam keeps accepting `blocks[]` from `build.js`'s side.
9. **No value-tier resolution** — refuse and count ⟨BR-080⟩.
10. **No timestamps, no `mapping_date` minting, no run ids or run counters in the block, no
    `frameworkVersion` stamp** — the content-derived fingerprint is the only framework self-reference (BG-DET, BG-GEN).
11. **No re-embedding** — a vectorless candidate is refused ⟨BR-123⟩; the framework never calls an embedder.
12. **No `cacheMode`/`pinBlockId` reading, and no `config` key the framework did not declare** — `spec.config`
    outside `RUN_CONFIG_KEY_LIST` is refused by name; the recipe's `params` channel is closed ⟨BR-073⟩ ⟨RULING
    BF11⟩; no judgment dedupe ⟨BR-074⟩; no human-review UI; no `MappingAssertion` reification; TSV-only SSSOM.
13. **No touch of the seam** — `build.js`, `interfaces.js` call shape, forger, replay, `recipe.js`'s
    referential checks unchanged; the TWO named exceptions (the `interfaces.js` block commit incl. its
    probes and stub-export migration; the vocabulary commit) are conjuncts of BG-SEAM-UNTOUCHED and it
    turns red on any other line ⟨RULING A8, BF10, BF12⟩.
14. **No second way to read source material** — one reader, one flatten, TWO purpose-scoped views
    (`forWalk()` unblinded for declared channel properties only; `forEvidence()` blinded), one blinding
    boundary, one list-widening point ⟨BR-091⟩ ⟨RULING P8, BF7⟩.
15. **No composite/keep-first index** ⟨BR-032 RULED⟩.
16. **No subject composition in the framework** — no `composeEdfiSubjectId`; the plugin's hook names the
    node, the framework proves it against the graph and refuses collisions ⟨RISK §4⟩.
17. **No plugin-side CSV library in the framework** — the plugin parses its own verified bytes; the
    framework verifies checksums and reads only what the DECLARATION names from the ASSERTIONS the walk yields.
18. **No escape hatch** — no `customResolver`/`overrideCardinality` hook; the qualifier variants are
    `judged` unless the source supplies `qualifierKeys` as a declared tuple field ⟨Profile §5.1⟩.

---

## 16. MUST DECIDE — only where the rulings are silent, with recommendations

| # | question | recommendation |
|---|---|---|
| **D-S1** | Test injection through the seam face vs the framework factory only | framework factory only; the seam face stays zero-arg and refuses any construction arg (as `interfaces.js` promises); proven by `test-interfaces` + BG-MODES ⟨ARCH D1⟩ |
| **D-S2** | Ship the EMPTY `BRIDGE_ALLOWANCE_REGISTRY` + the `compatibilityDeclarationList` key now, or omit until a row exists | ship empty; the mechanism is the forge framework's and a key that exists is not a change later ⟨ARCH D5⟩ |
| **D-S3** | The predicate a `tentative` (`Maybe`) row carries WHEN the judge picks: `predicateIfPicked: 'closeMatch'` (IMPL) vs no predicate → `predicateAbsent`, no edge (ARCH §8) | **`predicateIfPicked: 'closeMatch'`, declared on the table row, `predicateAssertedBy: labelTable`.** Profile §5.3 requires the predicate from the source's data-declared table; `Maybe` is a hedged assertion of sameness and `closeMatch` is its honest reading; the ruled census (151 judged) presupposes those subjects CAN yield edges. The alternative silently produces nothing from 93 subjects — a count, not a mapping. Either is data; the framework decides neither |
| **D-S4** | `subject_source_version` for SIF under allowance S3 (root `version: '1.0'` vs `selfDescribedVersion ?? 'unknown'`) | the block's `sourceVersion` = `selfDescribedVersion ?? 'unknown'` — it is what the pairKey is keyed on ⟨IMPL §2.4⟩; the SSSOM slot follows the block |
| **D-S5** | Code home of the hub-owned `ceds14PropertyRemodel` table (HARVEST §1.1 kept it by copy under `forgeDefinitionV2/legacy/`) | `forges/ceds/bridgeData/ceds14PropertyRemodel.json` keyed `hubName@hubVersion`, resolved by the framework from `remodelTableRef` against the HUB's bundle (never a plugin's), checksummed into `remodelTableDigest`; BR-015/BR-132 read as "MUST reference" |
| **D-S6** | `subjectStableIdFor` called ONCE per run with the distinct subject list (batch; lets Ed-Fi build its indexes once) vs once per subject | ONCE per run (this document's §4.2); the ruling names the hook and its job, not its cardinality; per-subject calls would force the plugin to re-read constructs 1,146 times or cache across calls (per-run state in a hook — refused by the doctrine) |
| **D-S7** | Which of `apps/bridge-maker/lib/*.js` join the `frameworkFingerprint` | all four (§7.2) — they are framework behaviour the judge path depends on; a change to `debugJudge.js` or `evidenceContracts.js` is a framework change SIF must be shown not to need |
| **D-S8** | The seam-face registry: discovery (ruled) — should a stray file under `forges/<std>/bridges/` REFUSE the build or be IGNORED? | REFUSE (§9) — "declared-but-broken refuses every build" ⟨FF §5.4⟩; ignoring is a silent default. `bridges/lib/` subdirectories are NOT scanned (only `bridges/*.js`) so a plugin may keep helpers beside itself |
| **D-S9** | Descriptor CSV walked-and-refused (counted) in v1 vs not declared at all | walked and refused-with-count (§10.1) — BR-080 "every refused assertion counted" ⟨ARCH D11⟩; cost is one parse |
| **D-S10** | Consistency check `CEDSOntologyPropertyNotation` — `report` (IMPL) vs `refuse` | `report` (9 disagreements are the crosswalk author's spelling; the hub's notation is authoritative); the nine are listed in the run report for B3's reviewer |

---

## 17. Positions this specification encodes

- **The seam is untouched and the trap in it is defused by naming**: the framework ALWAYS names its
  producer from the declared `matchBasis`; a crosswalk block is `_exact` and never falls to `build.js`'s
  `_close` inference. ONE block per pairing, returned in `blocks[]` under a PAIR-SCOPED `applyLabel` so
  two plugins never harvest each other; the suffix is the producer KIND; the predicate is on the edge; the
  harvested block carries nodes and edges and its id is coupled to the hub build.
- **A plugin is a declaration + a walk + a subject rule.** Ed-Fi's whole plugin is one declaration
  object, one CSV walk, one BR-138 walk; SIF's is one declaration, one node walk, identity. If B3 or B4
  needs a third hook, the framework — not the plugin — is where the missing capability goes.
- **The filter is data and the classification is a registry.** `tupleFieldColumnMap` is the ONLY thing
  that decides how many Ed-Fi rows are `specified`; the framework never infers a tuple field; a
  tentative label forces the judge.
- **Two artifacts, both content-addressed, chained by `decisionBlockHash` on every edge.** The block is
  the artifact; the graph is its replay; the census is inside the block; the fingerprint is inside the
  header; the acceptance is EQUAL against a NAMED graph.
- **The judge chooses cards, never predicates, in v1.** `derived` is out; the judge returns an ORDINAL and the
  framework's judge component maps it through the rendered pool order it recorded; `llmClient`/`debugJudge`
  are untouched.
- **Reuse what is reusable, and say plainly what is new**: `refuse.js`, `sourceVerification.js`,
  `twinRegistry.js`, `gateEvaluator.js`, `content-address`, the three stores' APIs, `sourceWindow`,
  `debugJudge`, `evidenceContracts`, the vocabulary's registries are REUSED; the contract-walk and
  reader-double IDIOMS are mirrored; the cardinality census, the file-tree fingerprint, the writer double
  and the `MAPPING_PROPERTIES` closed-set check are NEW ⟨RULING BF12⟩.
- **Refuse by name; absent is absent; count what you refuse; a stale table refuses the run.**

---

## Appendix A — Where the papers disagreed, and what settled it

| topic | ARCH | IMPL | RISK | settled by |
|---|---|---|---|---|
| Block suffix | `_exact` authored / `_close` inferred BY PREDICATE ("per Profile §4.7 naming") | — | ONE `_exact` block, suffix by producer KIND, predicate on the edge | ⟨RULING R8⟩ — RISK; ARCH's note corrected (§5.9) |
| `matchBasis: derived` in v1 | in the closed list, `producerKind: inferred`, judge-predicate path | — | OUT, refused by name | ⟨RULING R6⟩ — RISK; §4.1 |
| `Maybe` | `tentative` disposition; predicate from the table or `predicateAbsent` | `tentative` → judged, `predicateIfPicked: closeMatch`, Profile amendment | (took the ruling as given) | ⟨RULING P3⟩ Profile v1.0.4 — IMPL; the picked-predicate value is D-S3 |
| BR-046 unmapped label | per-assertion refusal `labelUnmapped`, counted | refuse the RUN | — | ⟨RULING P4⟩ — IMPL; §5.2 step 6 |
| BR-012 SIF predicate | `standardDeclared` kind; `predicateAbsent` if none | `channelAssertion` with citation; `none` refuses the channel | one-row `{ '*': exactMatch }` table, `source-declared-by-default` | ⟨RULING P5, R9⟩ — IMPL's shape with RISK's substance: a plugin DATUM, cited, `exactMatch` if the text supports it else `closeMatch`; §11 |
| Registry | discovery over `forges/<std>/bridges/*.js`, frozen at construction | — | explicit `bridgePluginRegistry.js` list; composability diff permits ONE added row | ⟨RULING A2⟩ discovery; ⟨RULING R4⟩ three instruments — reconciled in §12.1(a): under discovery the diff is EMPTY with no exception; the one-row clause applies only if D2 is reversed. RISK's "directory search" smell answered by refuse-on-stray (D-S8) |
| `subjectStableIdFor` purity | pure `({ subjectIdentity }) => …` | `resolveSubjectId({ subject, graphReader, dependencies }, cb)` — a WALK over the graph | — | ⟨RULING A3⟩ names ARCH's hook; ⟨RULING P2⟩ accepts IMPL's walk — reconciled: ARCH's name, callback-shaped, receives the source-scoped reader, called ONCE per run (D-S6) |
| Remodel table home | plugin declaration (`remodelTable` value) | hub-owned data, referenced (`remodelTableRef`) | plugin data, hashed into the block | ⟨RULING P11⟩ — IMPL; §4.1, D-S5 |
| Census in the block | (report member) | — | HASHED into the frozen text | ⟨RULING R7 D-2⟩ — RISK |
| Predicate frozen vs looked up | (frozen implicitly) | — | FROZEN into the record; table hash in the generation | ⟨RULING R7 D-1⟩ — RISK |
| `pairKey` | `hub@ver::source@ver::bridgeName` | — | + `::producerKind` | ⟨RULING R3⟩ — RISK |
| Framework fingerprint in the block | (no self-reference) | — | YES, content-derived, in the generation | ⟨RULING R4⟩ — RISK; §7.2 |
| `interfaces.js` / `BRIDGE_MODULE_SHAPE` | re-point the shape gate at the new contract (D9) | retire it into `lib/bridge-framework/bridgePluginContract.js` | named allowlist commit | ⟨RULING A8, P10, BF10⟩ — IMPL's retirement inside ARCH's named exception, budgeted to include `resultKeys` (null today), the two live probes and the stub's exports; §14.4 |
| Debug edge flagging | judged edges `decisionAlgorithm: INVALID_DEBUG` | — | EVERY edge `provenanceTier: invalid-debug`, specified included; promotion refusal | ⟨RULING R5⟩ — RISK; §5.6 step 5 |
| Ed-Fi acceptance census | 1,085/58/3 (FINDING) | 992/151/3 under (c), 1,085/58/3 under (a) | FINDING literals as sanity + enumerated movers | ⟨RULING P3, P12⟩ — 992/151/3 EQUAL against `GOLD_EVAL_260816` + label digest; FINDING literals as the sanity row with the named mover; §10.4 |
| Contract table walk | mirror (D6) | — | — | ⟨RULING A10⟩ lift iff byte-neutral → ⟨RULING BF12⟩ the lift is not achievable (`[code fact]`, review F3): MIRROR |
| Judge return shape (post-review) | `{ chosenCardStableId, category, rationale, predicate: null }` (v1.0 §5.6.3) | — | predicate slot present-and-null | ⟨RULING BF1⟩ — v1.0's shape was NOT what the code returns; v1.1 §5.6: the client's ordinal `choice`, mapped by the framework; NO predicate slot; `llmClient`/`debugJudge` unchanged |
| `applyLabel` (post-review) | single `spec.applyLabel`, no `blocks[]` (v1.0 §5.9) | — | — | ⟨RULING BF2⟩ — `blocks[]` with a PAIR-SCOPED label; the review's A3 |
| Relationship block contents (post-review) | "canonical edges" (v1.0 §7) | — | "harvested from the labeled edges" | ⟨RULING BF3⟩ — nodes AND edges; the review's A4 |

**Rulings-file annotations the supervisor made after the review (recorded so a builder reading the
rulings top-down does not implement the superseded row)** ⟨RULING BF17⟩ ⟨REVIEW G4, G5⟩: the architect-block
row "authored → `_exact`/`_close` per predicate" is SUPERSEDED by D-4 (suffix by producer KIND — §5.9 of
this document); the architect-block measured row "SIF `cedsId` on 2,231 `DmeProperty` nodes" should read
`SifField` nodes (this document's §4.2/§11 are correct; verified 2,231 / 354).
