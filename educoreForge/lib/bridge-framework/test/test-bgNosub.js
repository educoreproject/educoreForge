#!/usr/bin/env node
'use strict';

// test-bgNosub.js — the STATIC and META gates: BG-NOSUB (Be-smart 7, polyArch2; RULING BF11) + BG-COMPOSE (RULING R4; §12.1)
// + BG-SEAM-UNTOUCHED (PLAN hard lines; RULINGS A8, P10, BF9, BF10, BF12; SABLE_RIVER 17:10) + BG-HYGIENE (BR-112) + BG-SWEEP.
//   BG-NOSUB lexical: the f-word (any form) absent from lib/bridge-framework/**, bridgeMaker.js and every fixture plugin
//   (comments included) — apps/bridge-maker/lib/llmClient.js and debugJudge.js are UNCHANGED files by RULING BF1 and carry
//   pre-existing occurrences: EXEMPT by name, listed; the stub-logger idiom absent; per-standard tokens absent from the
//   framework tree and the seam face; behavioural: xLog absent → refused; stores absent on rebridge → refused; llmClient
//   absent at the first judged subject → refused; a spec.config key outside RUN_CONFIG_KEY_LIST → refused; a `||` identity
//   chain over a declaration value → lexical red.
//   BG-COMPOSE (a) the diff between the two accepted-plugin commits is B3/B4 DATA (test/acceptance/expectedCompose.json, null
//   and honest); the numstat MECHANISM is proven on a scratch git repo — a comment added between two commits reddens it;
//   (b) frameworkFingerprint in BOTH toy plugins' blocks EQUALS the fingerprint recomputed now (content-derived: a double
//   whose fingerprint tree gains a scratch file differs); (c) no per-standard branch: the token grep PLUS a static branch
//   census — no `switch (`, no `=== '<value>'` on matchBasis / standardKey / predicateSource.kind / subjectIdentity.kind in
//   the framework tree (every such dispatch is a registry lookup); a scratch copy with `if (declaration.standardKey ===
//   'sif')` injected reddens both.
//   BG-SEAM-UNTOUCHED: `git diff --stat preBridgeFramework-081626 --` over build.js, forger/, replay/, replay-manager/,
//   forges/*/forge*.js, forges/*/lib/*Declaration.js, forges/*/lib/*Hooks.js, lib/forge-framework/ (minus the ONE ruled test
//   edit) is EMPTY; (i) interfaces.js changed ONLY in the two declaration blocks — every other COMPONENT_SHAPES member and
//   MANIFEST_HANDLE_SHAPE byte-equal to the tag, bridgeMaker.run arity/argKeys equal, BRIDGE_MODULE_SHAPE gone; (ii) the
//   lib/vocabulary/ diff touches vocabulary.js and its tests only; (iii) the lib/forge-framework/ diff is EXACTLY
//   test/test-gSeamUntouched.js (RULING 17:10). Twin: a scratch worktree touching build.js.
//   BG-HYGIENE (a) the canonical dataStores are byte-unchanged across a suite run (name+size+mtime census before/after);
//   (b) the fixture is committed and its SHA256SUMS hash pinned; (c) no licensed bytes (the toy crosswalk is tiny and toy-
//   named); (d) a one-machine / proxy gate says so by name (BG-P7's title).
//   BG-SWEEP: a no-op twin → DEFECTIVE; a real twin → observedRed; no twin → UNPROVEN; expectationLever-only → UNPROVEN;
//   a red baseline → FAILING; a missing / orphaned twin → the audit lists it.
//
// Run: node lib/bridge-framework/test/test-bgNosub.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-NOSUB + BG-COMPOSE + BG-SEAM-UNTOUCHED + BG-HYGIENE + BG-SWEEP

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, pureConjunct, succeeded, nameInRefusal, refusalCase, frameworkMutationTwin, scenarioTwin, blockOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const twinRegistryLib = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const gateEvaluatorLib = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'gateEvaluator'));
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const decisionBlockLib = require('../decisionBlock');
const vocabularyLib = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));

const twinRegistry = twinRegistryLib.makeTwinRegistry();
const FRAMEWORK_FILE = 'bridge-framework.js';
const TREE_ROOT = path.resolve(scenarioLib.FRAMEWORK_DIR, '..', '..');
const BRIDGE_MAKER_DIR = path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'bridge-maker');
const BASE_TAG = 'preBridgeFramework-081626';
// ⟪A SECOND BASELINE — RULING SABLE_RIVER 2026-08-17⟫ The lib/vocabulary/ diff gate measures from the D1
// batched commit, not from the pre-bridge tag. WHY: ruling §11.7 (b) ADOPTED semapv:SemanticSimilarityThreshold-
// Matching into the closed justification allowlist, and the adopted term must carry a human definition — which
// lives in vocabulary-definitions.js, a file conjunct (ii) exists to forbid touching. The gate's own twin proves
// it bites by appending to that very file, so no wording of the conjunct could tell a ruled adoption apart from
// the violation it guards against.
//
// The baseline MOVES; the allowed-path list is NEVER widened. That is the difference between "this change was
// authorised" and "this file stopped being protected" — after the move, an append to vocabulary-definitions.js
// is red again, which is exactly what the twin still demonstrates. Same treatment §11.8 gives BG-COMPOSE (a).
//
// The SEAM PROPER (build.js, interfaces.js, forger, replay) and lib/forge-framework/ keep the PRE-BRIDGE tag:
// no framework change touched them, and a baseline that moves without needing to is a baseline that has stopped
// meaning anything.
// The conjunct also USED to require that vocabulary.js itself appear in the diff — a sensible thing to assert
// across the pre-bridge -> B3 window, where the vocabulary demonstrably had changed. From the new baseline
// nothing has changed yet, so that clause would fail on an EMPTY diff, i.e. on the cleanest possible state.
// Dropped, and only it: the load-bearing half — that NOTHING outside vocabulary.js and its tests appears — is
// what the gate is for and is untouched. The twin still proves it by appending to vocabulary-definitions.js.
// ═══ RE-ANCHOR (ii), 2026-09-15 (RADIANT_QUEST), forge embed-text revision P8 (PLAN-forgeEmbedText-091426.md R-ET-6/7) ═══
// postGraphSelfDoc-090126 (4b122b0) -> postEmbedTextP7-091526. THE SAME SPECIES AS THE SABLE_RIVER NOTE ABOVE: P2 (a97bfdd) ADOPTED a
// DME role (DmeEmbedText), an edge type (EMBEDS_TEXT_OF) and the text-node vector term (EMBED_TEXT_VECTOR), and an adopted
// term must carry a human definition — which lives in vocabulary-definitions.js, the file this conjunct exists to forbid
// touching. CENSUS AT THE RE-ANCHOR (git diff --stat postGraphSelfDoc-090126 -- lib/vocabulary/):
//   lib/vocabulary/test/test-embedTextVocabulary.js | 216 +   (P2, a97bfdd — allowed, a test)
//   lib/vocabulary/vocabulary-definitions.js        |   4 +   (P2, a97bfdd — the ruled adoption; the ONE file outside the list)
//   lib/vocabulary/vocabulary.js                    |  42 +-  (P2 a97bfdd + P4 7bfd1be — allowed)
// THE BASELINE MOVES; THE ALLOWED-PATH LIST IS NEVER WIDENED. After the move an append to vocabulary-definitions.js is red
// again, which is exactly what the twin still demonstrates — re-observed red against THIS tag before the move was committed.
// ═══ RE-ANCHOR (ii), 2026-09-29 (WILD_PORTAL for EBONY_DREAM), SIF replacement merge gate M1 ═══
// postEmbedTextP7-091526 -> postM1VocabularyIi-092926, tag cut ON this re-anchor commit. THE SAME SPECIES AGAIN: two RULED edits to
// vocabulary-definitions.js, the one file outside the list. CENSUS (git diff --name-only postEmbedTextP7-091526 -- lib/vocabulary/)
// on the merged head 891f1d5:
//   lib/vocabulary/vocabulary.js, test/test-mappingProperties.js, test/test-sifEdgeVocabulary.js, test/test-sifVocabularyInvariance.js,
//     test/testSupport/pureProxyFingerprintProbe.js — V1 (bb63af1), allowed (vocabulary.js and tests);
//   lib/vocabulary/vocabulary-definitions.js — V1's definitions of the four sif260928 edge types and judgedSubjectStableId (bb63af1)
//     plus M1's supervisor-owned widening of HAS_CHILD's text to Field -> Field (e96c847, SPEC §9 A26). THE ONE FILE OUTSIDE THE LIST.
// THE BASELINE MOVES; THE ALLOWED-PATH LIST IS NEVER WIDENED. Fresh red observed against THIS tag (DEVLOG-M1).
// ═══ RE-ANCHOR (ii), 2026-10-04 (VIOLET_OCEAN, mappingProvenance lane P; pre-authorised, WORKORDER step 3) ═══
// postM1VocabularyIi-092926 -> postMappingProvenancePVocabularyIi-100426, tag cut ON this re-anchor commit. THE SAME SPECIES
// AGAIN: one RULED edit to vocabulary-definitions.js, the one file outside the list. CENSUS (git diff --name-only
// postM1VocabularyIi-092926 -- lib/vocabulary/) on 9bace1b:
//   lib/vocabulary/vocabulary.js, test/test-mappingProperties.js, test/test-sifEdgeVocabulary.js — lane P 9bace1b, allowed;
//   test/test-sifVocabularyInvariance.js — already in the diff before lane P (not lane P's), allowed (a test file);
//   lib/vocabulary/vocabulary-definitions.js — lane P 9bace1b: the 'judge-inferred' tier definition (ruled A1), EXACT_MATCH /
//     CLOSE_MATCH no longer described as authored / inferred, StandardDefinition's disposition text. THE ONE FILE OUTSIDE THE LIST.
// THE BASELINE MOVES; THE ALLOWED-PATH LIST IS NEVER WIDENED. Fresh red observed on 9bace1b before this commit (DEVLOG-P).
// ═══ RE-ANCHOR (ii) AGAIN, 2026-10-04 (VIOLET_OCEAN, lane P; TQ reversed ruling A1) ═══
// postMappingProvenancePVocabularyIi-100426 -> postMappingProvenancePVocabularyIiB-100426, tag cut ON this commit. CENSUS (git
// diff --name-only postMappingProvenancePVocabularyIi-100426 -- lib/vocabulary/) on 3923467: vocabulary.js, test/test-mappingProperties.js,
// test/test-sifEdgeVocabulary.js (allowed); vocabulary-definitions.js — 3923467: 'judge-inferred' definition removed,
// REQUIRED_PROPERTIES.MAPPING_EDGE defined, the tier and match-edge texts say a mapping edge carries no provenanceTier and that
// the debug judge is mappingSource bridge-debug. THE ONE FILE OUTSIDE THE LIST. Base moved; list NOT widened. Fresh red observed
// on 3923467's tree before this commit (DEVLOG-P).
// ═══ RE-ANCHOR (ii) THIRD, 2026-10-04 (VIOLET_OCEAN, lane P; TQ-approved metadata additions) ═══ postMappingProvenancePVocabularyIiB-100426
// -> postMappingProvenancePVocabularyIiC-100426, tag cut ON this commit. CENSUS on f4ab2c4: ONE file, vocabulary-definitions.js
// (the five match-relation definitions as judgments; StandardDefinition's mappingKindList / mappingSourceList). Outside the list;
// base moved, list NOT widened. Fresh red observed on f4ab2c4 (DEVLOG-P).
// ═══ RE-ANCHOR (ii) FOURTH, 2026-10-04 (VIOLET_OCEAN, lane P; TQ's standardKind + standardUsageTips) ═══ ->
// postMappingProvenancePVocabularyIiD-100426, tag cut ON this commit. CENSUS on cf58dfb: vocabulary.js (STANDARD_KIND, allowed)
// and vocabulary-definitions.js (StandardDefinition's text names standardKind and standardUsageTips), the one file outside.
// Base moved, list NOT widened. Fresh red observed on cf58dfb (DEVLOG-P).
// ═══ RE-ANCHOR (ii), 2026-10-05 (EMERALD_OCEAN, leftovers lane R; pre-authorised) ═══ postMappingProvenancePVocabularyIiD-100426 ->
// postLeftoversRVocabularyIi-100526, tag cut ON this commit. CENSUS (git diff --stat postMappingProvenancePVocabularyIiD-100426 --
// lib/vocabulary/) at the G-SEAM-UNTOUCHED re-anchor: vocabulary.js 15 (BUILD_ATTESTATION_VERDICT, allowed), test/test-sifVocabularyInvariance.js
// 13 (the ruled PROXY re-pin, allowed) and vocabulary-definitions.js 2 (StandardDefinition's text: kind + tips now read from the
// root), the one file outside. Base moved, list NOT widened. Fresh red observed on d39755c (DEVLOG-R).
// ═══ RE-ANCHOR (ii), 2026-10-06 (SILVER_ECHO, campaign P0; pre-authorised) ═══ postLeftoversRVocabularyIi-100526 ->
// postCampaignP0VocabularyIi-100626, tag cut ON this commit. CENSUS (git diff --stat postLeftoversRVocabularyIi-100526 --
// lib/vocabulary/) at 01dfe71, all campaign P0 9d90652 (the W-A declarations): vocabulary.js 3 (re-exports graph-contract,
// allowed), test/test-graphContract.js 133 (new, allowed), and the two files outside: graph-contract.js 260 (new: the
// declarations of CONTRACTS §0-§5) and tools/emitGraphContractJson.js 52 (new: writes graphContract.json). Base moved, list
// NOT widened. Fresh red observed on the re-anchor commit (DEVLOG-P0).
// ═══ RE-ANCHOR (ii), 2026-10-06 (CARDINAL_RIVER, campaign P2; pre-authorised, VIOLET_VALLEY 17:42Z) ═══ postCampaignP0VocabularyIi-100626
// -> postCampaignP2VocabularyIi-100626, tag cut ON this commit. CENSUS (git diff --stat postCampaignP0VocabularyIi-100626 -- lib/vocabulary/)
// at fb4b303, all campaign P2: vocabulary.js 205 (allowed: W-A-6 SchemaView kinds, W-A-10 NODE_BY_ROLE_CLASS, W-A-12 26 dead
// exports removed, W-B-13 / W-C-3 / W-A-4 declarations), six test files (allowed: test-edgeDefinitionCensus.js and its fixture
// new for W-C-3, test-registryConsumers.js new for W-A-12, test-graphContract.js, test-embedTextVocabulary.js,
// test-sifEdgeVocabulary.js), and the two files outside: graph-contract.js 213 (the P2 declarations — §10 vector index naming,
// bridge pair labels, meanings on every row, §14 the DME user layer) and vocabulary-definitions.js 25 (W-C-3 / W-A-4 / W-A-5 /
// W-A-10 definition texts). Base moved, list NOT widened. Fresh red observed on the re-anchor commit (DEVLOG-P2).
// ═══ RE-ANCHOR (ii) SECOND, 2026-10-06 (CARDINAL_RIVER, campaign P2; pre-authorised) ═══ postCampaignP2VocabularyIi-100626 ->
// postCampaignP2VocabularyIiB-100626, tag cut ON this commit. CENSUS at 462d922: ONE file, outside — graph-contract.js 2 (fleet finding:
// StandardDefinition.standardUsageTips required: false, because the forge declaration contract allows null tips). List NOT widened.
// ═══ RE-ANCHOR (ii) THIRD, 2026-10-06 (CARDINAL_RIVER, campaign P2; pre-authorised) ═══ -> postCampaignP2VocabularyIiC-100626, tag ON
// this commit. CENSUS at 6122536: ONE file, outside — graph-contract.js 4 (fleet finding: 'Sif' joins the producer-local label tokens,
// the old SIF forge's family). List NOT widened.
// ═══ RE-ANCHOR, 2026-10-06 (CARDINAL_HORIZON; campaign P3, (ii); pre-authorised by the P3 work order) ═══ postCampaignP2VocabularyIiC-100626 ->
// postCampaignP3VocabularyIi-100626, tag cut ON this commit. CENSUS at HEAD before the move (git diff --shortstat postCampaignP2VocabularyIiC-100626 over this gate's own
// paths): 8 files changed, 520 insertions(+), 48 deletions(-); 8 file(s) — the P3 entries W-B-1..14, W-C-1..17, ruling B (DEVLOG-P3). Path list
// byte-identical; nothing excluded.
// ═══ RE-ANCHOR, 2026-10-07 (BRONZE_SIGNAL; G21 omission declaration; pre-authorised by WORKORDER-G21) ═══ (ii) postCampaignP3VocabularyIi-100626 ->
// postCampaignG21VocabularyIi-100726, tag cut ON this commit. CENSUS at c049bc8 over this gate's own path: 2 files, both outside the
// allowed list — graph-contract.js 3/0 (explicitOmissionDeclarationList in §1 and §4) and vocabulary-definitions.js 1/1 (the
// BuildAttestation definition names it). Path list NOT widened.
// ═══ RE-ANCHOR, 2026-10-08 (PRISM_CASCADE; forgeClean lane CLEAN, G19; pre-authorised by WORKORDER-CLEAN) ═══ (ii) postCampaignG21VocabularyIi-100726 ->
// postForgeCleanVocabularyIi-100826, tag cut ON this commit. CENSUS at a094ec4 (lib/vocabulary/): 3 files, 9+/2- — vocabulary.js 3
// (EDGE_TYPES.HAS_DEFINITION), vocabulary-definitions.js 3/1 (its definition; REFERENCES_TYPE widened to anonymous types) and
// test/test-sifEdgeVocabulary.js 3/1 (the SchemaView ledger +1). Allowed-path list NOT widened; nothing excluded.
// ═══ RE-ANCHOR, 2026-10-08 (PRISM_CASCADE; forgeClean lane CLEAN, G20 contract declaration; pre-authorised) ═══ (ii) postForgeCleanVocabularyIi-100826 ->
// postForgeCleanVocabularyIiB-100826, tag cut ON this commit. CENSUS at 189bbb1 (lib/vocabulary/): 2 files — graph-contract.js 4/0 (precedingCommentList
// list-valued; fileCommentList exempt as a JSON string) and test/test-sifEdgeVocabulary.js 3/2 (the ledger +1). Allowed-path list NOT widened.
// ═══ RE-ANCHOR, 2026-10-08 (ONYX_SUMMIT; forgeClean lane REFORGE; pre-authorised by WORKORDER-REFORGE) ═══ (ii) postCampaignG21VocabularyIi-100726 ->
// postForgeCleanReforgeVocabularyIi-100826, tag cut ON this commit. CENSUS at d6fecdce over this gate's own path: ONE file, outside the
// allowed list — graph-contract.js 3/1 (the promotionStamp gate list gains reforgeDeterminism, §4). Path list NOT widened.
// ═══ RE-ANCHOR AT THE MERGE, 2026-10-08 (PRISM_CASCADE; forgeClean R4 merge of lanes CLEAN d2aa1ab8 and REFORGE 89b25f55; pre-authorised by
// WORKORDER-R4) ═══ (ii): both lanes' anchors above -> postForgeCleanMergeVocabularyIi-100826, tag cut ON the merge commit. CENSUS: the union of the two lanes'
// censuses above, and nothing else (the merge resolved only these anchor conflicts). Path list byte-identical; nothing excluded.
const POST_D1_BASE_TAG = 'postForgeCleanMergeVocabularyIi-100826'; // re-anchored at the forgeClean merge by PRISM_CASCADE; the tag is cut ON the merge commit
// ⟪A THIRD BASELINE — RULING P1-R11, BRIEF-SEAM-reanchorBgSeamUntouched.md, applied 2026-08-29 by
// STERLING_PEAK during hub kit role migration Phase 0.E4⟫
//
// THE CAUSE, NAMED IN THE GATE'S OWN DATA rather than only in a DEVLOG, because a successor must be
// able to see WHY the baseline moved from the artifact that moved:
//
//   47f8962  "P0b: the PESC forge hybrid searchText composition (TQ 're-embed authorized')"
//
// That commit edited forges/pesc260805/forgePesc260805.js by 98 insertions / 3 deletions. The path
// is inside this gate's own glob `forges/*/forge*.js`, and the gate measured from
// preBridgeFramework-081626, which PREDATES the entire PESC re-embed. So the moment TQ authorised
// the re-embed, seamDiffEmpty could not stay green. It was red from 2026-08-17 until this move, and
// the redness was nobody's error but the supervisor's for accepting P0b on "suites green" without
// asking WHICH suites — a green claim that does not name its scope is not a green claim.
//
// A SECOND, LATER CAUSE, also authorised: the Phase 0.E3 edit to
// lib/forge-framework/test/acceptance/expectedBlockIds.json (PLAN-hubKitRoleMigration-082826.md),
// which filled the three null measuredPreMigration ids with MEASURED values. That file sits inside
// lib/forge-framework/, so it moved conjunct (iii) as well as seamDiffEmpty. Both edits are inside
// the new tag; neither is inside the old one.
//
// THE BASELINE MOVES; THE ALLOWED-PATH LIST IS NEVER WIDENED. SEAM_PATH_LIST below is byte-identical
// to what it was. After the move an append to any seam file is red again, which is exactly what the
// twins still demonstrate — and both were re-observed red against THIS tag before the move was
// committed. A re-anchor without a fresh red observation is a gate nobody has proven still works.
//
// ONLY TWO CONJUNCTS MOVE, AND THE OTHER TWO DELIBERATELY DO NOT — a baseline that moves without
// needing to is a baseline that has stopped meaning anything (the same principle the POST_D1 note
// above states):
//   * seamDiffEmpty  MOVES — it is the conjunct that expired, and it is a "nothing has moved since"
//                    assertion, which is meaningless against a base that predates authorised moves.
//   * (iii)          MOVES — same reason, for lib/forge-framework/.
//   * (i)            DOES NOT MOVE. It reads interfaces.js AT THE TAG and asserts BRIDGE_MODULE_SHAPE
//                    was present there and is gone at HEAD. That is a claim about the B2 migration
//                    window. Moving its base to a commit where the shape is ALREADY gone would make
//                    the assertion vacuously false and DESTROY a true, still-load-bearing check.
//   * (ii)           DOES NOT MOVE. It has its own baseline, POST_D1_BASE_TAG, for its own reason.
//
// AND ONE CLAUSE OF (iii) IS DROPPED, FOR THE IDENTICAL REASON THE vocabulary.js CLAUSE WAS DROPPED
// ABOVE. (iii) used to require that test/test-gSeamUntouched.js APPEAR in the diff — sensible across
// the pre-bridge window, where that ruled edit demonstrably had happened. From the new baseline that
// edit is HISTORY and is inside the base, so the clause would fail on an EMPTY diff, i.e. on the
// cleanest possible state. Dropped, and only it. The load-bearing half — that NOTHING under
// lib/forge-framework/ has moved since the anchor — is what the gate is for, is STRICTER than what
// it replaced (an empty list admits less than a one-element list), and is untouched. The twin still
// proves it by appending to lib/forge-framework/refuse.js.
// PHASE 2a RE-ANCHOR of conjunct (iii) ONLY (SILVER_TIDE, 2026-08-29). This is the DOCKETED REMEDY
// for a collision Phase 0's review predicted and named, arriving on schedule.
// postPescReembed-082926 (75d5470) -> post2aGSeamReanchor-082926 (f8e1faa).
//
// CAUSE: R-HUB-1 required moving PRE_MIGRATION_REF, and that constant lives INSIDE
// lib/forge-framework/test/test-gSeamUntouched.js. (iii) demands the lib/forge-framework/ diff be
// EMPTY and applies NO exclusion, so the ruled edit turned it red — while seamDiffEmpty stayed green
// because SEAM_PATH_LIST excludes that very file. One gate's ruled edit inside another's watched set,
// the same shape as FJ-P0-1 and FJ-P1-1/2.
//
// ⚠ WHAT WAS DELIBERATELY *NOT* DONE, and it is the whole point of this note: NO EXCLUSION WAS ADDED
// TO (iii). The obvious "fix" is to exclude test-gSeamUntouched.js here the way SEAM_PATH_LIST does.
// That would hand back PERMANENTLY the blind spot the Phase 0 re-anchor closed — (iii)'s entire value
// since then is that it admits NOTHING under lib/forge-framework/. The baseline moves; the scope does
// not. STANDDOWN-P0 C.1 also warns that the SEAM_PATH_LIST exclusion now LOOKS redundant and must not
// be tidied away, because removing it would silently widen seamDiffEmpty. Leave both alone.
//
// The two edits (iii) formerly described as "inside the anchor" — test-gSeamUntouched.js under
// RULING SABLE_RIVER 17:10, and test/acceptance/expectedBlockIds.json under Phase 0.E3 — remain
// inside this NEW anchor too, which is one commit further along the same line.
//
// PREVIOUS BASE, in full: postPescReembed-082926 @ 75d5470 (Phase 0 Commit A).
// RE-ANCHOR, hub-kit-role Phase 3. (iii)'s base moves from post2aGSeamReanchor-082926 to
// post3SeamDiffEmptyReanchor-082926 (cfe6f79) — the seamDiffEmpty re-anchor commit, which is the
// most recent point at which lib/forge-framework/ is quiet.
//
// WHY IT MOVED, AND WHY IT IS A SEPARATE COMMIT. (iii) demands the lib/forge-framework/ diff be
// EMPTY. Phase 3 put THREE things under that path: the ruled S2 row correction in
// migrationAllowanceRegistry.js (RULING FJ-P3-2), the S2 conjunct/twin move in test/test-gCompat.js,
// and the new test/test-labelCensus.js + test/acceptance/expectedLabelCensus.json (RULING
// FJ-P3-1(a)). Measured at the migration commit: four files. seamDiffEmpty and (iii) therefore went
// red TOGETHER, and each is re-anchored ALONE, in its own commit, per P1-R11.
//
// ⚠ THIS IS THE DOCKETED REMEDY FROM PHASE 0 OPEN ITEM 8, APPLIED AS RULED: MOVE THE BASE, NEVER
// EXCLUDE. The tempting "fix" is to add a lib/forge-framework/test/ exclusion to (iii) so test-only
// edits stop reddening it. DO NOT. (iii)'s entire value since the Phase 0 re-anchor is that it
// admits NOTHING under lib/forge-framework/, and an exclusion would hand back exactly the blind spot
// the re-anchor closed. The path list is byte-identical; only the base has moved.
//
// Verified by grep before editing that PHASE0_ANCHOR_TAG serves conjunct (iii) ALONE — seamDiffEmpty
// reads PHASE3_ANCHOR_TAG and moved in the previous commit — so this move touches no other conjunct.
// ⚠ MOVED 2026-08-29 by TWILIGHT_GATE (Phase 4). Conjunct (iii) demands the lib/forge-framework/
// diff be EMPTY with NO exclusions, and Phase 4 made R6 edits there under rulings FJ-P4-2/5/6:
// four new allowance rows plus two extracted shared factories in migrationAllowanceRegistry.js,
// the allowListedEdgeCount counter in contractGraphKit.js, a corrected comment in rootNode.js,
// and the gate and fixture files. THE BASE MOVES; NO EXCLUSION IS ADDED — that is the Phase 0
// open-item-8 remedy, and the prohibition is the whole point: this conjunct is worth having only
// because it admits NOTHING, so an exclusion would hand back exactly the blind spot it closes.
// ⚠ MOVED 2026-08-29 by WILD_SHARD (Phase 7, RULING FJ-P7-3), for the reason (iii) exists to make
// legible and for no other. (iii) demands the lib/forge-framework/ diff from this anchor be EMPTY and
// applies NO EXCLUSION; seamDiffEmpty EXCLUDES test-gSeamUntouched.js. So the RULED G-SEAM-UNTOUCHED
// re-anchor — moving its PRE_MIGRATION_REF, which lives inside that file — necessarily lands inside
// (iii)'s watched set and outside seamDiffEmpty's. MEASURED, not predicted: (iii) was EMPTY before that
// edit and named exactly that one file after it.
//
// THE BASELINE MOVES; THE CONJUNCT DOES NOT. No exclusion is added for test-gSeamUntouched.js — its
// entire value since the Phase 0 re-anchor is that it admits NOTHING, and an exclusion would hand back
// the blind spot the re-anchor closed. That refusal is DEVLOG open item 8's own recommendation, and
// Phase 2a paid it the same way.
// RE-ANCHOR (iii) 2026-09-02, SECOND MOVE OF THE DAY (TWILIGHT_ARROW). The seam re-anchor commit
// 6d15e81 edited lib/forge-framework/test/test-gSeamUntouched.js — under the bare 'lib/forge-framework/'
// pathspec this conjunct diffs — so (iii) went red on a fix, not on code. SEAM_PATH_LIST carries an
// explicit exclusion for that file; THIS conjunct does not, and the scar protects one conjunct and
// not its neighbour. The ruled move is the anchor, never an exclusion: it advances to the tag cut on
// 6d15e81 so the edit falls inside it. Found by the bgNosub twin refusing at 25/26, not by reading.
// RE-ANCHOR (iii) 2026-09-02 (JOBS 5+6): lib/forge-framework/ did NOT move in JOBS 5-6, but this anchor
// advances with the seam so the two conjuncts share one head; measured empty over lib/forge-framework/
// from the new ref before the move.
// RE-ANCHOR (iii), THIRD TIME 2026-09-03 00:2x (TWILIGHT_ARROW): the re-anchor commit d9356a5 ITSELF edits
// lib/forge-framework/test/test-gSeamUntouched.js (moving PRE_MIGRATION_REF), which is INSIDE this conjunct's
// watched path. So this anchor, like P1_BASELINE_COMMIT, must be a tag cut ON the re-anchor commit, not before it.
// RULE (bit three times tonight): any anchor whose watched paths include a file the re-anchor commit edits must
// point at a tag on the re-anchor commit itself. Tag cut last; accepted only at 26/26 observed.
// ═══ RE-ANCHOR (iii), 2026-09-15 (RADIANT_QUEST), forge embed-text revision P8 (PLAN-forgeEmbedText-091426.md R-ET-6/7) ═══
// postJudgeRegistryJob4b-090726 (ce33088) -> postEmbedTextP7-091526. THIS IS THE CONJUNCT THE CAMPAIGN WAS ALWAYS GOING TO REDDEN:
// it demands an EMPTY lib/forge-framework/ diff and applies no exclusion, and P3 (6b54b91, "framework-minted embed-text
// nodes, text pass, G-ETEXT") is a FRAMEWORK CHANGE by design (HANDOFF decision 3 authorised the move). CENSUS AT THE
// RE-ANCHOR (git diff --name-only postJudgeRegistryJob4b-090726 -- lib/forge-framework/), 15 files at the merged head 44ceddc:
//   NEW  embedTextDerivation.js, embedTextPass.js, frameworkNonEmbeddableRoles.js, test/test-gEtext.js
//   EDIT contractGraphKit.js, embedPass.js, fingerprint.js, forge-framework.js, forgeDeclarationContract.js, README.md,
//        test/fixtures/toyForge/lib/toyForgeDeclaration.js, test/test-gDet.js, test/test-gEmbed.js, test/test-gNograph.js,
//        test/test-gOrder.js
// plus, INSIDE this tag and after 44ceddc: the P8 pin refresh (00735c4: test/acceptance/expectedBlockIds.json,
// expectedFingerprints.json, expectedLabelCensus.json) and THIS commit's edit to test/test-gSeamUntouched.js (the G-SEAM
// re-anchor) — which is why the tag is cut ON this commit (TWILIGHT_ARROW's rule, 2026-09-03: an anchor whose watched paths
// include a file the re-anchor commit edits must point at a tag on the re-anchor commit itself).
// THE PATH IS UNCHANGED, NO EXCLUSION IS ADDED. The twin (append to lib/forge-framework/refuse.js) re-observed red against
// THIS tag before the move was committed.
// ═══ RE-ANCHOR (iii), 2026-09-15 (RADIANT_QUEST), forge embed-text revision P9 (R-ET-6/7 again) ═══
// postEmbedTextP7-091526 (53c2ff2) -> postEmbedTextP9-091526. CENSUS (git diff --stat postEmbedTextP7-091526 -- lib/forge-framework/): exactly the
// three acceptance pins re-pinned for SIF and PESC in d457e8d (test/acceptance/expectedBlockIds.json | 48, expectedFingerprints.json | 6,
// expectedLabelCensus.json | 8) — the P9 declarations moved SIF's and PESC's censuses, proxies and block ids by design (R-ET-10), and
// nothing else under lib/forge-framework/ moved. Tag cut ON this commit (it edits nothing under lib/forge-framework/, but the rule is the
// rule and the three anchors share one head). Path unchanged, no exclusion; twin re-observed red against THIS tag.
// ═══ RE-ANCHOR (iii), 2026-09-29 (WILD_PORTAL for EBONY_DREAM), SIF replacement merge gate M1 ═══
// postEmbedTextP9-091526 -> postM1ForgeFrameworkIii-092926, tag cut ON this re-anchor commit. CENSUS (git diff --stat
// postEmbedTextP9-091526 -- lib/forge-framework/) on the merged head ac49e77, 3 files, every one a TEST or a PIN, all ruled:
//   test/test-gCompat.js | 8 — V1 (bb63af1), the vocabulary campaign's own test edit;
//   test/test-labelCensus.js | 3, test/acceptance/expectedLabelCensus.json | 15 — M1's supervisor-owned G-LABEL-CENSUS append of
//     sif260928 (33f274c, plan §3 M1, review #18).
// No framework SOURCE file under lib/forge-framework/ moved in the SIF replacement. THE PATH IS UNCHANGED, NO EXCLUSION IS ADDED.
// Fresh red observed against THIS tag (DEVLOG-M1).
// ═══ RE-ANCHOR (iii), 2026-09-29 (IVORY_MIRROR; RULING EBONY_DREAM), SIF replacement phase B6 ═══
// postM1ForgeFrameworkIii-092926 -> postB6ForgeFrameworkIii-092926, tag cut ON this re-anchor commit. CENSUS (git diff --stat
// postM1ForgeFrameworkIii-092926 -- lib/forge-framework/) at B6's head 803d4b0: exactly ONE file, a TEST, ruled:
//   test/test-gSeamUntouched.js | 12 — B6's G-SEAM-UNTOUCHED re-anchor (803d4b0, tag postB6GSeamUntouched-092926), itself forced by
//     B6's harvest fix in its seam files. This is the trap recorded above: that file sits in (iii)'s watched set with no exclusion.
// No framework SOURCE file under lib/forge-framework/ moved in B6. THE PATH IS UNCHANGED, NO EXCLUSION IS ADDED. Fresh red observed
// against THIS tag (DEVLOG-B6).
// PESC F5 RE-ANCHOR OF (iii) (AMBER_PORTAL, 2026-10-01; seam re-anchors PRE-AUTHORISED for the PESC campaign by QUIET_ORBIT,
// NOTES-supervisor item 5; the framework change itself ruled by QUIET_ORBIT for F5). postB6ForgeFrameworkIii-092926 ->
// postPescF5ForgeFrameworkIii-100126, tag cut ON this re-anchor commit. CENSUS (git diff --stat postB6ForgeFrameworkIii-092926
// -- lib/forge-framework/) at 39f0502: exactly TWO files, both the ruled framework fix (commit 39f0502):
//   roundTripHarness/roundTripHarness.js | 6 — a verdict written with a graphIdentity also carries it as .graph (goldEvalCheck reads it)
//   roundTripHarness/test/test-gRt.js    | 30 — G-RT conjunct endpointWhereCertificationReadsIt and its red twin
// THE PATH IS UNCHANGED, NO EXCLUSION IS ADDED. Fresh red observed against THIS tag (DEVLOG-F5).
// goldJev LANE F RE-ANCHOR OF (iii) (PRISM_LATTICE, 2026-10-02; pre-authorised, NOTES-supervisor item 5): postPescF5ForgeFrameworkIii-100126
// -> postEdfiCrosswalkOutFForgeFrameworkIii-100226, tag cut ON this re-anchor commit. CENSUS (git diff --stat
// postPescF5ForgeFrameworkIii-100126 -- lib/forge-framework/) at 0580451: exactly ONE file, a TEST FIXTURE:
//   test/acceptance/expectedFingerprints.json | 4 — the edfi PROXY re-pin 814ce961… -> 04abc77b… (f8ea687), the RULED crosswalk exclusion.
// No framework SOURCE file under lib/forge-framework/ moved. THE PATH IS UNCHANGED, NO EXCLUSION IS ADDED. Fresh red observed
// against THIS tag (DEVLOG-F).
// mappingProvenance LANE P RE-ANCHOR of (iii) (VIOLET_OCEAN, 2026-10-04; pre-authorised): postEdfiCrosswalkOutFForgeFrameworkIii-100226
// -> postMappingProvenancePForgeFrameworkIii-100426, tag cut ON this commit. CENSUS (git diff --stat ... -- lib/forge-framework) at
// 94c2a9c: ONE file, lib/forge-framework/test/test-gSeamUntouched.js 11 — its own re-anchor to postMappingProvenancePGSeamUntouched-100426
// (94c2a9c). lib/forge-framework SOURCE: UNTOUCHED. Fresh red observed on 94c2a9c (DEVLOG-P). The ELEVENTH anchor.
// leftovers LANE R RE-ANCHOR of (iii) (EMERALD_OCEAN, 2026-10-05; pre-authorised): postMappingProvenancePForgeFrameworkIii-100426 ->
// postLeftoversRForgeFrameworkIii-100526, tag cut ON this commit. CENSUS (git diff --stat ... -- lib/forge-framework/) at cb9e360: SIX
// files, and FOR THE FIRST TIME SINCE THE ANCHOR EXISTED TWO ARE FRAMEWORK SOURCE, BY RULING (TQ's 2026-10-04 TODO: a standard's kind
// and usage tips belong in its own forge declaration, so the declaration contract and the root builder must carry them):
//   forgeDeclarationContract.js 10 (standardKind closed over STANDARD_KIND_LIST, standardUsageTips string-or-null, both required),
//   rootNode.js 6 (stamps both on the root; null tips = no property), and four tests: toyForgeDeclaration.js 4 (the fixture declares
//   both), acceptance/expectedFingerprints.json 12 (the five PROXY re-pins, d84bd9a), test-gSeamUntouched.js 11 (its own re-anchor),
//   test-gStandardMetadata.js 134 (new). No other framework module moved. THE PATH IS UNCHANGED, NO EXCLUSION IS ADDED. Fresh red
//   observed on d39755c (DEVLOG-R). The TWELFTH anchor.
// campaign P0 RE-ANCHOR of (iii) (SILVER_ECHO, 2026-10-06; pre-authorised): postLeftoversRForgeFrameworkIii-100526 ->
// postCampaignP0ForgeFrameworkIii-100626, tag cut ON this commit. CENSUS (git diff --stat ... -- lib/forge-framework/) at 7139d8c: ONE
// file, lib/forge-framework/test/test-gSeamUntouched.js 11 — its own re-anchor to postCampaignP0GSeamUntouched-100626 (0d6ffd9).
// lib/forge-framework SOURCE: UNTOUCHED. THE PATH IS UNCHANGED, NO EXCLUSION IS ADDED. Fresh red observed on the re-anchor commit
// (DEVLOG-P0). The THIRTEENTH anchor.
// campaign P2 RE-ANCHOR of (iii) (CARDINAL_RIVER, 2026-10-06; pre-authorised, VIOLET_VALLEY 17:42Z standing rule):
// postCampaignP0ForgeFrameworkIii-100626 -> postCampaignP2ForgeFrameworkIii-100626, tag cut ON this commit. CENSUS (git diff --stat
// ... -- lib/forge-framework/) at 589f59c: FIVE files, THREE OF THEM FRAMEWORK SOURCE, each a ruled campaign P2 entry:
//   contractGraphKit.js 12 (W-C-15: the kit refuses a precedingProperties collision by name), forge-framework.js 10 (W-A-10: the
//   integrity pass reads REQUIRED_PROPERTIES.NODE_BY_ROLE_CLASS), roundTripHarness/verdictAssembler.js 25 (W-C-14: the normative
//   verdict field list and its shape check), and two tests: test-gKit.js 17 (the W-C-15 conjunct; G-KIT twin re-anchored for W-A-10)
//   and test-gSeamUntouched.js 17 (its own re-anchor, 589f59c). THE PATH IS UNCHANGED, NO EXCLUSION IS ADDED. Fresh red observed on
//   the re-anchor commit (DEVLOG-P2). The FOURTEENTH anchor.
// campaign P2 SECOND RE-ANCHOR of (iii) (CARDINAL_RIVER, 2026-10-06; pre-authorised): postCampaignP2ForgeFrameworkIii-100626 ->
// postCampaignP2ForgeFrameworkIiiB-100626, tag cut ON this commit. CENSUS at 65d1725: ONE file, test/test-gSeamUntouched.js 6 — its own
// second re-anchor. lib/forge-framework SOURCE: unchanged since the first P2 anchor. Path unchanged, no exclusion. The FIFTEENTH anchor.
// campaign P2 THIRD RE-ANCHOR of (iii) (CARDINAL_RIVER, 2026-10-06; pre-authorised): -> postCampaignP2ForgeFrameworkIiiC-100626, tag ON
// this commit. CENSUS: ONE file, test/test-gSeamUntouched.js 4 — its own third re-anchor. Framework SOURCE unchanged. The SIXTEENTH anchor.
// ═══ RE-ANCHOR, 2026-10-06 (CARDINAL_HORIZON; campaign P3, (iii); pre-authorised by the P3 work order) ═══ postCampaignP2ForgeFrameworkIiiC-100626 ->
// postCampaignP3ForgeFrameworkIii-100626, tag cut ON this commit. CENSUS at HEAD before the move (git diff --shortstat postCampaignP2ForgeFrameworkIiiC-100626 over this gate's own
// paths): 11 files changed, 162 insertions(+), 37 deletions(-); 11 file(s) — the P3 entries W-B-1..14, W-C-1..17, ruling B (DEVLOG-P3). Path list
// byte-identical; nothing excluded.
// ═══ RE-ANCHOR, 2026-10-07 (GOLDEN_ECHO; campaign P4b, (iii); pre-authorised by the P4 work order) ═══ postCampaignP3ForgeFrameworkIii-100626 ->
// postCampaignP4bForgeFrameworkIii-100726, tag cut ON this commit. CENSUS at HEAD before the move: 2 files — lib/forge-framework/embedPass.js (W-C-19: the top-level mirror
// removed) and test/test-gEmbed.js (its conjunct vectorRidesInPropertiesOnly). Path list byte-identical; nothing excluded.
// RE-ANCHOR 2026-10-07 (GOLDEN_ECHO, campaign P4b, (iii), second; pre-authorised): postCampaignP4bForgeFrameworkIii-100726 -> postCampaignP4bForgeFrameworkIiiB-100726, tag ON this
// commit. CENSUS: ONE file, lib/forge-framework/test/test-gSeam.js 4/2 — the fleet p4b-2 finding (its conjunct demanded the mirror W-C-19 removed).
// ═══ RE-ANCHOR, 2026-10-07 (BRONZE_SIGNAL; G21 omission declaration; pre-authorised by WORKORDER-G21) ═══ (iii) postCampaignP4bForgeFrameworkIiiB-100726 ->
// postCampaignG21ForgeFrameworkIii-100726, tag cut ON this commit. CENSUS at c049bc8 (lib/forge-framework/): 4 files —
// roundTripHarness/verdictAssembler.js (the G21 verdict shape), roundTripHarness/roundTripHarness.js (omissionDeclaration),
// roundTripHarness/test/test-gRt.js and test/fixtures/toyForge/lib/toyRoundTripPair.js (fixtures). Nothing excluded.
// ═══ RE-ANCHOR, 2026-10-07 (BRONZE_SIGNAL; G21b comment text; pre-authorised) ═══ (iii) postCampaignG21ForgeFrameworkIii-100726 -> postCampaignG21bForgeFrameworkIii-100726,
// tag ON this commit. CENSUS at cce29e1 (lib/forge-framework/): 3 files, 30+/3- — verdictAssembler.js (text-bearing kinds),
// test-gRt.js and toyRoundTripPair.js (the two new declaration members). Nothing excluded.
// ═══ RE-ANCHOR, 2026-10-08 (PRISM_CASCADE; forgeClean lane CLEAN; pre-authorised) ═══ (iii) postCampaignG21bForgeFrameworkIii-100726 ->
// postForgeCleanForgeFrameworkIii-100826, tag ON this commit. CENSUS at 0440fe7 (lib/forge-framework/): ONE file, test/test-gSeamUntouched.js — its own
// G-SEAM-UNTOUCHED re-anchor (12babd9). Framework SOURCE unchanged; nothing excluded.
// ═══ RE-ANCHOR, 2026-10-08 (ONYX_SUMMIT; forgeClean lane REFORGE; pre-authorised) ═══ (iii) postCampaignG21bForgeFrameworkIii-100726 ->
// postForgeCleanReforgeForgeFrameworkIii-100826, tag cut ON this commit. CENSUS at 39669479: ONE file, lib/forge-framework/test/test-gSeamUntouched.js
// 4/1 (REFORGE's own G-SEAM-UNTOUCHED re-anchor comment and tag constant). No forge-framework source touched.
// ═══ RE-ANCHOR AT THE MERGE, 2026-10-08 (PRISM_CASCADE; forgeClean R4 merge of lanes CLEAN d2aa1ab8 and REFORGE 89b25f55; pre-authorised by
// WORKORDER-R4) ═══ (iii): both lanes' anchors above -> postForgeCleanMergeForgeFrameworkIii-100826, tag cut ON the merge commit. CENSUS: the union of the two lanes'
// censuses above, and nothing else (the merge resolved only these anchor conflicts). Path list byte-identical; nothing excluded.
const PHASE0_ANCHOR_TAG = 'postForgeCleanMergeForgeFrameworkIii-100826'; // re-anchored at the forgeClean merge by PRISM_CASCADE; the tag is cut ON the merge commit
// PHASE 1 RE-ANCHOR — RULING FJ-P1-1, and it moves seamDiffEmpty ALONE.
//
// WHY IT HAD TO MOVE. SEAM_PATH_LIST watches forges/*/forge*.js, forges/*/lib/*Declaration.js and
// forges/*/lib/*Hooks.js. A FORGE MIGRATION NECESSARILY TOUCHES ALL THREE, so Phase 1 (CEDS onto
// lib/forge-framework) could not leave this conjunct green against the Phase 0 anchor. The gate is
// not wrong; it watches forge files precisely so that a forge migration is a deliberate, ruled act
// rather than a silent one. Cause, named in the gate's own data rather than only in a DEVLOG:
// commit 2615522, "Phase 1 — CEDS forge on the framework", which rewrote forgeCeds.js (986 lines
// changed) and added lib/cedsForgeDeclaration.js, lib/cedsHooks.js and lib/forgeCedsContractGraph.js.
// The migration reproduced the CEDS block id byte-identically (09a5d658…487c33, 419,649,468) with
// no framework edit, so nothing about the SEAM itself moved — only the forge files the gate watches.
//
// (iii) DELIBERATELY DOES NOT MOVE, and refusing to move it is the point. It measures
// lib/forge-framework/, which Phase 1 did NOT touch, so it is GREEN against PHASE0_ANCHOR_TAG and
// moving a baseline that does not need to move is how a baseline stops meaning anything. Measured
// before this edit: `git diff --name-only postPescReembed-082926 -- lib/forge-framework/` is EMPTY.
// (i) and (ii) keep their own bases for their own reasons, recorded above.
//
// THE BASELINE MOVES; SEAM_PATH_LIST IS NOT WIDENED. The path list is byte-identical, the
// :!lib/forge-framework/test/test-gSeamUntouched.js exclusion included — STANDDOWN-P0 C.1 warns that
// it now LOOKS redundant because (iii) covers that file with no exclusion, and that tidying it away
// would silently widen this conjunct. Left exactly as it was.
//
// THE TAG IS AT COMMIT A, NOT AT ITS PARENT. FJ-P0-1's first issue named the parent of the
// collision-causing commit and had to be corrected on measurement; the same off-by-one here would
// leave this conjunct red against a base that predates the change it was moved to absorb.
//
// THE SEAM GATES NOW ANCHOR AT THREE POINTS, which is expected and correct — each gate anchors where
// its own ruled edits live:
//   seamDiffEmpty        -> postCedsForgeMigration-082926 at 2615522  (Phase 1 Commit A)
//   (iii)                -> postPescReembed-082926        at 75d5470  (Phase 0 Commit A)
//   BG-COMPOSE-PESC (a)  -> postBgSeamReanchor-082926     at 3e9cd1f  (Phase 0 Commit B)
//
// STANDING RULE (FJ-P1-1): EVERY forge migration phase re-anchors this conjunct the same way, so
// Phases 3 (SIF) and 4 (PESC) do not rediscover the collision.
const PHASE1_ANCHOR_TAG = 'postCedsForgeMigration-082926'; // superseded as seamDiffEmpty's base by
// PHASE3_ANCHOR_TAG below; retained so the move is legible without the log.
// ── SECOND PHASE 1 RE-ANCHOR, RULING FJ-P1-3 ─────────────────────────────────────────────────────
// SEAM_PATH_LIST IS BROADER THAN IT READS, AND THAT IS WHY THIS SECOND MOVE WAS NEEDED.
// A git pathspec's `*` CROSSES `/`. So `forges/*/forge*.js` does NOT mean "the forge entry module of
// each kit" — MEASURED with `git ls-files -- 'forges/*/forge*.js'`, it matches SIX files, two of them
// nested under lib/:
//     forges/ceds/forgeCeds.js
//     forges/ceds/lib/forgeCedsContractGraph.js       <-- not what the pattern reads like
//     forges/edfi/forgeEdfi.js
//     forges/edfi/lib/forgeEdfiContractGraph.js       <-- in scope since the Ed-Fi migration
//     forges/pesc260805/forgePesc260805.js
//     forges/sif/forgeSif.js
// This conjunct's own title says "forge entry/declaration/hooks files", which understates it. Both
// the supervisor's ruling and the independent review read the glob as shell and concluded that
// Commit D's edit to forgeCedsContractGraph.js was outside this gate. RUNNING IT SHOWED OTHERWISE:
//     FAIL seamDiffEmpty -> NON-EMPTY: forges/ceds/lib/forgeCedsContractGraph.js | 32 +++++-------
//     test-bgNosub: 55/60, EXIT=1, 24/25 conjuncts observed red
// The broader coverage is arguably BETTER and is deliberately NOT narrowed here; the title is
// docketed for a post-campaign fix. What is recorded is that a builder trusting the TITLE will be
// wrong about which edits move this gate.
//
// CAUSE, named in the gate's own data: commit 37473dc, "Phase 1 S3 — the walk reads standardSource
// from H1 instead of re-typing it", 22 insertions / 10 deletions. It was byte-neutral and PROVEN so
// (I1 09a5d658…487c33 at 419,649,468 IDENTICAL on a full re-forge), so nothing about the seam's
// BEHAVIOUR moved — only a file this gate watches.
//
// (iii) STILL DOES NOT MOVE. It measures lib/forge-framework/, untouched by Phase 1; a baseline that
// moves without needing to has stopped meaning anything. SEAM_PATH_LIST remains BYTE-IDENTICAL.
//
// SEQUENCING LESSON FOR PHASES 3 AND 4, now in the PLAN: HOLD THE ANCHOR TAG UNTIL THE REVIEW'S CODE
// FINDINGS ARE IN. This second pair of re-anchor commits exists only because S3 arrived from review
// after Commit A had already been tagged.
// PHASE 2a RE-ANCHOR (SILVER_TIDE, 2026-08-29; ruling R-HUB-1 + the standing FJ-P1-1 pattern).
// seamDiffEmpty's base moves from postCedsForgeS3-082926 (37473dc) to post2aHubDiscovery-082926
// (7db272c). CAUSE, named in the gate's own data rather than left to the log: Phase 2a's ruled edit
// deletes HUB_FORGE_BY_STANDARD from apps/graph-builder/apps/forger/forger.js and adds the I7b
// refusal to apps/graph-builder/lib/build.js — BOTH are in SEAM_PATH_LIST, and so is
// apps/graph-builder/apps/forger/test/test-forger.js, which had to migrate off the deleted registry.
// Measured, the non-empty diff was exactly those three files (141 / 101 / 54 lines).
//
// THE BASELINE MOVES; THE PATH LIST DOES NOT. SEAM_PATH_LIST is byte-identical, the
// :!lib/forge-framework/test/test-gSeamUntouched.js exclusion is deliberately left in place
// (STANDDOWN-P0 C.1), and no conjunct's scope is widened. Verified before editing, by RUNNING it and
// not by reading it, that PHASE3_ANCHOR_TAG reaches gitDiffStat and gitDiffStat serves
// seamDiffEmpty ALONE — (ii) uses POST_D1_BASE_TAG over lib/vocabulary/ and (iii) uses
// PHASE0_ANCHOR_TAG over lib/forge-framework/, each with its own spawnSync.
//
// PREVIOUS BASE, in full, so the move is legible without the log:
//   postCedsForgeS3-082926 @ 37473dcd0ba6a3d2ba0e7cbebe5c62b26f3f1d0b (Phase 1 Commit D)
// PHASE 2c RE-ANCHOR (SILVER_TIDE, 2026-08-29). post2aHubDiscovery-082926 (7db272c) ->
// post2cHubExtraction-082926 (3eb4855). CAUSE, named in the gate's own data and MEASURED with the
// gate's own command rather than predicted — five watched files moved, and two of them are ones a
// reader would not expect:
//   apps/graph-builder/apps/forger/test/test-forger.js   the require migrated to ../hubCeds
//   forges/ceds/lib/cedsHubDeclaration.js   NEW — matches forges/*/lib/*Declaration.js
//   forges/ceds/lib/cedsHubHooks.js         NEW — matches forges/*/lib/*Hooks.js
//   forges/ceds/lib/forgeCedsContractGraph.js  <-- matched by forges/*/forge*.js BECAUSE A GIT
//     PATHSPEC'S * CROSSES '/'. A comment-only edit, and it still moves this gate. This is the
//     Phase 1 lesson arriving a third time: measure the watched set by RUNNING git ls-files.
//   forges/ceds/lib/cedsForgeDeclaration.js    a comment correction, and *Declaration.js is watched
//
// THE BASELINE MOVES; THE PATH LIST DOES NOT. SEAM_PATH_LIST byte-identical; the
// :!lib/forge-framework/test/test-gSeamUntouched.js exclusion left in place (STANDDOWN-P0 C.1).
//
// NOT MOVED, and each verified EMPTY with its own command before this edit: (ii) — lib/vocabulary/'s
// only change is vocabulary.js, which (ii) permits; (iii) — lib/forge-framework/ is untouched by 2c;
// G-SEAM-UNTOUCHED — forger.js and build.js have not moved since 7db272c, which is exactly why the
// stale comment at forger.js:422 was DOCKETED rather than fixed.
//
// PREVIOUS BASE, in full: post2aHubDiscovery-082926 @ 7db272c40e4d47da3b509e886f5f06e1f574f2eb.
// RE-ANCHOR, hub-kit-role Phase 3, standing rule FJ-P1-1. seamDiffEmpty's base moves from
// post2cHubExtraction-082926 to post3SifForgeMigration-082926 (343d82e), the SIF forge migration
// commit itself and NOT its parent — a migration that ADDS files reads as an EMPTY diff until they
// are tracked, so the tag must sit AT the commit.
//
// WHY IT HAD TO MOVE. SEAM_PATH_LIST watches forges/*/forge*.js, forges/*/lib/*Declaration.js,
// forges/*/lib/*Hooks.js AND lib/forge-framework/. A forge migration necessarily touches the first
// three; Phase 3 also carried the ruled S2 registry correction (FJ-P3-2) and the new label-census
// gate, both under the fourth. Measured at the tagged commit: EIGHT files in the diff.
//
// AND THE CONSTANT IS RENAMED, WHICH IS A FIX RATHER THAN A FLOURISH. It was PHASE3_ANCHOR_TAG
// and had been holding a PHASE 2c value since that phase — a name that lies about its own contents,
// which the Phase 2 handoff had to warn readers about in capitals ("the CONSTANT NAME still says
// PHASE1_S3 but its VALUE is the 2c tag. Read the value."). Verified by grep before renaming that
// PHASE3_ANCHOR_TAG reaches gitDiffStat and gitDiffStat serves seamDiffEmpty ALONE, so this move
// touches no other conjunct; (iii) keeps its own PHASE0_ANCHOR_TAG and does NOT move here.
//
// THE BASELINE MOVES; THE PATH LIST DOES NOT. SEAM_PATH_LIST is byte-identical across this commit
// (md5 38bd6a0da66ca6cff8e07459d9b4b160 before and after), the :!test-gSeamUntouched.js exclusion is
// deliberately left in place per STANDDOWN-P0 C.1, and nothing is widened.
// ⚠ MOVED 2026-08-29 by TWILIGHT_GATE (Phase 4, ruling FJ-P1-1 pattern). THE BASELINE MOVES; THE
// PATH LIST DOES NOT. SEAM_PATH_LIST is byte-identical across this commit — the PESC migration
// necessarily rewrote forges/pesc260805/forgePesc260805.js and added three files under
// forges/pesc260805/lib/, all four inside the watched globs, so "seamDiffEmpty green" was
// unachievable in this phase without a re-anchor. That is the deliberate move this mechanism exists
// to make legible, and it is the same move Phases 1, 2c and 3 each made for their own migration.
//
// ⚠ MOVED AGAIN 2026-08-29 by WILD_SHARD (Phase 7, RULING FJ-P7-3), and the reason is NARROWER than
// any move before it. SEAM_PATH_LIST is again BYTE-IDENTICAL across this commit. Phase 7 migrates no
// forge and touches nothing under lib/forge-framework/ — its ENTIRE intersection with the watched set
// is ONE FILE, apps/graph-builder/lib/build.js, gaining the pre-spend declaration-collision refusal
// that RULING FJ-P7-1 placed before phase A. Measured with this conjunct's own command at the commit:
// 1 file, 78 insertions, 0 deletions, and nothing else in the list moved.
//
// THE CONSTANT'S NAME IS HISTORICAL AND IS DELIBERATELY NOT RENAMED. It has said PHASE3 since Phase 3
// and has been re-anchored by Phases 4 and 7 since; renaming it would put a byte in this file for a
// cosmetic reason, and this file sits inside BG-COMPOSE (a)'s diffed paths. The TAG it names is the
// authority, never the identifier.
//
// ═══ RE-ANCHOR, 2026-09-01 (GRANITE_ECHO), graphSelfDoc campaign close ═══
// post7OptInDiscriminator-082926 / post7GSeamReanchor-082926 / derivedBridgeD1-081726
//   -> postGraphSelfDoc-090126 (4b122b0)
//
// FOUR AUTHORISED COMMITS landed past the old anchors and each moved a watched scope:
//   170e16a  Phase 6 prose only
//   f87f7da  versionFromStamp — the forge framework reads the version from the stamp
//   d0879c0  the SIF provenance data edit that change reads
//   4b122b0  graphSelfDoc — replayManager's finish verb, the finishing tree, vocabulary terms
//
// WHICH CONJUNCTS MOVE, AND WHICH DELIBERATELY DO NOT — the same discipline as every re-anchor
// above: a baseline that moves without needing to is a baseline that has stopped meaning anything.
//   * seamDiffEmpty  MOVES (PHASE3_ANCHOR_TAG). 13 files under SEAM_PATH_LIST moved — the whole
//                    finishing tree, build.js, interfaces.js, replayManager.js. It is a "nothing
//                    has moved since" assertion and is meaningless against a base that predates
//                    authorised moves.
//   * (iii)          MOVES (PHASE0_ANCHOR_TAG). versionFromStamp moved 8 files under
//                    lib/forge-framework/. Same shape, same reason.
//   * (ii)           MOVES ITS BASE (POST_D1_BASE_TAG) AND NOTHING ELSE. graphSelfDoc added
//                    vocabulary terms, which touched lib/vocabulary/vocabulary-definitions.js —
//                    OUTSIDE its allowed set {vocabulary.js, test/}. ⚠ THE ALLOWED-PATH LIST WAS
//                    NOT WIDENED. Adding that file to the list would hand back permanently the
//                    blind spot the list exists to hold; the base moves so the authorised edit is
//                    INSIDE it, and the scope stays exactly as strict as it was.
//   * (i)            SPLIT, and its historical half does NOT move — see the note at the split.
//
// BASE_TAG (preBridgeFramework-081626) IS UNTOUCHED. It is (i)'s window onto the B2 bridgeMaker
// migration, and moving it would make that claim vacuous — the identical reasoning the Phase 0
// note gives for refusing to move (i) then.
//
// FRESH RED OBSERVATION: every twin in this family was re-observed red against THIS tag before
// the move was accepted. A re-anchor without one is a gate nobody has proven still works.
//
// ═══ RE-ANCHOR, 2026-09-02 (GRANITE_ECHO), stand-down backlog close ═══
// postGraphSelfDoc-090126 -> postBacklogChainHead-090226 (058f5e6)
//
// CAUSE: three authorised commits landed prose into watched paths — 5a5eddc (Lane B, the Profile
// and framework-spec corrections), 87fafd1 (Lane A, the p0b lever/proxy repairs and test-gCompat's
// faithfulness repair), and 058f5e6 (the batched finisher-header, guard-invariant and emitted-string
// corrections). COMMENT AND DOCUMENTATION TEXT ONLY; node --check clean; no executable line moved.
//
// ONLY THE TWO CONJUNCTS THAT EXPIRED MOVE, and the discipline is the same as every re-anchor above:
//   * seamDiffEmpty  MOVES — apps/graph-builder/apps/replay-manager/ (the finishing tree) and
//                    lib/forge-framework/ both gained prose. It is a "nothing has moved since"
//                    assertion and says nothing useful against a base that predates authorised moves.
//   * (iii)          MOVES — lib/forge-framework/ gained forge-framework.js's invariant comment and
//                    test-gDecl.js's one ruled comment line. Same shape, same reason.
//   * (i) and (i-live) DO NOT MOVE. interfaces.js was not touched by any of the three commits, so
//                    neither the migration-window claim nor the live COMPONENT_SHAPES comparison has
//                    expired. A baseline that moves without needing to has stopped meaning anything.
//   * (ii)           DOES NOT MOVE. lib/vocabulary/ was not touched either.
// NO ALLOWED-PATH LIST WAS WIDENED. Every twin in this family was re-observed red against THIS tag
// before the move was accepted — a re-anchor without a fresh red observation is a gate nobody has
// proven still works.
// RE-ANCHOR 2026-09-02 (provability sweep). ONLY seamDiffEmpty's base moves, to 75b4eef, the
// commit that replaced three build.js:NNNN coordinates with stable site tokens in
// manifest-recipe-finisher.js — 1 file, 12 insertions, 3 deletions, entirely inside
// replay-manager/. NO ALLOWED-PATH LIST WAS WIDENED and no exclusion was added. Conjunct (iii)
// keeps PHASE0_ANCHOR_TAG and does NOT move: it watches lib/forge-framework/, which this commit did
// not touch, and it stayed GREEN through the run that turned seamDiffEmpty red. Verified by grep
// that PHASE3_ANCHOR_TAG reaches gitDiffStat and gitDiffStat serves seamDiffEmpty ALONE.
// THE ACCEPTANCE TEST FOR THIS MOVE IS NOT A PASSING SUITE. While seamDiffEmpty's baseline was
// FAILING, its twin could not demonstrate a green-to-red TRANSITION and correctly refused — the run
// reported 25/26 conjuncts observed red. This re-anchor is accepted only at 26/26: the gate green
// AND the twin able to prove it can still fail.
// RE-ANCHOR 2026-09-02 (SIF via-conservation order, TWILIGHT_ARROW). ONLY seamDiffEmpty's base moves,
// to postSifViaConservation-090226 (dec08ad): four authorised commits moved watched files past the
// old ref — the SIF forge carrying via/mandatory (forges/sif/lib), the replay engine merging on the
// full property map (lib/replay), the conservation gate at the harvest seam (replay-manager,
// build.js), and the runSifMaterialize re-key. NO ALLOWED-PATH LIST WAS WIDENED and no exclusion was
// added; SEAM_PATH_LIST is byte-identical across this commit. (The first draft of this note said
// PHASE0_ANCHOR_TAG does not move — copied from the previous re-anchor without checking; it did have
// to move, see its own note, because this commit touched lib/forge-framework/test/.) The
// acceptance for this move is the twin observed red against the NEW ref, never a passing suite.
// RE-ANCHOR 2026-09-02 (JOBS 5+6, TWILIGHT_ARROW): seamDiffEmpty's base moves to the head after JOBS 5+6 and their follow-on gate-and-test commits (dbf10bd, 243c3c9, 9b4d76a, 347928f). Ruled moves
// under SEAM_PATH_LIST: build.js, replay-engine.js, replayManager.js and the new test-conservationGate.js
// (JOB 2's suite gained the exemption census; JOB 6 added the artifact writer, the record and the audit).
// NO path list widened, NO exclusion added; SEAM_PATH_LIST byte-identical by git show. Twin re-observed
// red against THIS ref before acceptance (26/26).
// ⟪RE-ANCHOR — OCEAN_SUMMIT, 2026-09-10. postJudgeRegistryJob4b-090726 -> postNamedSubjectSet-091026 (021d1d7).⟫
//
// CAUSE, single and authorised: WORKORDER-namedSubjectSet-091026 added --subjectListFilePath, and the flag
// must be READ somewhere. apps/graph-builder/lib/build.js is where every operator flag is resolved and
// eagerly validated before a container is provisioned — and it is the first entry in SEAM_PATH_LIST. So the
// moment TQ authorised the named subject set, seamDiffEmpty could not stay green. 30 insertions, 2 deletions,
// in that one file; the census below was taken before the tag moved.
//
// CENSUS AT THE RE-ANCHOR (git diff --stat postJudgeRegistryJob4b-090726 -- <SEAM_PATH_LIST>):
//   apps/graph-builder/lib/build.js | 32 ++ (30 insertions, 2 deletions)   <- the ONE file
//   nothing else in the seam moved.
//
// ONLY THIS CONJUNCT MOVES. Conjunct (iii) watches lib/forge-framework/ from PHASE0_ANCHOR_TAG and that diff
// is EMPTY at this commit, so its baseline STAYS. A baseline that moves without needing to is a baseline that
// has stopped meaning anything. (i) and (ii) keep their own bases for their own reasons, unchanged.
//
// SEAM_PATH_LIST IS BYTE-IDENTICAL. No exclusion was added for build.js — that would retire the gate rather
// than re-anchor it. After this move an append to build.js is red again, which is what the twin still proves;
// the twin was re-observed RED against THIS tag before the move was committed. A re-anchor without a fresh red
// observation is a gate nobody has proven still works.
// ═══ RE-ANCHOR seamDiffEmpty (+ i_live), 2026-09-15 (RADIANT_QUEST), forge embed-text revision P8 (R-ET-6/7) ═══
// postNamedSubjectSet-091026 (021d1d7) -> postEmbedTextP7-091526. CENSUS AT THE RE-ANCHOR (git diff --stat postNamedSubjectSet-091026 --
// <SEAM_PATH_LIST>) at the merged head 44ceddc: 24 files, 2,538 insertions, 35 deletions, EVERY ONE a ruled campaign edit:
//   P3 (6b54b91)  lib/forge-framework/: the 15 files listed under (iii) above
//   P4 (7bfd1be, af8cfdc, b0f7d45)  apps/graph-builder/apps/forger/lib/shape-forged-graph.js | 67; lib/replay/replay-engine.js
//                 | 179; lib/replay/test/test-gVecProp.js (new, 1,132) and its two fixtures
//   P3 (6b54b91)  forges/sif/lib/sifForgeDeclaration.js | 1, forges/pesc260805/lib/pescForgeDeclaration.js | 1 — the
//                 embedTextDeclaration: null lines (R-ET-19)
//   P6 (0f18754)  forges/edfi/lib/edfiForgeDeclaration.js | 12, forges/ceds/lib/cedsForgeDeclaration.js | 13 — the declared lists
// plus, inside this tag: the P8 pin refresh (00735c4, under lib/forge-framework/test/acceptance/). build.js, forger.js,
// replay-block.js, replayManager.js, forges/*/forge*.js and forges/*/lib/*Hooks.js: UNTOUCHED.
// i_liveOtherComponentShapesUntouched reads the same tag and was GREEN against the old one (no component shape moved); it moves
// with the seam so the two conjuncts share one head, and its twin was re-observed red against THIS tag.
// THE PATH LIST IS BYTE-IDENTICAL, the :!test-gSeamUntouched.js exclusion left exactly as it was (STANDDOWN-P0 C.1). No
// exclusion was added for any campaign file — that would retire the gate rather than re-anchor it. Twin re-observed red.
// ═══ RE-ANCHOR seamDiffEmpty (+ i_live), 2026-09-15 (RADIANT_QUEST), forge embed-text revision P9 ═══
// postEmbedTextP7-091526 (53c2ff2) -> postEmbedTextP9-091526. CENSUS (git diff --stat postEmbedTextP7-091526 -- <SEAM_PATH_LIST>): 5 files, 83+/10−, all ruled:
//   forges/sif/lib/sifForgeDeclaration.js | 14, forges/pesc260805/lib/pescForgeDeclaration.js | 17 — P9's declarations (TQ decision 1;
//   OCEAN_ORBIT 06978fe, merged 76c5bed), the exact species FJ-P1-1 above says every forge phase re-anchors for;
//   lib/forge-framework/test/acceptance/{expectedBlockIds,expectedFingerprints,expectedLabelCensus}.json — the P9 re-pin (d457e8d).
// build.js, forger/, replay/, replay-manager/, forges/*/forge*.js, forges/*/lib/*Hooks.js and every framework source file: UNTOUCHED.
// i_live reads the same tag and was green against the old one (no component shape moved). PATH LIST BYTE-IDENTICAL, the
// :!test-gSeamUntouched.js exclusion left as it was; no exclusion added. Twin re-observed red against THIS tag.
// ═══ RE-ANCHOR seamDiffEmpty (+ i_live), 2026-09-29 (WILD_PORTAL for EBONY_DREAM), SIF replacement merge gate M1 ═══
// postEmbedTextP9-091526 -> postM1SeamDiffEmpty-092926, tag cut ON this re-anchor commit. CENSUS (git diff --stat
// postEmbedTextP9-091526 -- <SEAM_PATH_LIST>) on the merged head 128236b, 6 files, 210+/4−, every one ruled:
//   forges/sif260928/forgeSif260928.js | 34, lib/sif260928ForgeDeclaration.js | 67, lib/sif260928Hooks.js | 87 — the NEW sif260928
//     bundle (lane A: A1a d4b041d, A4 52df8c1, A5 347be9e), matched by forges/*/forge*.js and forges/*/lib/*{Declaration,Hooks}.js:
//     the FJ-P1-1 species, a forge phase re-anchors this conjunct;
//   lib/forge-framework/test/test-gCompat.js | 8 — V1 (bb63af1), the ruled vocabulary campaign's own test edit;
//   lib/forge-framework/test/test-labelCensus.js | 3 and test/acceptance/expectedLabelCensus.json | 15 — M1's supervisor-owned
//     G-LABEL-CENSUS append of sif260928 (33f274c, plan §3 M1, review #18).
// build.js, forger/, replay/, replay-manager/, every existing forge's entry/declaration/hooks files and every framework source file:
// UNTOUCHED. i_live reads the same tag and moves with it, as at every earlier move. PATH LIST BYTE-IDENTICAL, the
// :!test-gSeamUntouched.js exclusion left as it was; no exclusion added. Fresh red observed against THIS tag (DEVLOG-M1).
// ═══ RE-ANCHOR seamDiffEmpty (+ i_live), 2026-09-29 (IVORY_MIRROR; RULING EBONY_DREAM), SIF replacement phase B6 ═══
// postM1SeamDiffEmpty-092926 -> postB6SeamDiffEmpty-092926, tag cut ON this re-anchor commit. CENSUS (git diff --stat
// postM1SeamDiffEmpty-092926 -- <SEAM_PATH_LIST>) at B6's head ea07251, 3 files, 50+/9−, every one B6's own ruled harvest fix (7047e35):
//   apps/graph-builder/apps/replay-manager/replayManager.js | 8 — threads spec.edgeTypeList to the selector;
//   apps/graph-builder/lib/build.js | 15 — passes the block's harvestEdgeTypeList to the relationship harvest, refuses a block without one;
//   lib/replay/replay-engine.js | 36 — the optional edgeTypeList on the label selector.
// B6's test-gSeamUntouched.js re-anchor (803d4b0) is inside the path list's standing exclusion and does not appear. forger/, every
// forge's entry/declaration/hooks files and every framework source file under lib/forge-framework/: UNTOUCHED. i_live reads the same
// tag and moves with it (B6's interfaces.js change is JSDoc only). PATH LIST BYTE-IDENTICAL, no exclusion added. Fresh red observed
// against THIS tag (DEVLOG-B6).
// ═══ RE-ANCHOR seamDiffEmpty (+ i_live), 2026-09-30 (MARBLE_BRIDGE; RULING QUIET_ORBIT), PESC release forge phase F1 ═══
// postB6SeamDiffEmpty-092926 -> postPescF1SeamDiffEmpty-093026, tag cut ON this re-anchor commit. CENSUS (git diff --stat
// postB6SeamDiffEmpty-092926 -- <SEAM_PATH_LIST>) at F1's head 3b66069, 2 files, 41+/1−, both ruled:
//   forges/pesccollegetranscript1v8v0/forgePescCollegeTranscript1v8v0.js | 28 — the NEW PESC College Transcript 1.8.0 release
//     bundle (891565f), written by lib/pesc-release-forge/tools/scaffoldReleaseBundle.js, matched by forges/*/forge*.js: the
//     FJ-P1-1 species, a forge phase re-anchors this conjunct (every later PESC release bundle will be the same species);
//   apps/graph-builder/apps/forger/test/test-forger.js | 14 — the 'NO FORGE BUNDLE AT ALL' assertion re-anchored from an
//     alphabetical prefix of the roster to an order-free set check (3b66069, QUIET_ORBIT ruling (a)).
// The new bundle's lib/declaration.js and the shared lib/pesc-release-forge/hooks.js are outside the pathspecs (case-sensitive
// *Declaration.js / *Hooks.js; forges/* only). build.js, replay/, replay-manager/, every existing forge's entry/declaration/hooks
// files and every framework source file under lib/forge-framework/: UNTOUCHED. i_live reads the same tag and moves with it.
// PATH LIST BYTE-IDENTICAL, no exclusion added. Fresh red observed against THIS tag (DEVLOG-F1 §8.2).
// PESC F5 RE-ANCHOR (AMBER_PORTAL, 2026-10-01; pre-authorised, NOTES-supervisor item 5): postPescF1SeamDiffEmpty-093026 ->
// postPescF5SeamDiffEmpty-100126, tag cut ON this re-anchor commit. CENSUS (git diff --stat postPescF1SeamDiffEmpty-093026 -- the
// seam paths) at cceeeb2: exactly the two files of the ruled framework fix 39f0502, both under lib/forge-framework/roundTripHarness/
// (roundTripHarness.js 6, test/test-gRt.js 30). SEAM_PATH_LIST byte-identical. Fresh red observed against THIS tag (DEVLOG-F5).
// PESC F6 RE-ANCHOR (QUIET_CIPHER, 2026-10-01; pre-authorised, NOTES-supervisor item 5): postPescF5SeamDiffEmpty-100126 ->
// postPescF6SeamDiffEmpty-100126, tag cut ON this re-anchor commit. CENSUS (git diff --stat postPescF5SeamDiffEmpty-100126 -- the
// seam paths) at 99fcd04: exactly the six NEW PESC release bundles' entry modules (99fcd04), each 28+, written by the scaffold
// tool and matched by forges/*/forge*.js, the FJ-P1-1 species F1 foretold: forgePescHighSchoolTranscript1v6v0.js,
// forgePescTestScoreReport1v1v0.js, forgePescDocumentRequest1v0v0.js, forgePescDocumentResponse1v0v0.js,
// forgePescLearningRecord1v0v0.js, forgePescAcademicEportfolio1v0v0.js. Every existing forge's files, build.js, replay/,
// replay-manager/ and lib/forge-framework/: UNTOUCHED. SEAM_PATH_LIST byte-identical. Fresh red observed against THIS tag (DEVLOG-F6).
// PESC F6 SECOND RE-ANCHOR (QUIET_CIPHER, 2026-10-01; pre-authorised, NOTES 5): postPescF6SeamDiffEmpty-100126 ->
// postPescF6EportfolioSeamDiffEmpty-100126, tag cut ON this commit. CENSUS at d4fddd5: one file, 1+/1−,
// forges/pescacademiceportfolio1v0v0/forgePescAcademicEportfolio1v0v0.js — its header comment's DME title, rescaffolded after
// QUIET_ORBIT's display-name ruling ('PESC Academic ePortfolio v1.0.0'). SEAM_PATH_LIST byte-identical. Fresh red (DEVLOG-F6).
// goldJev LANE F RE-ANCHOR (PRISM_LATTICE, 2026-10-02; pre-authorised, NOTES-supervisor item 5): postPescF6EportfolioSeamDiffEmpty-100126
// -> postEdfiCrosswalkOutFSeamDiffEmpty-100226, tag cut ON this commit. CENSUS (git diff --stat postPescF6EportfolioSeamDiffEmpty-100126
// -- the seam paths) at dfc9d07: five files, all the RULED crosswalk exclusion (TQ 2026-09-10 and 2026-10-01; BRIEF-F), commits f8ea687 and
// 8de0657 (the refusal's form): forges/edfi/forgeEdfi.js 2 (a comment), forges/edfi/lib/edfiForgeDeclaration.js 36 (empty
// mappingInstruction, no sentinel, four E8 names), forges/edfi/lib/edfiHooks.js 63 (the crosswalk loader out),
// forges/edfi/lib/forgeEdfiContractGraph.js 232 (PASS 5 carriage -> the exclusion refusal), lib/forge-framework/test/acceptance/
// expectedFingerprints.json 4 (the edfi proxy re-pin). build.js, forger/, replay/, replay-manager/, every other forge and
// lib/forge-framework/ SOURCE: UNTOUCHED. SEAM_PATH_LIST byte-identical. Fresh red observed against THIS tag (DEVLOG-F).
// mappingProvenance LANE P RE-ANCHOR (VIOLET_OCEAN, 2026-10-04; pre-authorised, WORKORDER-mappingProvenance-100426 step 3):
// postEdfiCrosswalkOutFSeamDiffEmpty-100226 -> postMappingProvenancePSeamDiffEmpty-100426, tag cut ON this commit. CENSUS (git diff
// --stat postEdfiCrosswalkOutFSeamDiffEmpty-100226 -- the seam paths) at ab6a240: three files, all lane P 9bace1b, all under
// apps/graph-builder/apps/replay-manager/lib/finishing/: lib/standard-definition-finisher.js 47 (mappingDisposition read from the
// edges' mappingKind, never the relation type), lib/usage-pattern-finisher.js 19 (the mapping exemplar reads mappingKind and
// mappingSource first), test/test-standardDefinitionDisposition.js 146 (new, its gate). build.js, forger/, replay/, every forge
// and lib/forge-framework/: UNTOUCHED. SEAM_PATH_LIST byte-identical. Fresh red observed on ab6a240 before this commit (DEVLOG-P).
// mappingProvenance LANE P SECOND RE-ANCHOR (VIOLET_OCEAN, 2026-10-04; TQ reversed ruling A1; pre-authorised): ->
// postMappingProvenancePSeamDiffEmptyB-100426, tag cut ON this commit. CENSUS (git diff --stat postMappingProvenancePSeamDiffEmpty-100426
// -- the seam paths) at 3923467: six files, all lane P 3923467 — lib/replay/replay-engine.js 41 (GUARD 3: a mapping edge carries a
// valid mappingKind and NO provenanceTier; every other edge keeps the tier rule), lib/replay/test/test-write-shaped-graph.js 29 (its
// mapping cases and old-rule red), replay-manager/replayManager.js 4 (injects debugMappingSource), finishing/passport-writer.js 32
// (trust census by mappingKind/mappingSource), finishing/lib/usage-pattern-finisher.js 10 (caveat text), finishing/test/
// test-passportTrustVerdict.js 88 (new). build.js, forger/, every forge and lib/forge-framework/: UNTOUCHED. SEAM_PATH_LIST
// byte-identical. Fresh red observed on 3923467's tree before this commit (DEVLOG-P).
// mappingProvenance LANE P THIRD RE-ANCHOR (VIOLET_OCEAN, 2026-10-04; TQ-approved metadata additions; pre-authorised): ->
// postMappingProvenancePSeamDiffEmptyC-100426, tag cut ON this commit. CENSUS (git diff --stat postMappingProvenancePSeamDiffEmptyB-100426
// -- the seam paths) at f4ab2c4: seven files, all under replay-manager/lib/finishing/ — standard-definition-finisher.js 51
// (mappingKindList / mappingSourceList), usage-pattern-finisher.js 3, passport-writer.js 28 (rows by kind + source),
// promotion-stamp.js 208 (new), and three tests (test-passportTrustVerdict 11, test-promotionStamp 128 new,
// test-standardDefinitionDisposition 82). build.js, forger/, replay/, every forge and lib/forge-framework/: UNTOUCHED.
// SEAM_PATH_LIST byte-identical. Fresh red observed on f4ab2c4 (DEVLOG-P).
// mappingProvenance LANE P FOURTH RE-ANCHOR (VIOLET_OCEAN, 2026-10-04; pre-authorised): -> postMappingProvenancePSeamDiffEmptyD-100426,
// tag cut ON this commit. CENSUS (git diff --stat postMappingProvenancePSeamDiffEmptyC-100426 -- the seam paths) at cf58dfb: six
// files — replay-manager/lib/finishing/finishing.js 12 (reads configs/dmeStandardUsageTips.json), lib/standard-definition-finisher.js
// 22 (stamps standardKind + standardUsageTips), lib/standard-usage-tips.js 66 (new), two finishing tests (29, 91 new), and
// lib/forge-framework/test/test-gSeamUntouched.js 11 (its own re-anchor 94c2a9c, the ruled-test exception). build.js, forger/,
// replay/, every forge and lib/forge-framework SOURCE: UNTOUCHED. SEAM_PATH_LIST byte-identical. Fresh red observed (DEVLOG-P).
// leftovers LANE R RE-ANCHOR (EMERALD_OCEAN, 2026-10-05; pre-authorised): postMappingProvenancePSeamDiffEmptyD-100426 ->
// postLeftoversRSeamDiffEmpty-100526, tag cut ON this commit. CENSUS (git diff --stat postMappingProvenancePSeamDiffEmptyD-100426 -- the
// seam paths) at c420d5c: seventeen files, all lane R (d39755c, d84bd9a):
//   item 1 (kind + tips declared by each forge): forgeDeclarationContract.js 10, rootNode.js 6, five forge declarations (ceds 6,
//     edfi 6, sif 8, sif260928 6, pesc260805 7; the PESC release library is outside the seam paths), finishing.js 14 and
//     standard-definition-finisher.js 37 (read kind + tips from the root), standard-usage-tips.js -66 and test-standardUsageTips.js -91
//     (retired), test-standardDefinitionDisposition.js 45, toyForgeDeclaration.js 4, expectedFingerprints.json 12 (the ruled re-pins),
//     test-gStandardMetadata.js 134 (new);
//   item 2 (FINDING 5-A): build.js 85 and build-attestation-finisher.js 33 (the fidelity row is the runner's report).
// forger/, lib/replay/, every forge entry and hooks file: UNTOUCHED. SEAM_PATH_LIST byte-identical. Fresh red observed on d39755c (DEVLOG-R).
// campaign P0 RE-ANCHOR (SILVER_ECHO, 2026-10-06; pre-authorised, WORKORDER-P0-securityFoundations-100626 / NOTES 5):
// postLeftoversRSeamDiffEmpty-100526 -> postCampaignP0SeamDiffEmpty-100626, tag cut ON this commit. CENSUS (git diff --stat
// postLeftoversRSeamDiffEmpty-100526 -- the seam paths) at 0d6ffd9: ONE file, campaign P0 5b59b19 (W-C-11): build.js 36 (the vector
// cache path is handed down by actions.js's STORE_FAMILY_RESOLUTION_TABLE; build.js no longer reads the command line for it).
// forger/, lib/replay/, replay-manager/, every forge entry/declaration/hooks file and lib/forge-framework SOURCE: UNTOUCHED.
// SEAM_PATH_LIST byte-identical. Fresh red observed on the re-anchor commit (DEVLOG-P0).
// campaign P2 RE-ANCHOR of seamDiffEmpty (CARDINAL_RIVER, 2026-10-06; pre-authorised, VIOLET_VALLEY 17:42Z standing rule):
// postCampaignP0SeamDiffEmpty-100626 -> postCampaignP2SeamDiffEmpty-100626, tag cut ON this commit. CENSUS (git diff --stat
// postCampaignP0SeamDiffEmpty-100626 -- SEAM_PATH_LIST) at 33e2894: 32 files, 2815+/128-, EVERY ONE a campaign P2 entry — P2 IS the
// replay-time and finish-time phase, so the seam it may not touch silently is exactly the seam it was ordered to change:
//   replay engine: replay-engine.js 87 (W-A-1/2 lists and integers, W-A-9) + its two gates and two live-census fixtures;
//   replay manager: replayManager.js 21 (W-A-3, W-A-7); finishing.js 46 (W-A-5 self-doc fields, W-B-13/W-A-10/W-A-6 finishers
//     registered); passport-writer.js 353 (W-A-3 declared SET, censuses, W-A-4 Channel B, W-A-7); promotion-stamp.js 106 (W-A-9 index
//     rename, W-A-4); finishers: bridge-label (new, W-B-13), required-property (new, W-A-10), schema-view-coverage (new, W-A-6),
//     schema-view 81 (W-A-6), build-attestation 43 (W-A-4, R1 detail), usage-pattern 21 (W-A-7), manifest-recipe 5 (W-C-8);
//     nine finishing tests (seven new contract gates, test-promotionStamp, test-definitionCompleteness);
//   build.js 235 (see G-SEAM-UNTOUCHED's census, 589f59c); forger.js 3 + integration-forge.js 6 (W-C-21, W-A-11);
//   lib/forge-framework: the (iii) census above (fb4b303).
// No forge entry, declaration or hooks file moved. THE PATH LIST IS UNCHANGED, NO EXCLUSION IS ADDED. Fresh red observed on the
// re-anchor commit (DEVLOG-P2).
// campaign P2 SECOND RE-ANCHOR of seamDiffEmpty (CARDINAL_RIVER, 2026-10-06; pre-authorised): postCampaignP2SeamDiffEmpty-100626 ->
// postCampaignP2SeamDiffEmptyB-100626, tag cut ON this commit. CENSUS at 2e0513d: TWO files, both the self-audit fix fdc4167 —
// apps/graph-builder/lib/build.js 11 (roundTripRowFor refuses an unmeasured ran standard) and its gate,
// replay-manager/lib/finishing/test/test-attestationContract.js 11 (conjunct f). Path list unchanged, no exclusion.
// campaign P2 THIRD RE-ANCHOR of seamDiffEmpty (CARDINAL_RIVER, 2026-10-06; pre-authorised): postCampaignP2SeamDiffEmptyB-100626 ->
// postCampaignP2SeamDiffEmptyC-100626, tag cut ON this commit. CENSUS: ONE file, replay-manager/lib/finishing/test/
// test-selfDocFieldContract.js 13 (conjunct d, the fleet finding 462d922). No source file moved. Path list unchanged.
// campaign P2 FOURTH RE-ANCHOR of seamDiffEmpty (CARDINAL_RIVER, 2026-10-06; pre-authorised): -> postCampaignP2SeamDiffEmptyD-100626,
// tag ON this commit. CENSUS: lib/replay/replay-engine.js 6 and lib/replay/test/test-integerValuedProperties.js 9 — the fleet finding
// b2d390d and its gate. Path list unchanged.
// campaign P2 FIFTH RE-ANCHOR of seamDiffEmpty (CARDINAL_RIVER, 2026-10-06; pre-authorised): -> postCampaignP2SeamDiffEmptyE-100626, tag
// ON this commit. CENSUS: ONE file, replay-manager/lib/finishing/test/test-schemaViewContractProjection.js 19 (conjunct e, 6122536).
// ═══ RE-ANCHOR, 2026-10-06 (CARDINAL_HORIZON; campaign P3, seamDiffEmpty; pre-authorised by the P3 work order) ═══ postCampaignP2SeamDiffEmptyE-100626 ->
// postCampaignP3SeamDiffEmpty-100626, tag cut ON this commit. CENSUS at HEAD before the move (git diff --shortstat postCampaignP2SeamDiffEmptyE-100626 over this gate's own
// paths): 35 files changed, 494 insertions(+), 144 deletions(-); 35 file(s) — the P3 entries W-B-1..14, W-C-1..17, ruling B (DEVLOG-P3). Path list
// byte-identical; nothing excluded.
// ═══ RE-ANCHOR, 2026-10-07 (GOLDEN_ECHO; campaign P4b, seamDiffEmpty; pre-authorised by the P4 work order) ═══ postCampaignP3SeamDiffEmpty-100626 ->
// postCampaignP4bSeamDiffEmpty-100726, tag cut ON this commit. CENSUS at HEAD before the move: 8 files, 87+/23- — replayManager.js + test-replay-manager.js + x5LaunchProbe.js
// (X5), build.js (G17), cedsForgeDeclaration.js and replay-engine.js (W-C-18), embedPass.js + test-gEmbed.js (W-C-19). Path list
// byte-identical; nothing excluded.
// RE-ANCHOR 2026-10-07 (GOLDEN_ECHO, campaign P4b, seamDiffEmpty, second; pre-authorised): postCampaignP4bSeamDiffEmpty-100726 -> postCampaignP4bSeamDiffEmptyB-100726, tag ON this
// commit. CENSUS: ONE file, lib/forge-framework/test/test-gSeam.js 4/2 (the same finding).
// ═══ RE-ANCHOR, 2026-10-07 (BRONZE_SIGNAL; G21 omission declaration; pre-authorised by WORKORDER-G21) ═══ seamDiffEmpty postCampaignP4bSeamDiffEmptyB-100726 ->
// postCampaignG21SeamDiffEmpty-100726, tag cut ON this commit. CENSUS at c049bc8: 6 files, 183+/30- — build.js 12 (roundTripRowFor
// carries the declaration list), the three forge-framework sources and fixtures above, replay-manager's test-attestationContract.js 7.
// ═══ RE-ANCHOR, 2026-10-07 (BRONZE_SIGNAL; G21b comment text; pre-authorised) ═══ seamDiffEmpty postCampaignG21SeamDiffEmpty-100726 ->
// postCampaignG21bSeamDiffEmpty-100726, tag ON this commit. CENSUS at cce29e1: the same three forge-framework files (this gate's
// paths); build.js, forger/, replay/ and replay-manager/ untouched by G21b.
// ═══ RE-ANCHOR, 2026-10-08 (PRISM_CASCADE; forgeClean lane CLEAN; pre-authorised) ═══ seamDiffEmpty (and its (i-live) companion, which reads the
// same tag) postCampaignG21bSeamDiffEmpty-100726 -> postForgeCleanSeamDiffEmpty-100826, tag ON this commit. CENSUS at 12babd9 over this gate's paths:
// 6 files, 595+/28- — replay-manager/replayManager.js 261 (port lock, post-run and liveness checks, rm -f -v, scratch registry, exit watchdog,
// retain), its test/test-provisionPortRace.js 270 + testSupport/provisionPortRaceChild.js 53 (new) + test/test-replay-manager.js 14,
// lib/build.js 9 (the deliverable retained), forger/test/integration-forge.js 16 (-keepGraph retains). (i-live): replayManager's shape gained
// retain, declared in interfaces.js. Path list byte-identical; nothing excluded.
// ═══ RE-ANCHOR, 2026-10-08 (ONYX_SUMMIT; forgeClean lane REFORGE; pre-authorised by WORKORDER-REFORGE) ═══ seamDiffEmpty
// postCampaignG21bSeamDiffEmpty-100726 -> postForgeCleanReforgeSeamDiffEmpty-100826, tag cut ON this commit. CENSUS at d6fecdce: 3 files —
// build.js (--judgeCacheOnly; the roundTrip attestation detail names its summary relative to the run directory, REFORGE fix 2),
// replay-manager's promotion-stamp.js (stampable gates read from graph-contract) and its test-promotionStamp.js (conjunct h).
// ═══ RE-ANCHOR AT THE MERGE, 2026-10-08 (PRISM_CASCADE; forgeClean R4 merge of lanes CLEAN d2aa1ab8 and REFORGE 89b25f55; pre-authorised by
// WORKORDER-R4) ═══ seamDiffEmpty (and its (i-live) companion): both lanes' anchors above -> postForgeCleanMergeSeamDiffEmpty-100826, tag cut ON the merge commit. CENSUS: the union of the two lanes'
// censuses above, and nothing else (the merge resolved only these anchor conflicts). Path list byte-identical; nothing excluded.
const PHASE3_ANCHOR_TAG = 'postForgeCleanMergeSeamDiffEmpty-100826'; // re-anchored at the forgeClean merge by PRISM_CASCADE; the tag is cut ON the merge commit
const GIT_PREFIX = String(spawnSync('git', ['rev-parse', '--show-prefix'], { cwd: TREE_ROOT, encoding: 'utf8' }).stdout || '').trim();
const cloneJson = scenarioLib.cloneJson;
const CROSSWALK_PLUGIN_PATH = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyCrosswalkPlugin.js');
const listJs = (dirPath, recursive) => (fs.existsSync(dirPath) ? fs.readdirSync(dirPath, { withFileTypes: true }).reduce((soFar, oneEntry) => (oneEntry.isFile() && /\.js$/.test(oneEntry.name) ? soFar.concat([path.join(dirPath, oneEntry.name)]) : oneEntry.isDirectory() && recursive && oneEntry.name !== 'test' && oneEntry.name !== 'node_modules' ? soFar.concat(listJs(path.join(dirPath, oneEntry.name), true)) : soFar), []) : []);
const frameworkTreeOf = (scenario) => (scenario.frameworkTreeDirOverride === undefined ? scenarioLib.FRAMEWORK_DIR : scenario.frameworkTreeDirOverride);
const withScratchFrameworkCopy = (scenario, mutateCopy) => {
	const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeFrameworkScratch-'));
	listJs(scenarioLib.FRAMEWORK_DIR, false).forEach((oneFilePath) => fs.copyFileSync(oneFilePath, path.join(scratchDir, path.basename(oneFilePath))));
	mutateCopy(scratchDir);
	scenario.frameworkTreeDirOverride = scratchDir;
};
// the f-word, spelled so THIS file passes its own grep: the pieces joined at run time
const F_WORD_RE = new RegExp(['fall', '[- ]?', 'back', 's?', '|falling ', 'back'].join(''), 'i');
const STANDARD_TOKEN_RE = /\b(edfi|EdFi|sif|SIF|pesc|ceds)\b/;
// BG-NV (k). A LITERAL hub slot edge type — 'HAS_' + a hub name + '_' + a decomposition slot — slips past the token grep
// above, because underscores are word characters and the hub name is upper case. The slot list is READ from the
// vocabulary, so the census and hubEdgeType cannot disagree about which slots exist (SPEC-bridgeRevision §8 item 9, R-BR-9).
const LITERAL_HUB_EDGE_TYPE_RE = new RegExp(`\\bHAS_[A-Z0-9]+_(${vocabularyLib.HUB_DECOMPOSITION_SLOTS.join('|')})\\b`);
const F_WORD_EXEMPT_LIST = ['llmClient.js', 'debugJudge.js']; // UNCHANGED by RULING BF1; pre-existing occurrences, listed here by name

// ---------------------------------------------------------------------
// BG-NOSUB
// ---------------------------------------------------------------------
const nosubConjunctList = [
	pureConjunct({ conjunctId: 'lexical_fWordAbsent', title: `the f-word (any form) is absent from lib/bridge-framework/**, bridgeMaker.js, sourceWindow.js, evidenceContracts.js and every fixture plugin (comments included); EXEMPT by name (unchanged files, RULING BF1): ${F_WORD_EXEMPT_LIST.join(', ')}`, twinNameList: ['fWordInFrameworkFile'], judge: (scenario) => { const fileList = listJs(frameworkTreeOf(scenario), true).concat([path.join(BRIDGE_MAKER_DIR, 'bridgeMaker.js'), path.join(BRIDGE_MAKER_DIR, 'lib', 'sourceWindow.js'), path.join(BRIDGE_MAKER_DIR, 'lib', 'evidenceContracts.js')]).concat(listJs(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges'), false)); const offenderList = fileList.filter((oneFilePath) => F_WORD_RE.test(fs.readFileSync(oneFilePath, 'utf8'))); return { pass: offenderList.length === 0, detail: offenderList.length ? `f-word in ${offenderList.map((onePath) => path.basename(onePath)).join(', ')}` : `${fileList.length} files clean; exempt: ${F_WORD_EXEMPT_LIST.join(', ')}` }; } }),
	pureConjunct({ conjunctId: 'lexical_stubLoggerIdiomAbsent', title: 'the stub-logger idioms (a manufactured no-op xLog) are absent from the framework tree', twinNameList: ['stubLoggerInFrameworkFile'], judge: (scenario) => { const offenderList = listJs(frameworkTreeOf(scenario), true).filter((oneFilePath) => /xLog\s*=\s*\{\s*status:\s*\(\)\s*=>\s*\{\}|status:\s*\(\)\s*=>\s*\{\},\s*error:\s*\(\)\s*=>\s*\{\}/.test(fs.readFileSync(oneFilePath, 'utf8'))); return { pass: offenderList.length === 0, detail: offenderList.map((onePath) => path.basename(onePath)).join(', ') || 'clean' }; } }),
	pureConjunct({ conjunctId: 'lexical_perStandardTokensAbsent', title: 'per-standard tokens (edfi|EdFi|sif|SIF|pesc|ceds as whole words) are absent from lib/bridge-framework/** and the seam face', twinNameList: ['standardTokenInFrameworkFile'], judge: (scenario) => { const fileList = listJs(frameworkTreeOf(scenario), true).concat([path.join(BRIDGE_MAKER_DIR, 'bridgeMaker.js')]); const offenderList = fileList.filter((oneFilePath) => STANDARD_TOKEN_RE.test(fs.readFileSync(oneFilePath, 'utf8'))); return { pass: offenderList.length === 0, detail: offenderList.map((onePath) => `${path.basename(onePath)}: ${STANDARD_TOKEN_RE.exec(fs.readFileSync(onePath, 'utf8'))[0]}`).join(', ') || `${fileList.length} files clean` }; } }),
	pureConjunct({ conjunctId: 'k_noLiteralHubEdgeTypeInFrameworkTree', title: 'BG-NV (k): no LITERAL hub slot edge type (HAS_<HUB>_<slot>, slots read from vocabulary HUB_DECOMPOSITION_SLOTS) in lib/bridge-framework/** — every slot edge type resolves through hubEdgeType(hubName, slot) (R-BR-9)', twinNameList: ['injectLiteralHubEdge'], judge: (scenario) => { const fileList = listJs(frameworkTreeOf(scenario), true); const offenderList = fileList.filter((oneFilePath) => LITERAL_HUB_EDGE_TYPE_RE.test(fs.readFileSync(oneFilePath, 'utf8'))); return { pass: fileList.length > 0 && offenderList.length === 0, detail: offenderList.map((onePath) => `${path.basename(onePath)}: ${LITERAL_HUB_EDGE_TYPE_RE.exec(fs.readFileSync(onePath, 'utf8'))[0]}`).join(', ') || `${fileList.length} files clean` }; } }),
	pureConjunct({ conjunctId: 'lexical_noIdentityChainOverDeclarationValue', title: 'no `||` identity chain over a declaration value in the framework tree (bridgeDeclaration.<x> || …)', twinNameList: ['identityChainInFrameworkFile'], judge: (scenario) => { const offenderList = listJs(frameworkTreeOf(scenario), true).filter((oneFilePath) => /bridgeDeclaration\.\w+\s*\|\|/.test(fs.readFileSync(oneFilePath, 'utf8'))); return { pass: offenderList.length === 0, detail: offenderList.map((onePath) => path.basename(onePath)).join(', ') || 'clean' }; } }),
	pureConjunct({ conjunctId: 'behavioural_xLogAbsentRefused', title: 'xLog available neither as a dep nor as process.global.xLog → construction refused by name (never a do-nothing logger)', twinNameList: ['manufactureNoOpLogger'], judge: (scenario) => { const savedGlobal = process.global; process.global = {}; let refusal = ''; try { scenarioLib.loadFrameworkFactory(scenario)({ graphReaderFactory: () => ({}), graphWriterFactory: () => ({}), pluginRegistry: { entryByBridgeName: {} } }); } catch (thrown) { refusal = thrown.message; } process.global = savedGlobal; return { pass: /xLog is available neither as a dep nor as process\.global\.xLog/.test(refusal), detail: refusal || 'construction SUCCEEDED without a logger' }; } }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-NOSUB', conjunctId: 'behavioural_storesAbsentOnRebridgeRefused', title: 'judgmentCache absent on rebridge: true → refused by name', shape: (scenario) => { scenario.stores.judgmentCache = undefined; }, regex: /judgmentCache is absent on a re-judge/, twinName: 'toleratesAbsentCache', fileName: FRAMEWORK_FILE, find: "\t\t\tif (spec.rebridge && (!spec.judgmentCache || typeof spec.judgmentCache.getJudgment !== 'function')) {", replace: "\t\t\tif (false && spec.rebridge && (!spec.judgmentCache || typeof spec.judgmentCache.getJudgment !== 'function')) {" }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-NOSUB', conjunctId: 'behavioural_llmClientAbsentAtFirstJudgedRefused', title: 'inferenceConfig.llmClient absent at the FIRST judged subject → refused naming the subject (a specified-only run needs no judge)', shape: (scenario) => { scenario.specInferenceConfigOverride = {}; }, regex: /a judged decision is needed for subject toy:property\/\S+ .* and inferenceConfig\.llmClient is absent/, twinName: 'skipJudgedSubjectsSilently', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\tif (!judgeClient || typeof judgeClient.rerank !== 'function') {\n\t\t\t\t\t\tconst firstJudged = args.judgedTaskList[0];", replace: "\t\t\t\t\tif (!judgeClient || typeof judgeClient.rerank !== 'function') {\n\t\t\t\t\t\tnext('', { ...args, judgedRecordList: [], judgeKind: RUN_KIND_NONE });\n\t\t\t\t\t\treturn;\n\t\t\t\t\t\tconst firstJudged = args.judgedTaskList[0];" }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-NOSUB', conjunctId: 'behavioural_configKeyOutsideListRefused', title: "a spec.config key outside RUN_CONFIG_KEY_LIST (a recipe params: { blindingDeclaration: [] } reaching config) → refused by name (RULING BF11)", shape: (scenario) => { scenario.spec.config.blindingDeclaration = []; }, regex: /spec\.config carries key 'blindingDeclaration', outside RUN_CONFIG_KEY_LIST/, twinName: 'admitUnknownConfigKey', fileName: FRAMEWORK_FILE, find: '\t\t\tif (unknownConfigKey !== undefined) {', replace: '\t\t\tif (false && unknownConfigKey !== undefined) {' }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-NOSUB', conjunctId: 'behavioural_unknownDepRefused', title: 'an unknown factory dep (a driver, a bolt URL) is refused by name', shape: (scenario) => { scenario.deps.boltUrl = 'bolt://nowhere'; }, regex: /unknown dep 'boltUrl'/, twinName: 'admitUnknownDep', fileName: FRAMEWORK_FILE, find: '\t\tif (unknownDepName !== undefined) {', replace: '\t\tif (false && unknownDepName !== undefined) {' }),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-NOSUB', conjunctId: 'lexical_fWordAbsent', twinName: 'fWordInFrameworkFile', leverKind: 'productionMutation', mutate: (scenario) => withScratchFrameworkCopy(scenario, (scratchDir) => { const filePath = path.join(scratchDir, 'census.js'); fs.writeFileSync(filePath, `${fs.readFileSync(filePath, 'utf8')}\n// a ${['fall', 'back'].join('')} to the old census\n`); }) });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-NOSUB', conjunctId: 'lexical_stubLoggerIdiomAbsent', twinName: 'stubLoggerInFrameworkFile', leverKind: 'productionMutation', mutate: (scenario) => withScratchFrameworkCopy(scenario, (scratchDir) => { const filePath = path.join(scratchDir, 'census.js'); fs.writeFileSync(filePath, `${fs.readFileSync(filePath, 'utf8')}\nconst xLog = { status: () => {}, error: () => {} };\nvoid xLog;\n`); }) });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-NOSUB', conjunctId: 'lexical_perStandardTokensAbsent', twinName: 'standardTokenInFrameworkFile', leverKind: 'productionMutation', mutate: (scenario) => withScratchFrameworkCopy(scenario, (scratchDir) => { const filePath = path.join(scratchDir, 'classification.js'); fs.writeFileSync(filePath, `${fs.readFileSync(filePath, 'utf8')}\nconst standardKeyBranch = (declaration) => (declaration.standardKey === 'sif' ? 1 : 0);\nvoid standardKeyBranch;\n`); }) });
// injectLiteralHubEdge — a scratch copy of the framework tree with ONE literal slot edge type appended to the orchestrator:
// exactly the shortcut hubEdgeType exists to prevent, and invisible to the token grep (no whole-word standard token)
scenarioTwin({ registry: twinRegistry, gateId: 'BG-NOSUB', conjunctId: 'k_noLiteralHubEdgeTypeInFrameworkTree', twinName: 'injectLiteralHubEdge', leverKind: 'productionMutation', mutate: (scenario) => withScratchFrameworkCopy(scenario, (scratchDir) => { const filePath = path.join(scratchDir, FRAMEWORK_FILE); fs.writeFileSync(filePath, `${fs.readFileSync(filePath, 'utf8')}\nconst literalDomainSlotEdgeType = 'HAS_CEDS_DOMAIN';\nvoid literalDomainSlotEdgeType;\n`); }) });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-NOSUB', conjunctId: 'lexical_noIdentityChainOverDeclarationValue', twinName: 'identityChainInFrameworkFile', leverKind: 'productionMutation', mutate: (scenario) => withScratchFrameworkCopy(scenario, (scratchDir) => { const filePath = path.join(scratchDir, 'census.js'); fs.writeFileSync(filePath, `${fs.readFileSync(filePath, 'utf8')}\nconst basisOf = (bridgeDeclaration) => bridgeDeclaration.matchBasis || 'crosswalk';\nvoid basisOf;\n`); }) });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-NOSUB', conjunctId: 'behavioural_xLogAbsentRefused', twinName: 'manufactureNoOpLogger', fileName: FRAMEWORK_FILE, find: "\t\tif (!xLog || typeof xLog.status !== 'function' || typeof xLog.error !== 'function') {\n\t\t\tthrow refuse.byName", replace: "\t\tif (false && (!xLog || typeof xLog.status !== 'function' || typeof xLog.error !== 'function')) {\n\t\t\tthrow refuse.byName" });

// ---------------------------------------------------------------------
// BG-COMPOSE
// ---------------------------------------------------------------------
const EXPECTED_COMPOSE = JSON.parse(fs.readFileSync(path.join(__dirname, 'acceptance', 'expectedCompose.json'), 'utf8'));
const makeScratchRepoWithTwoCommits = () => {
	const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeComposeRepo-'));
	const gitRun = (argList) => spawnSync('git', argList, { cwd: repoDir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'toy', GIT_AUTHOR_EMAIL: 'toy@example', GIT_COMMITTER_NAME: 'toy', GIT_COMMITTER_EMAIL: 'toy@example' } });
	gitRun(['init', '-q']);
	fs.mkdirSync(path.join(repoDir, 'lib', 'bridge-framework', 'test', 'acceptance'), { recursive: true });
	fs.mkdirSync(path.join(repoDir, 'forges', 'first', 'bridges'), { recursive: true });
	fs.writeFileSync(path.join(repoDir, 'lib', 'bridge-framework', 'classification.js'), '// framework\n');
	fs.writeFileSync(path.join(repoDir, 'lib', 'bridge-framework', 'test', 'acceptance', 'expected.json'), '{"first":1}\n');
	fs.writeFileSync(path.join(repoDir, 'forges', 'first', 'bridges', 'firstPlugin.js'), '// first plugin\n');
	gitRun(['add', '-A']);
	gitRun(['commit', '-q', '-m', 'first plugin accepted']);
	const firstCommit = String(gitRun(['rev-parse', 'HEAD']).stdout).trim();
	fs.mkdirSync(path.join(repoDir, 'forges', 'second', 'bridges'), { recursive: true });
	fs.writeFileSync(path.join(repoDir, 'forges', 'second', 'bridges', 'secondPlugin.js'), '// second plugin\n');
	fs.writeFileSync(path.join(repoDir, 'lib', 'bridge-framework', 'test', 'acceptance', 'expected.json'), '{"first":1,"second":2}\n');
	gitRun(['add', '-A']);
	gitRun(['commit', '-q', '-m', 'second plugin accepted']);
	const secondCommit = String(gitRun(['rev-parse', 'HEAD']).stdout).trim();
	return { repoDir, firstCommit, secondCommit, gitRun };
};
const composeNumstat = ({ repoDir, firstCommit, secondCommit }) => String(spawnSync('git', ['diff', '--numstat', `${firstCommit}..${secondCommit}`, '--', 'lib/bridge-framework/', ':!lib/bridge-framework/test/acceptance/'], { cwd: repoDir, encoding: 'utf8' }).stdout || '').trim();
const composeConjunctList = [
	pureConjunct({ conjunctId: 'a_diffIsB3B4Data_mechanismProven', title: 'BG-COMPOSE (a): the accepted-plugin commit pair is B3/B4 DATA (expectedCompose.json: null-and-honest or a recorded commit id — supervisor merge edit 2026-08-17); the numstat MECHANISM (framework tree diffed, test/acceptance/ excluded) is proven on a scratch repo: two plugin commits → EMPTY', twinNameList: ['commentAddedBetweenCommits'], judge: (scenario) => { const repo = scenario.composeRepoOverride === undefined ? makeScratchRepoWithTwoCommits() : scenario.composeRepoOverride; const numstat = composeNumstat(repo); const commitOk = (oneValue) => oneValue === null || /^[0-9a-f]{7,40}$/.test(String(oneValue)); const dataOk = commitOk(EXPECTED_COMPOSE.edfiPluginAcceptedCommit) && commitOk(EXPECTED_COMPOSE.sifPluginAcceptedCommit); return { pass: dataOk && numstat === '', detail: `${numstat === '' ? 'scratch repo numstat EMPTY (acceptance excluded)' : `NON-EMPTY: ${numstat}`}; B3/B4 commits ${dataOk ? `well-formed (edfi ${EXPECTED_COMPOSE.edfiPluginAcceptedCommit}, sif ${EXPECTED_COMPOSE.sifPluginAcceptedCommit})` : 'MALFORMED (null or a hex commit id required)'}` }; } }),
	pureConjunct({ conjunctId: 'b_fingerprintEqualAcrossPluginsAndContentDerived', title: 'BG-COMPOSE (b): frameworkFingerprint in BOTH toy plugins\' blocks EQUALS the fingerprint recomputed now (content-derived, never a constant)', twinNameList: ['fingerprintTreeGainsAFile'], judge: () => ({ pass: false, detail: 'replaced' }) }),
	pureConjunct({ conjunctId: 'c_noPerStandardBranch', title: 'BG-COMPOSE (c): the token grep is clean AND the static branch census finds no `switch (` and no `=== \'<value>\'` on matchBasis / standardKey / predicateSource.kind / subjectIdentity.kind in the framework tree (every such dispatch is a registry lookup)', twinNameList: ['standardKeyBranchInjected'], judge: (scenario) => { const fileList = listJs(frameworkTreeOf(scenario), true); const branchRe = /switch \(|\b(matchBasis|standardKey|kind)\s*===\s*'(standard|crosswalk|column|labelTable|channelAssertion|columnTuple|forgedNode|edfi|sif|pesc|ceds)'/; const offenderList = fileList.filter((oneFilePath) => branchRe.test(fs.readFileSync(oneFilePath, 'utf8')) || STANDARD_TOKEN_RE.test(fs.readFileSync(oneFilePath, 'utf8'))); return { pass: offenderList.length === 0, detail: offenderList.map((onePath) => `${path.basename(onePath)}: ${(branchRe.exec(fs.readFileSync(onePath, 'utf8')) || STANDARD_TOKEN_RE.exec(fs.readFileSync(onePath, 'utf8')))[0]}`).join('; ') || `${fileList.length} files: registry lookups only` }; } }),
];
composeConjunctList[1].evaluate = (scenario, callback) => {
	const first = scenarioLib.cloneScenario(scenario);
	first.frameworkMutationList = scenario.frameworkMutationList.slice();
	scenarioLib.runScenario(first, (unusedError, firstOutcome) => {
		if (firstOutcome.runError) {
			callback('', { pass: false, detail: String(firstOutcome.runError).slice(0, 200) });
			return;
		}
		const second = scenarioLib.cloneScenario(scenario);
		second.frameworkMutationList = scenario.frameworkMutationList.slice();
		second.spec.bridge = 'toyStandardPlugin';
		scenarioLib.runScenario(second, (unusedSecondError, secondOutcome) => {
			if (secondOutcome.runError) {
				callback('', { pass: false, detail: String(secondOutcome.runError).slice(0, 200) });
				return;
			}
			const firstFingerprint = blockOf(firstOutcome).header.frameworkFingerprint;
			const secondFingerprint = blockOf(secondOutcome).header.frameworkFingerprint;
			const recomputed = decisionBlockLib.frameworkFingerprint();
			callback('', { pass: firstFingerprint === secondFingerprint && firstFingerprint === recomputed, detail: `${firstFingerprint.slice(0, 12)} / ${secondFingerprint.slice(0, 12)} / recomputed ${recomputed.slice(0, 12)}` });
		});
	});
};
scenarioTwin({ registry: twinRegistry, gateId: 'BG-COMPOSE', conjunctId: 'a_diffIsB3B4Data_mechanismProven', twinName: 'commentAddedBetweenCommits', leverKind: 'productionMutation', mutate: (scenario) => { const repo = makeScratchRepoWithTwoCommits(); fs.writeFileSync(path.join(repo.repoDir, 'lib', 'bridge-framework', 'classification.js'), '// framework\n// a comment added for the second plugin\n'); repo.gitRun(['add', '-A']); repo.gitRun(['commit', '-q', '-m', 'second plugin accepted (with a framework edit)']); repo.secondCommit = String(repo.gitRun(['rev-parse', 'HEAD']).stdout).trim(); scenario.composeRepoOverride = repo; } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-COMPOSE', conjunctId: 'b_fingerprintEqualAcrossPluginsAndContentDerived', twinName: 'fingerprintTreeGainsAFile', leverKind: 'productionMutation', mutate: (scenario) => { const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeFingerprintExtra-')); fs.writeFileSync(path.join(scratchDir, 'extra.js'), '// one more framework file\n'); scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'decisionBlock.js'), find: "\t{ label: 'apps/graph-builder/apps/bridge-maker/lib', dirPath: path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib'), recursive: false, excludeDirNameList: [] },", replace: `\t{ label: 'apps/graph-builder/apps/bridge-maker/lib', dirPath: path.join(__dirname, '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib'), recursive: false, excludeDirNameList: [] },\n\t{ label: 'scratch', dirPath: ${JSON.stringify(scratchDir)}, recursive: false, excludeDirNameList: [] },` }); } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-COMPOSE', conjunctId: 'c_noPerStandardBranch', twinName: 'standardKeyBranchInjected', leverKind: 'productionMutation', mutate: (scenario) => withScratchFrameworkCopy(scenario, (scratchDir) => { const filePath = path.join(scratchDir, 'classification.js'); fs.writeFileSync(filePath, `${fs.readFileSync(filePath, 'utf8')}\nconst perStandard = (declaration) => { if (declaration.standardKey === 'sif') { return 1; } return 0; };\nvoid perStandard;\n`); }) });

// ---------------------------------------------------------------------
// BG-SEAM-UNTOUCHED
// ---------------------------------------------------------------------
const SEAM_PATH_LIST = Object.freeze([
	'apps/graph-builder/lib/build.js',
	'apps/graph-builder/apps/forger/',
	'lib/replay/',
	'apps/graph-builder/apps/replay-manager/',
	'forges/*/forge*.js',
	'forges/*/lib/*Declaration.js',
	'forges/*/lib/*Hooks.js',
	'lib/forge-framework/',
	':!lib/forge-framework/test/test-gSeamUntouched.js', // the ONE ruled test edit (RULING 17:10) — its own conjunct below
]);
const treeRootInside = (workTreeTopLevel) => (workTreeTopLevel === TREE_ROOT ? TREE_ROOT : path.join(workTreeTopLevel, GIT_PREFIX));
const gitDiffStat = ({ workTreePath, pathList }) => spawnSync('git', ['diff', '--stat', PHASE3_ANCHOR_TAG, '--'].concat(pathList), { cwd: workTreePath, encoding: 'utf8' });
const gitShowAtTag = (relativePath) => String(spawnSync('git', ['show', `${BASE_TAG}:${GIT_PREFIX}${relativePath}`], { cwd: TREE_ROOT, encoding: 'utf8' }).stdout || '');
const loadInterfacesAtRef = (oneRef) => {
	const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interfacesAtTag-'));
	const filePath = path.join(scratchDir, 'interfaces.js');
	fs.writeFileSync(filePath, String(spawnSync('git', ['show', `${oneRef}:${GIT_PREFIX}apps/graph-builder/interfaces.js`], { cwd: TREE_ROOT, encoding: 'utf8' }).stdout || ''));
	return require(filePath);
};
// (i) reads BASE_TAG — the B2 migration window, which never moves. The LIVE companion below reads
// PHASE3_ANCHOR_TAG, which rolls. Two bases, deliberately, for two different kinds of claim.
const loadInterfacesAtTag = () => loadInterfacesAtRef(BASE_TAG);
let scratchWorkTreePath = null;
const seamConjunctList = [
	pureConjunct({ conjunctId: 'seamDiffEmpty', title: `git diff --stat ${PHASE3_ANCHOR_TAG} -- <build.js, forger/, replay/, replay-manager/, forge entry/declaration/hooks files, lib/forge-framework/ minus the ruled test edit> is EMPTY`, twinNameList: ['touchBuildJsInScratchWorktree'], judge: (scenario) => { const workTreePath = scenario.workTreePath ? treeRootInside(scenario.workTreePath) : TREE_ROOT; const run = gitDiffStat({ workTreePath, pathList: SEAM_PATH_LIST }); const statText = String(run.stdout || '').trim(); return { pass: run.status === 0 && statText === '', detail: run.status !== 0 ? `git diff failed: ${run.stderr}` : statText === '' ? 'empty diff — the seam is untouched' : `NON-EMPTY:\n${statText}` }; } }),
	pureConjunct({ conjunctId: 'i_interfacesOnlyTheTwoBlocks', title: '(i) THE B2 MIGRATION WINDOW (base preBridgeFramework-081626, which never moves): MANIFEST_HANDLE_SHAPE byte-equal to the tag; bridgeMaker.run arity/argKeys equal; resultKeys null → the 15-key list (13 until W-B-10, 2026-10-06); BRIDGE_MODULE_SHAPE gone', twinNameList: ['argKeysAltered'], judge: (scenario) => { const atTag = loadInterfacesAtTag(); const atHead = scenario.interfacesAtHeadOverride === undefined ? require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'interfaces.js')) : scenario.interfacesAtHeadOverride; const manifestEqual = JSON.stringify(atTag.MANIFEST_HANDLE_SHAPE) === JSON.stringify(atHead.MANIFEST_HANDLE_SHAPE); const callEqual = atTag.COMPONENT_SHAPES.bridgeMaker.run.arity === atHead.COMPONENT_SHAPES.bridgeMaker.run.arity && JSON.stringify(atTag.COMPONENT_SHAPES.bridgeMaker.run.argKeys) === JSON.stringify(atHead.COMPONENT_SHAPES.bridgeMaker.run.argKeys); const resultKeysMoved = atTag.COMPONENT_SHAPES.bridgeMaker.run.resultKeys === null && Array.isArray(atHead.COMPONENT_SHAPES.bridgeMaker.run.resultKeys) && atHead.COMPONENT_SHAPES.bridgeMaker.run.resultKeys.length === 15; const shapeGone = atTag.BRIDGE_MODULE_SHAPE !== undefined && atHead.BRIDGE_MODULE_SHAPE === undefined; return { pass: manifestEqual && callEqual && resultKeysMoved && shapeGone, detail: `manifest ${manifestEqual}, call ${callEqual}, resultKeys ${resultKeysMoved}, BRIDGE_MODULE_SHAPE gone ${shapeGone}` }; } }),
	// ─── (i) SPLIT, 2026-09-01 (GRANITE_ECHO) ───────────────────────────────────────────────────
	// (i) bundled TWO KINDS OF CLAIM under one base, and the graphSelfDoc campaign is what made the
	// difference matter. Its four clauses above are HISTORY — assertions about what the B2
	// bridgeMaker migration did, true forever against preBridgeFramework-081626, and vacuous the
	// moment that base moves. Its fifth clause, `otherEqual`, is a LIVE "nothing else has moved
	// since" assertion, and against a base that predates every authorised component change it goes
	// red on the next legitimate edit and stays red — which is precisely what happened when
	// replayManager gained the finish verb.
	//
	// So they are now two conjuncts with two bases. The historical half never moves; the live half
	// rolls with PHASE3_ANCHOR_TAG like every other "nothing since" check in this gate. NEITHER
	// SCOPE WAS WIDENED: between them they assert exactly what the single conjunct asserted, and the
	// live half is STRICTER than leaving the pair fused, because a fused conjunct that is red for a
	// stale-base reason cannot report a real one.
	pureConjunct({ conjunctId: 'i_liveOtherComponentShapesUntouched', title: `(i-live) every COMPONENT_SHAPES member other than bridgeMaker is byte-equal between ${PHASE3_ANCHOR_TAG} and HEAD (the rolling half of the old (i); bridgeMaker is excluded because the migration half above owns it)`, twinNameList: ['nonBridgeMakerShapeAltered'], judge: (scenario) => { const atAnchor = loadInterfacesAtRef(PHASE3_ANCHOR_TAG); const atHead = scenario.interfacesAtHeadOverride === undefined ? require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'interfaces.js')) : scenario.interfacesAtHeadOverride; const nameList = Object.keys(atAnchor.COMPONENT_SHAPES).filter((oneName) => oneName !== 'bridgeMaker'); const offenderList = nameList.filter((oneName) => JSON.stringify(atAnchor.COMPONENT_SHAPES[oneName]) !== JSON.stringify(atHead.COMPONENT_SHAPES[oneName])); return { pass: offenderList.length === 0, detail: offenderList.length ? `MOVED since the anchor: ${offenderList.join(', ')}` : `${nameList.length} member(s) byte-equal to ${PHASE3_ANCHOR_TAG}` }; } }),
	pureConjunct({ conjunctId: 'ii_vocabularyDiffOnlyVocabularyAndTests', title: '(ii) the lib/vocabulary/ diff FROM THE D1 COMMIT touches vocabulary.js and its test/ files only (baseline moved by ruling, allowed-path list NOT widened)', twinNameList: ['touchVocabularyDefinitionsInScratchWorktree'], judge: (scenario) => { const workTreePath = scenario.workTreePath ? treeRootInside(scenario.workTreePath) : TREE_ROOT; const run = spawnSync('git', ['diff', '--name-only', POST_D1_BASE_TAG, '--', 'lib/vocabulary/'], { cwd: workTreePath, encoding: 'utf8' }); const nameList = String(run.stdout || '').trim().split('\n').filter(Boolean).map((oneName) => oneName.replace(GIT_PREFIX, '')); const outside = nameList.filter((oneName) => oneName !== 'lib/vocabulary/vocabulary.js' && !/^lib\/vocabulary\/test\//.test(oneName)); return { pass: run.status === 0 && outside.length === 0, detail: `changed [${nameList.join(', ')}]; outside [${outside.join(', ')}]` }; } }),
	pureConjunct({ conjunctId: 'iii_forgeFrameworkDiffIsExactlyTheRuledTestEdit', title: `(iii) the lib/forge-framework/ diff from ${PHASE0_ANCHOR_TAG} is EMPTY — the two ruled edits (test/test-gSeamUntouched.js, RULING SABLE_RIVER 17:10; test/acceptance/expectedBlockIds.json, Phase 0.E3) are INSIDE the anchor, so nothing under lib/forge-framework/ may have moved since it`, twinNameList: ['touchForgeFrameworkModuleInScratchWorktree'], judge: (scenario) => { const workTreePath = scenario.workTreePath ? treeRootInside(scenario.workTreePath) : TREE_ROOT; const run = spawnSync('git', ['diff', '--name-only', PHASE0_ANCHOR_TAG, '--', 'lib/forge-framework/'], { cwd: workTreePath, encoding: 'utf8' }); const nameList = String(run.stdout || '').trim().split('\n').filter(Boolean).map((oneName) => oneName.replace(GIT_PREFIX, '')); return { pass: run.status === 0 && nameList.length === 0, detail: nameList.length === 0 ? 'empty diff — lib/forge-framework/ is untouched since the anchor' : `changed [${nameList.join(', ')}]` }; } }),
];
const ensureScratchWorkTree = () => {
	if (!scratchWorkTreePath) {
		scratchWorkTreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'bridgeSeamWorktree-'));
		fs.rmdirSync(scratchWorkTreePath);
		const add = spawnSync('git', ['worktree', 'add', '--detach', scratchWorkTreePath, 'HEAD'], { cwd: TREE_ROOT, encoding: 'utf8' });
		if (add.status !== 0) {
			throw new Error(`git worktree add failed: ${add.stderr}`);
		}
	}
	return scratchWorkTreePath;
};
scenarioTwin({ registry: twinRegistry, gateId: 'BG-SEAM-UNTOUCHED', conjunctId: 'seamDiffEmpty', twinName: 'touchBuildJsInScratchWorktree', leverKind: 'productionMutation', mutate: (scenario) => { const workTree = ensureScratchWorkTree(); fs.appendFileSync(path.join(treeRootInside(workTree), 'apps/graph-builder/lib/build.js'), '\n// touched by the BG-SEAM-UNTOUCHED twin\n'); scenario.workTreePath = workTree; } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-SEAM-UNTOUCHED', conjunctId: 'i_interfacesOnlyTheTwoBlocks', twinName: 'argKeysAltered', leverKind: 'productionMutation', mutate: (scenario) => { const atHead = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'interfaces.js')); scenario.interfacesAtHeadOverride = { ...atHead, COMPONENT_SHAPES: { ...atHead.COMPONENT_SHAPES, bridgeMaker: { run: { ...atHead.COMPONENT_SHAPES.bridgeMaker.run, argKeys: ['inGraph', 'hub', 'applyLabel'] } } } }; } });
// The live half's twin alters a member the migration half does NOT own — proving the split did not
// leave the rolling assertion unguarded. It picks the first non-bridgeMaker member by name rather
// than naming one, so a future rename of a component cannot quietly make this twin a no-op.
scenarioTwin({ registry: twinRegistry, gateId: 'BG-SEAM-UNTOUCHED', conjunctId: 'i_liveOtherComponentShapesUntouched', twinName: 'nonBridgeMakerShapeAltered', leverKind: 'productionMutation', mutate: (scenario) => { const atHead = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'interfaces.js')); const victimName = Object.keys(atHead.COMPONENT_SHAPES).filter((oneName) => oneName !== 'bridgeMaker')[0]; scenario.interfacesAtHeadOverride = { ...atHead, COMPONENT_SHAPES: { ...atHead.COMPONENT_SHAPES, [victimName]: { ...atHead.COMPONENT_SHAPES[victimName], aTwinInjectedVerb: { arity: 2, argKeys: ['injected'], resultKeys: null } } } }; } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-SEAM-UNTOUCHED', conjunctId: 'ii_vocabularyDiffOnlyVocabularyAndTests', twinName: 'touchVocabularyDefinitionsInScratchWorktree', leverKind: 'productionMutation', mutate: (scenario) => { const workTree = ensureScratchWorkTree(); fs.appendFileSync(path.join(treeRootInside(workTree), 'lib/vocabulary/vocabulary-definitions.js'), '\n// touched by the BG-SEAM-UNTOUCHED twin\n'); scenario.workTreePath = workTree; } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-SEAM-UNTOUCHED', conjunctId: 'iii_forgeFrameworkDiffIsExactlyTheRuledTestEdit', twinName: 'touchForgeFrameworkModuleInScratchWorktree', leverKind: 'productionMutation', mutate: (scenario) => { const workTree = ensureScratchWorkTree(); fs.appendFileSync(path.join(treeRootInside(workTree), 'lib/forge-framework/refuse.js'), '\n// touched by the BG-SEAM-UNTOUCHED twin\n'); scenario.workTreePath = workTree; } });
const removeScratchWorkTree = () => { if (scratchWorkTreePath) { spawnSync('git', ['worktree', 'remove', '--force', scratchWorkTreePath], { cwd: TREE_ROOT, encoding: 'utf8' }); scratchWorkTreePath = null; } };
process.on('exit', removeScratchWorkTree);

// ---------------------------------------------------------------------
// BG-HYGIENE
// ---------------------------------------------------------------------
const CANONICAL_DATASTORE_DIR_LIST = ['judgmentCache', 'matchForensics', 'graphBuilder', 'buildLogs'].map((oneName) => path.join(TREE_ROOT, '..', '..', 'dataStores', oneName));
const censusOfDirs = (dirList) => dirList.map((oneDir) => { if (!fs.existsSync(oneDir)) { return `${oneDir}: absent`; } const walk = (dirPath) => fs.readdirSync(dirPath, { withFileTypes: true }).sort((leftEntry, rightEntry) => (leftEntry.name < rightEntry.name ? -1 : 1)).reduce((soFar, oneEntry) => (oneEntry.isDirectory() ? soFar.concat(walk(path.join(dirPath, oneEntry.name))) : soFar.concat([`${path.join(dirPath, oneEntry.name)}:${fs.statSync(path.join(dirPath, oneEntry.name)).size}:${fs.statSync(path.join(dirPath, oneEntry.name)).mtimeMs}`])), []); return walk(oneDir).join('\n'); }).join('\n');
// ⟪HYGIENE DETAIL⟫ censusDifferenceDetail — SAY WHAT CHANGED, not merely that something did.
// This judge previously computed a full before/after census, compared the two strings with ===, and
// reported the literal 'CHANGED during the run' — discarding the difference it had just computed. A
// gate that detects a fault and hides the evidence is this campaign's own disease living inside the
// instrument meant to detect it: on 2026-09-02 it went red and neither the builder nor the supervisor
// could tell from its output whether the writer was an external dev API server, a -shm touched by a
// store open, or the build under test. Each of us guessed, and both guesses were wrong.
//
// THE PASS RULE IS UNCHANGED — string equality, exactly as before. Only what a RED says is different.
// A census line is `path:size:mtimeMs`, so the entry is named by its path and the reader can see which
// of size or mtime moved.
const censusDifferenceDetail = (beforeText, afterText) => {
	const lineSetOf = (oneText) => new Set(String(oneText).split('\n').filter((oneLine) => oneLine.trim() !== ''));
	const beforeSet = lineSetOf(beforeText);
	const afterSet = lineSetOf(afterText);
	const pathOf = (oneLine) => oneLine.slice(0, oneLine.lastIndexOf(':', oneLine.lastIndexOf(':') - 1));
	const beforePathSet = new Set(Array.from(beforeSet).map(pathOf));
	const afterPathSet = new Set(Array.from(afterSet).map(pathOf));
	const addedList = Array.from(afterSet).filter((oneLine) => !beforePathSet.has(pathOf(oneLine)));
	const removedList = Array.from(beforeSet).filter((oneLine) => !afterPathSet.has(pathOf(oneLine)));
	const changedList = Array.from(afterSet).filter((oneLine) => !beforeSet.has(oneLine) && beforePathSet.has(pathOf(oneLine)));
	const nameList = (oneLabel, oneList) => (oneList.length === 0 ? [] : [`${oneLabel} ${oneList.length}: ${oneList.slice(0, 4).join(' | ')}${oneList.length > 4 ? ` | …and ${oneList.length - 4} more` : ''}`]);
	return `CHANGED during the run — ${[].concat(nameList('ADDED', addedList), nameList('REMOVED', removedList), nameList('CHANGED', changedList)).join('; ') || 'no entry differs (the difference is in line ORDER, which is itself a finding)'}`;
};

const FIXTURE_SUMS_SHA256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(scenarioLib.TOY_SNAPSHOT_DIR, 'SHA256SUMS'))).digest('hex');
const hygieneConjunctList = [
	runConjunct({ conjunctId: 'a_canonicalDataStoresUnchanged', title: 'the canonical dataStores (judgmentCache, matchForensics, graphBuilder, buildLogs) are byte-unchanged across a suite run (name+size+mtime census before/after)', twinNameList: ['watchListPointedAtScratchForensics'], shape: (scenario) => { scenario.dataStoreDirListForRun = scenario.dataStoreDirListOverride === undefined ? CANONICAL_DATASTORE_DIR_LIST : scenario.dataStoreDirListOverride; scenario.censusBefore = censusOfDirs(scenario.dataStoreDirListForRun); }, judge: succeeded((runReport, outcome, scenario) => { const after = censusOfDirs(scenario.dataStoreDirListForRun); return { pass: after === scenario.censusBefore, detail: after === scenario.censusBefore ? `unchanged (${scenario.dataStoreDirListForRun.length} dirs)` : censusDifferenceDetail(scenario.censusBefore, after) }; }) }),
	pureConjunct({ conjunctId: 'b_fixtureCommittedAndHashPinned', title: `the fixture is committed and its SHA256SUMS hash is pinned here (${FIXTURE_SUMS_SHA256.slice(0, 12)}…); every listed file verifies`, twinNameList: ['fixtureByteAltered'], judge: (scenario) => { const snapshotDir = scenario.snapshotDirOverride === undefined ? scenarioLib.TOY_SNAPSHOT_DIR : scenario.snapshotDirOverride; const sumsText = fs.readFileSync(path.join(snapshotDir, 'SHA256SUMS'), 'utf8'); const pinned = crypto.createHash('sha256').update(sumsText).digest('hex') === FIXTURE_SUMS_SHA256; const bad = sumsText.trim().split('\n').filter((oneLine) => { const [expected, name] = oneLine.split(/\s+/); return crypto.createHash('sha256').update(fs.readFileSync(path.join(snapshotDir, name))).digest('hex') !== expected; }); const tracked = String(spawnSync('git', ['ls-files', '--error-unmatch', path.relative(TREE_ROOT, path.join(snapshotDir, 'toyCrosswalk.csv'))], { cwd: TREE_ROOT, encoding: 'utf8' }).stdout || '').trim() !== ''; return { pass: pinned && bad.length === 0 && tracked, detail: `pinned ${pinned}; ${bad.length} mismatched; tracked ${tracked}` }; } }),
	pureConjunct({ conjunctId: 'c_noLicensedBytes', title: 'no gate depends on licensed bytes: the toy crosswalk is tiny (< 4 KB), toy-named, and README_PROVENANCE says so', twinNameList: ['largeForeignCsv'], judge: (scenario) => { const snapshotDir = scenario.snapshotDirOverride === undefined ? scenarioLib.TOY_SNAPSHOT_DIR : scenario.snapshotDirOverride; const csvText = fs.readFileSync(path.join(snapshotDir, 'toyCrosswalk.csv'), 'utf8'); const readme = fs.readFileSync(path.join(snapshotDir, 'README_PROVENANCE.md'), 'utf8'); return { pass: csvText.length < 4096 && /^ToyEntity,/.test(csvText) && /No licensed bytes/.test(readme), detail: `${csvText.length} bytes; toy-named ${/^ToyEntity,/.test(csvText)}` }; } }),
	pureConjunct({ conjunctId: 'd_oneMachineGateSaysSoByName', title: "a one-machine / proxy gate says so BY NAME: test-bgP7.js labels its validator PROXY, names sssom-py's presence/absence, and marks the real validator ONE-MACHINE", twinNameList: ['proxyLabelDropped'], judge: (scenario) => { const text = scenario.p7TextOverride === undefined ? fs.readFileSync(path.join(__dirname, 'test-bgP7.js'), 'utf8') : scenario.p7TextOverride; return { pass: /PROXY \(framework header\/row\/curie_map validator; sssom-py runs beside it when its venv is present/.test(text) && /ONE-MACHINE/.test(text) && /sssom-py ABSENT — PROXY only/.test(text), detail: /PROXY/.test(text) ? 'labelled (PROXY + sssom-py present/absent named)' : 'NOT labelled' }; } }),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-HYGIENE', conjunctId: 'a_canonicalDataStoresUnchanged', twinName: 'watchListPointedAtScratchForensics', leverKind: 'productionMutation', mutate: (scenario) => { scenario.dataStoreDirListOverride = [scenario.stores.matchForensics.baseDirPath]; scenario.stores.matchForensics.appendRecord = ((inner) => (recordArgs, callback) => { fs.mkdirSync(path.join(scenario.stores.matchForensics.baseDirPath, recordArgs.pairKey), { recursive: true }); fs.appendFileSync(path.join(scenario.stores.matchForensics.baseDirPath, recordArgs.pairKey, `${recordArgs.generation}.jsonl`), `${JSON.stringify(recordArgs.record)}\n`); inner(recordArgs, callback); })(scenario.stores.matchForensics.appendRecord); } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-HYGIENE', conjunctId: 'b_fixtureCommittedAndHashPinned', twinName: 'fixtureByteAltered', leverKind: 'inputFault', mutate: (scenario) => { const scratchForgesDir = scenarioLib.makeScratchForgesCopy(); const snapshotDir = path.join(scratchForgesDir, 'toy', 'assets', 'standardSourceData', '01'); fs.appendFileSync(path.join(snapshotDir, 'toyCrosswalk.csv'), 'X,X,X,000001,,Yes,,x,,z\n'); scenario.snapshotDirOverride = snapshotDir; } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-HYGIENE', conjunctId: 'c_noLicensedBytes', twinName: 'largeForeignCsv', leverKind: 'inputFault', mutate: (scenario) => { const scratchForgesDir = scenarioLib.makeScratchForgesCopy(); const snapshotDir = path.join(scratchForgesDir, 'toy', 'assets', 'standardSourceData', '01'); fs.writeFileSync(path.join(snapshotDir, 'toyCrosswalk.csv'), `EdFiEntity,x\n${'a,b\n'.repeat(3000)}`); scenario.snapshotDirOverride = snapshotDir; } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-HYGIENE', conjunctId: 'd_oneMachineGateSaysSoByName', twinName: 'proxyLabelDropped', leverKind: 'productionMutation', mutate: (scenario) => { scenario.p7TextOverride = fs.readFileSync(path.join(__dirname, 'test-bgP7.js'), 'utf8').replace(/PROXY \(framework header\/row\/curie_map validator; sssom-py runs beside it when its venv is present[^)]*\)/g, 'validated'); } });

// ---------------------------------------------------------------------
// BG-SWEEP — the sweep's own twin (synthetic gate + a registry the conjunct builds)
// ---------------------------------------------------------------------
const syntheticGateList = () => [{ gateId: 'BG-SYN', title: 'synthetic', conjunctList: [{ conjunctId: 'valueIsOne', title: 'value === 1', twinNameList: ['setValueTwo'], evaluate: (subject, callback) => callback('', { pass: subject.value === 1, detail: `value ${subject.value}` }) }] }];
const sweepWith = ({ scenario, registerTwins, subject = { value: 1 } }, callback) => {
	const registry = twinRegistryLib.makeTwinRegistry();
	registerTwins(registry);
	const evaluator = scenario.frameworkMutationList.length ? gateEvaluatorLib : gateEvaluatorLib; // the evaluator is the forge harness's — REUSED unchanged
	evaluator.sweepTwins({ gateDeclarationList: syntheticGateList(), twinRegistry: registry, subject, cloneSubject: (oneSubject) => ({ ...oneSubject }) }, callback);
};
const sweepConjunctList = [
	{ conjunctId: 'noOpTwinReportsDefective', title: 'a NO-OP twin (returns the subject unchanged) reports DEFECTIVE, never observed-red', twinNameList: ['countNoOpAsRed'], evaluate: (scenario, callback) => sweepWith({ scenario, registerTwins: (registry) => registry.register({ gateId: 'BG-SYN', conjunctId: 'valueIsOne', twinName: 'setValueTwo', leverKind: 'productionMutation', shippedConfig: true, run: scenario.noOpTwinRun === undefined ? (subject) => subject : scenario.noOpTwinRun }) }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.defectiveCount === 1 && sweep.observedRedCount === 0, detail: sweepError || `defective ${sweep.defectiveCount}, observedRed ${sweep.observedRedCount}` })) },
	{ conjunctId: 'realTwinObservedRed', title: 'a real twin (value 2) is observedRed and everyConjunctObservedRed is true', twinNameList: ['twinDeleted'], evaluate: (scenario, callback) => sweepWith({ scenario, registerTwins: (registry) => { if (!scenario.twinDeleted) { registry.register({ gateId: 'BG-SYN', conjunctId: 'valueIsOne', twinName: 'setValueTwo', leverKind: 'productionMutation', shippedConfig: true, run: (subject) => ({ ...subject, value: 2 }) }); } } }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.observedRedCount === 1 && sweep.everyConjunctObservedRed === true, detail: sweepError || `observedRed ${sweep.observedRedCount}, everyConjunctObservedRed ${sweep.everyConjunctObservedRed}` })) },
	{ conjunctId: 'expectationLeverOnlyIsUnproven', title: 'an expectationLever-only twin is recorded, not counted: the conjunct is UNPROVEN', twinNameList: ['expectationLeverCounted'], evaluate: (scenario, callback) => sweepWith({ scenario, registerTwins: (registry) => registry.register({ gateId: 'BG-SYN', conjunctId: 'valueIsOne', twinName: 'setValueTwo', leverKind: scenario.leverKindOverride === undefined ? 'expectationLever' : scenario.leverKindOverride, shippedConfig: true, run: (subject) => ({ ...subject, value: 2 }) }) }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.unprovenCount === 1 && sweep.expectationLeverList.length === 1 && sweep.observedRedCount === 0, detail: sweepError || `unproven ${sweep.unprovenCount}, expectationLever ${sweep.expectationLeverList.length}, observedRed ${sweep.observedRedCount}` })) },
	{ conjunctId: 'auditListsMissingAndOrphaned', title: 'the registry audit lists a MISSING twin (declared, unregistered) and an ORPHANED one (registered, undeclared)', twinNameList: ['auditSilenced'], evaluate: (scenario, callback) => { const registry = twinRegistryLib.makeTwinRegistry(); registry.register({ gateId: 'BG-SYN', conjunctId: 'somethingElse', twinName: 'orphan', leverKind: 'productionMutation', shippedConfig: true, run: (subject) => subject }); const audit = scenario.auditOverride === undefined ? registry.auditRegistryAgainst({ gateDeclarationList: syntheticGateList() }) : scenario.auditOverride; callback('', { pass: audit.missingList.length === 1 && audit.orphanList.length === 1, detail: `missing ${JSON.stringify(audit.missingList)}, orphaned ${JSON.stringify(audit.orphanList)}` }); } },
	{ conjunctId: 'redBaselineIsFailing', title: 'a RED baseline (value 5) is FAILING, never observed-red', twinNameList: ['failingCountedAsRed'], evaluate: (scenario, callback) => sweepWith({ scenario, subject: { value: 5 }, registerTwins: (registry) => registry.register({ gateId: 'BG-SYN', conjunctId: 'valueIsOne', twinName: 'setValueTwo', leverKind: 'productionMutation', shippedConfig: true, run: (subject) => ({ ...subject, value: 2 }) }) }, (sweepError, sweep) => callback('', { pass: !sweepError && sweep.failingCount === (scenario.failingExpected === undefined ? 1 : scenario.failingExpected) && sweep.observedRedCount === 0, detail: sweepError || `failing ${sweep.failingCount}, observedRed ${sweep.observedRedCount}` })) },
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-SWEEP', conjunctId: 'noOpTwinReportsDefective', twinName: 'countNoOpAsRed', leverKind: 'productionMutation', mutate: (scenario) => { scenario.noOpTwinRun = (subject) => ({ ...subject, value: 2 }); } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-SWEEP', conjunctId: 'realTwinObservedRed', twinName: 'twinDeleted', leverKind: 'productionMutation', mutate: (scenario) => { scenario.twinDeleted = true; } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-SWEEP', conjunctId: 'expectationLeverOnlyIsUnproven', twinName: 'expectationLeverCounted', leverKind: 'productionMutation', mutate: (scenario) => { scenario.leverKindOverride = 'productionMutation'; } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-SWEEP', conjunctId: 'auditListsMissingAndOrphaned', twinName: 'auditSilenced', leverKind: 'productionMutation', mutate: (scenario) => { scenario.auditOverride = { missingList: [], orphanList: [] }; } });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-SWEEP', conjunctId: 'redBaselineIsFailing', twinName: 'failingCountedAsRed', leverKind: 'productionMutation', mutate: (scenario) => { scenario.failingExpected = 0; } });

const gateDeclarationList = [
	{ gateId: 'BG-NOSUB', title: 'no silent substitution, no per-standard token, no do-nothing logger', conjunctList: nosubConjunctList },
	{ gateId: 'BG-COMPOSE', title: 'composability, asserted mechanically three ways', conjunctList: composeConjunctList },
	{ gateId: 'BG-SEAM-UNTOUCHED', title: 'the seam, untouched save the named exceptions', conjunctList: seamConjunctList },
	{ gateId: 'BG-HYGIENE', title: 'suite hygiene', conjunctList: hygieneConjunctList },
	{ gateId: 'BG-SWEEP', title: 'the sweep and the audit report honestly', conjunctList: sweepConjunctList },
];

const cloneSubject = (scenario) => ({ ...scenarioLib.cloneScenario(scenario), workTreePath: scenario.workTreePath, frameworkTreeDirOverride: scenario.frameworkTreeDirOverride });
runGateFamily(
	{ harness, familyName: 'BG-NOSUB+BG-COMPOSE+BG-SEAM-UNTOUCHED+BG-HYGIENE+BG-SWEEP', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject, expectedConjunctCount: 10 + 3 + 5 + 4 + 5 }, // BG-SEAM-UNTOUCHED 4 -> 5: the (i) split, 2026-09-01
	() => { removeScratchWorkTree(); harness.report(); },
);
