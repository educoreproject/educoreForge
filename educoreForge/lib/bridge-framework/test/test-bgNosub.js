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
const POST_D1_BASE_TAG = 'postGraphSelfDoc-090126'; // re-anchored 2026-09-01 — base moved, allowed-path list NOT widened
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
const PHASE0_ANCHOR_TAG = 'postJudgeRegistryJob4b-090726'; // re-anchored by DAWN_TOWER after judgeProviderRegistry JOB 4 — the FOURTH anchor; the first re-anchor moved three and edited test-gSeamUntouched.js under lib/forge-framework/, which conjunct (iii) watches from THIS tag (TWILIGHT_ARROW's trap, 2026-09-03, walked into again 2026-09-07)
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
const PHASE3_ANCHOR_TAG = 'postJudgeRegistryJob4b-090726'; // re-anchored by DAWN_TOWER after judgeProviderRegistry JOB 4; tag cut ON the re-anchor commit (three anchors moved together — PESC (a), G-SEAM-UNTOUCHED, and this one)
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
const F_WORD_EXEMPT_LIST = ['llmClient.js', 'debugJudge.js']; // UNCHANGED by RULING BF1; pre-existing occurrences, listed here by name

// ---------------------------------------------------------------------
// BG-NOSUB
// ---------------------------------------------------------------------
const nosubConjunctList = [
	pureConjunct({ conjunctId: 'lexical_fWordAbsent', title: `the f-word (any form) is absent from lib/bridge-framework/**, bridgeMaker.js, sourceWindow.js, evidenceContracts.js and every fixture plugin (comments included); EXEMPT by name (unchanged files, RULING BF1): ${F_WORD_EXEMPT_LIST.join(', ')}`, twinNameList: ['fWordInFrameworkFile'], judge: (scenario) => { const fileList = listJs(frameworkTreeOf(scenario), true).concat([path.join(BRIDGE_MAKER_DIR, 'bridgeMaker.js'), path.join(BRIDGE_MAKER_DIR, 'lib', 'sourceWindow.js'), path.join(BRIDGE_MAKER_DIR, 'lib', 'evidenceContracts.js')]).concat(listJs(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges'), false)); const offenderList = fileList.filter((oneFilePath) => F_WORD_RE.test(fs.readFileSync(oneFilePath, 'utf8'))); return { pass: offenderList.length === 0, detail: offenderList.length ? `f-word in ${offenderList.map((onePath) => path.basename(onePath)).join(', ')}` : `${fileList.length} files clean; exempt: ${F_WORD_EXEMPT_LIST.join(', ')}` }; } }),
	pureConjunct({ conjunctId: 'lexical_stubLoggerIdiomAbsent', title: 'the stub-logger idioms (a manufactured no-op xLog) are absent from the framework tree', twinNameList: ['stubLoggerInFrameworkFile'], judge: (scenario) => { const offenderList = listJs(frameworkTreeOf(scenario), true).filter((oneFilePath) => /xLog\s*=\s*\{\s*status:\s*\(\)\s*=>\s*\{\}|status:\s*\(\)\s*=>\s*\{\},\s*error:\s*\(\)\s*=>\s*\{\}/.test(fs.readFileSync(oneFilePath, 'utf8'))); return { pass: offenderList.length === 0, detail: offenderList.map((onePath) => path.basename(onePath)).join(', ') || 'clean' }; } }),
	pureConjunct({ conjunctId: 'lexical_perStandardTokensAbsent', title: 'per-standard tokens (edfi|EdFi|sif|SIF|pesc|ceds as whole words) are absent from lib/bridge-framework/** and the seam face', twinNameList: ['standardTokenInFrameworkFile'], judge: (scenario) => { const fileList = listJs(frameworkTreeOf(scenario), true).concat([path.join(BRIDGE_MAKER_DIR, 'bridgeMaker.js')]); const offenderList = fileList.filter((oneFilePath) => STANDARD_TOKEN_RE.test(fs.readFileSync(oneFilePath, 'utf8'))); return { pass: offenderList.length === 0, detail: offenderList.map((onePath) => `${path.basename(onePath)}: ${STANDARD_TOKEN_RE.exec(fs.readFileSync(onePath, 'utf8'))[0]}`).join(', ') || `${fileList.length} files clean` }; } }),
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
	pureConjunct({ conjunctId: 'i_interfacesOnlyTheTwoBlocks', title: '(i) THE B2 MIGRATION WINDOW (base preBridgeFramework-081626, which never moves): MANIFEST_HANDLE_SHAPE byte-equal to the tag; bridgeMaker.run arity/argKeys equal; resultKeys null → the 13-key list; BRIDGE_MODULE_SHAPE gone', twinNameList: ['argKeysAltered'], judge: (scenario) => { const atTag = loadInterfacesAtTag(); const atHead = scenario.interfacesAtHeadOverride === undefined ? require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'interfaces.js')) : scenario.interfacesAtHeadOverride; const manifestEqual = JSON.stringify(atTag.MANIFEST_HANDLE_SHAPE) === JSON.stringify(atHead.MANIFEST_HANDLE_SHAPE); const callEqual = atTag.COMPONENT_SHAPES.bridgeMaker.run.arity === atHead.COMPONENT_SHAPES.bridgeMaker.run.arity && JSON.stringify(atTag.COMPONENT_SHAPES.bridgeMaker.run.argKeys) === JSON.stringify(atHead.COMPONENT_SHAPES.bridgeMaker.run.argKeys); const resultKeysMoved = atTag.COMPONENT_SHAPES.bridgeMaker.run.resultKeys === null && Array.isArray(atHead.COMPONENT_SHAPES.bridgeMaker.run.resultKeys) && atHead.COMPONENT_SHAPES.bridgeMaker.run.resultKeys.length === 13; const shapeGone = atTag.BRIDGE_MODULE_SHAPE !== undefined && atHead.BRIDGE_MODULE_SHAPE === undefined; return { pass: manifestEqual && callEqual && resultKeysMoved && shapeGone, detail: `manifest ${manifestEqual}, call ${callEqual}, resultKeys ${resultKeysMoved}, BRIDGE_MODULE_SHAPE gone ${shapeGone}` }; } }),
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
	{ harness, familyName: 'BG-NOSUB+BG-COMPOSE+BG-SEAM-UNTOUCHED+BG-HYGIENE+BG-SWEEP', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject, expectedConjunctCount: 9 + 3 + 5 + 4 + 5 }, // BG-SEAM-UNTOUCHED 4 -> 5: the (i) split, 2026-09-01
	() => { removeScratchWorkTree(); harness.report(); },
);
