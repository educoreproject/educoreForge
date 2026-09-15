#!/usr/bin/env node
'use strict';

// test-gSeamUntouched.js — G-SEAM-UNTOUCHED (SPEC-forgeFramework-v1.md §10.1; FR16; §11.14): the seam
// files are UNTOUCHED relative to the pre-migration reference — `git diff --stat <ref> -- <seam files>` is
// EMPTY. The reference is the F3a starting commit (ae41a89, HEAD when the Forge Framework order began);
// F3b re-points it at its own pre-migration tag. The file list is the SPEC's plus round-trip-stage.js
// (the stage that invokes every validator — a seam for the harness side). Twin: a comment touched in
// forger.js inside a SCRATCH WORKTREE (git worktree add … in os.tmpdir) → the diff is non-empty → red.
//
// Run: node lib/forge-framework/test/test-gSeamUntouched.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-SEAM-UNTOUCHED: git diff --stat against the pre-migration reference over the seam files is EMPTY

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const toyScenario = require('./testSupport/toyScenario');
const { scenarioTwin } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');

const GATE_ID = 'G-SEAM-UNTOUCHED';
const twinRegistry = makeTwinRegistry();
const TREE_ROOT = path.resolve(toyScenario.FRAMEWORK_DIR, '..', '..');
// PHASE 2a RE-ANCHOR (SILVER_TIDE, 2026-08-29) — THE RULED MOVE R-HUB-1 EXISTS FOR.
// preEdfiMigration-081626 (428ca06) -> post2aHubDiscovery-082926 (7db272c).
//
// CAUSE, named in the gate's own data: SEAM_FILE_LIST pins apps/graph-builder/apps/forger/forger.js
// AND apps/graph-builder/lib/build.js, and Phase 2a is the FIRST phase to touch either since
// 2026-08-16. R-HUB-1 supersedes the D9 clause "build.js, forger, replay: untouched" for the hub
// dispatch site in forger.js and for the I7b refusal in build.js. Everything else in SEAM_FILE_LIST
// — shape-forged-graph, replay-engine, replay-block, replayManager, round-trip-stage — is untouched
// and this move does not license touching it.
//
// THE BASELINE MOVES; THE FILE LIST DOES NOT. SEAM_FILE_LIST is byte-identical.
//
// ⚠ THIS COMMIT IS PREDICTED TO TURN BG-NOSUB CONJUNCT (iii) RED, AND THAT IS CORRECT BEHAVIOUR,
// NOT A REGRESSION. (iii) demands the lib/forge-framework/ diff from its own anchor be EMPTY and it
// applies NO exclusion, while seamDiffEmpty EXCLUDES this very file — so the ruled edit lands inside
// (iii)'s watched set and outside seamDiffEmpty's. DEVLOG OPEN ITEM 8 predicted this collision from
// Phase 0 and the docket names the remedy: commit this move ALONE, tag at it, re-anchor (iii) to
// that tag, re-observe (iii)'s twin red. DO NOT add a test-gSeamUntouched.js exclusion to (iii) —
// its entire value since the Phase 0 re-anchor is that it admits NOTHING, and an exclusion hands
// back permanently the blind spot that re-anchor closed.
//
// PREVIOUS BASE, in full, so the move is legible without the log: preEdfiMigration-081626 @ 428ca06,
// the tag AMBER_TRAIL cut at F3a CLEARED HEAD before the Ed-Fi migration (F3b, ruling 03:20 #5);
// before F3b: ae41a89 (F3a start).
// ⚠ MOVED 2026-08-29 by WILD_SHARD (Phase 7, RULING FJ-P7-3). THE BASELINE MOVES; THE FILE LIST DOES
// NOT — SEAM_FILE_LIST is byte-identical across this commit.
//
// CAUSE, MEASURED WITH THIS GATE'S OWN COMMAND, and it is exactly ONE file of the seven:
//   git diff --stat post2aHubDiscovery-082926 -- <the 7 seam files>
//     apps/graph-builder/lib/build.js | 78 +++++
// build.js gains the pre-spend declaration-collision refusal that RULING FJ-P7-1 placed BEFORE PHASE A.
// Phase 7 migrates no forge; the other six seam files are untouched.
//
// ⚠ AND THIS EDIT NECESSARILY TURNS BG-NOSUB CONJUNCT (iii) RED, WHICH IS PREDICTED, NOT ACCIDENTAL.
// (iii) demands the lib/forge-framework/ diff from its anchor be EMPTY and applies NO exclusion, while
// seamDiffEmpty EXCLUDES this very file. So a ruled edit here lands inside (iii)'s watched set and
// outside seamDiffEmpty's — the collision DEVLOG open item 8 named in Phase 0 and Phase 2a paid. The
// ruled remedy is the same three steps: commit this move ALONE, tag at that commit, re-anchor (iii) to
// the tag and re-observe its twin red. NOT an exclusion for this file in (iii): its entire value is that
// it admits nothing.
//
// ═══ RE-ANCHOR, 2026-09-01 (GRANITE_ECHO), graphSelfDoc campaign close ═══
// post7OptInDiscriminator-082926 -> postGraphSelfDoc-090126 (4b122b0).
// Four authorised commits moved watched files past the old ref: 170e16a (Phase 6 prose), f87f7da +
// d0879c0 (versionFromStamp — the forge framework now reads the version from the stamp, which is
// exactly a seam file moving for a ruled reason), 4b122b0 (graphSelfDoc — build.js gained the finish
// call at materialize's tail). seamDiffEmpty is a "nothing has moved since" assertion and says
// nothing useful against a base that predates authorised moves.
// THE SEAM FILE LIST IS UNCHANGED — the baseline moves, the scope never widens — and the twin was
// re-observed red against THIS ref before the move was accepted.
// ═══ RE-ANCHOR, 2026-09-02 (TWILIGHT_ARROW), SIF via-conservation order ═══
// postGraphSelfDoc-090126 -> postSifViaConservation-090226 (dec08ad). Three of the seven seam files
// moved for ruled reasons: build.js and replayManager.js (the conservation gate at the harvest seam)
// and replay-engine.js (the merge now keys on the full property map so distinct-by-value edges
// survive). THE SEAM FILE LIST IS UNCHANGED — the baseline moves, the scope never widens — and the
// twin was re-observed red against THIS ref before the move was accepted.
// ═══ RE-ANCHOR, 2026-09-02 (TWILIGHT_ARROW), JOBS 5+6 ═══ three of the seven seam files moved for ruled
// reasons: build.js (artifact writer, bridge summary threading), replay-engine.js (shared identity guard
// and function), replayManager.js (conservation record, harvest keying). List unchanged; twin re-observed red.
// ═══ RE-ANCHOR, 2026-09-15 (RADIANT_QUEST), forge embed-text revision P8 (PLAN-forgeEmbedText-091426.md R-ET-6/7; HANDOFF decision 3) ═══
// postJudgeRegistryJob4b-090726 (ce33088) -> postEmbedTextP7-091526. PREVIOUS BASE IN FULL: postJudgeRegistryJob4b-090726 at ce33088,
// DAWN_TOWER's second JOB 4 re-anchor of 2026-09-07 (the line above this block, now history).
//
// CENSUS AT THE RE-ANCHOR, MEASURED WITH THIS GATE'S OWN COMMAND (git diff --stat postJudgeRegistryJob4b-090726 -- <the 7 seam
// files>), and it is exactly THREE of the seven, every one attributed to a commit by git log:
//   apps/graph-builder/lib/build.js                          |  32 +++-  021d1d7 — the NAMED SUBJECT SET flag (TQ's judge
//                                                                        refinement, 2026-09-10); BG seamDiffEmpty absorbed it at
//                                                                        postNamedSubjectSet-091026 and THIS gate never did
//   apps/graph-builder/apps/forger/lib/shape-forged-graph.js |  67 +++++- 7bfd1be — P4: the vector-slot lift, embedSourceProperty /
//                                                                        vectorPropertyName carried from the mint to the shaped node
//   lib/replay/replay-engine.js                              | 179 +++++ 7bfd1be, af8cfdc, b0f7d45 — P4: the vectorPropertyName
//                                                                        discriminator, the fourth pre-write guard (R-ET-37), the second
//                                                                        vector index (EMBED_TEXT_VECTOR), and one prose fix
// forger.js, replay-block.js, replayManager.js and round-trip-stage.js: UNTOUCHED (the campaign's loader change lives in
// replay-engine.js alone, as R-ET-8's site list said it would).
// THE SEAM FILE LIST IS UNCHANGED — the baseline moves, the scope never widens — and the twin was re-observed red against
// THIS ref before the move was accepted. The tag is cut ON the re-anchor commit (this file lives under lib/forge-framework/,
// which BG conjunct (iii) watches with no exclusion — TWILIGHT_ARROW's rule, 2026-09-03). The same commit moves the four BG
// anchors, for the reason recorded in test-bgNosub.js beside them.
const PRE_MIGRATION_REF = 'postEmbedTextP7-091526'; // re-anchored by RADIANT_QUEST, forge embed-text P8; the tag is cut ON the re-anchor commit
const SEAM_FILE_LIST = Object.freeze([
	'apps/graph-builder/apps/forger/forger.js',
	'apps/graph-builder/lib/build.js',
	'apps/graph-builder/apps/forger/lib/shape-forged-graph.js',
	'lib/replay/replay-engine.js',
	'lib/replay/replay-block.js',
	'apps/graph-builder/apps/replay-manager/replayManager.js',
	// apps/graph-builder/interfaces.js — REMOVED from this list 2026-08-16 (RULING SABLE_RIVER 17:10, B2 order): the Bridge
	// Framework's B2 interfaces commit (a NAMED exception, RULING BF10 / BR-140) changed exactly the two bridge declaration
	// blocks (bridgeMaker.run resultKeys; BRIDGE_MODULE_SHAPE retired), call contract byte-identical. That conjunct is now
	// OWNED by lib/bridge-framework/test/test-bgNosub.js (family BG-SEAM-UNTOUCHED, conjunct (i)), which asserts interfaces.js against
	// preBridgeFramework-081626 modulo those two blocks; keeping it here would make the forge gate red on an authorized change.
	'apps/graph-builder/lib/round-trip-stage.js', // extended: the stage that invokes every validator (harness seam)
]);

// the git top level is ABOVE the tree root (system/code); the tree lives under a prefix inside it
const GIT_PREFIX = String(spawnSync('git', ['rev-parse', '--show-prefix'], { cwd: TREE_ROOT, encoding: 'utf8' }).stdout || '').trim();
const treeRootInside = (workTreeTopLevel) => (workTreeTopLevel === TREE_ROOT ? TREE_ROOT : path.join(workTreeTopLevel, GIT_PREFIX));

const gitDiffStat = ({ workTreePath }) => spawnSync('git', ['diff', '--stat', PRE_MIGRATION_REF, '--'].concat(SEAM_FILE_LIST), { cwd: workTreePath, encoding: 'utf8' });

const conjunctList = [
	{
		conjunctId: 'seamDiffEmpty',
		title: `git diff --stat ${PRE_MIGRATION_REF.slice(0, 7)} -- <${SEAM_FILE_LIST.length} seam files> is EMPTY (every seam file present, none changed)`,
		twinNameList: ['touchCommentInForgerInScratchWorktree'],
		evaluate: (scenario, callback) => {
			const workTreePath = scenario.workTreePath ? treeRootInside(scenario.workTreePath) : TREE_ROOT;
			const missing = SEAM_FILE_LIST.find((oneRelative) => !fs.existsSync(path.join(workTreePath, oneRelative)));
			if (missing) {
				callback('', { pass: false, detail: `seam file missing on disk: ${missing}` });
				return;
			}
			const run = gitDiffStat({ workTreePath });
			if (run.status !== 0) {
				callback('', { pass: false, detail: `git diff failed: ${run.stderr}` });
				return;
			}
			const statText = String(run.stdout || '').trim();
			callback('', { pass: statText === '', detail: statText === '' ? 'empty diff — the seam is untouched' : `NON-EMPTY diff:\n${statText}` });
		},
	},
];

let scratchWorkTreePath = null;
scenarioTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'seamDiffEmpty', twinName: 'touchCommentInForgerInScratchWorktree', leverKind: 'productionMutation',
	mutate: (scenario) => {
		if (!scratchWorkTreePath) {
			scratchWorkTreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'seamWorktree-'));
			fs.rmdirSync(scratchWorkTreePath);
			const add = spawnSync('git', ['worktree', 'add', '--detach', scratchWorkTreePath, 'HEAD'], { cwd: TREE_ROOT, encoding: 'utf8' });
			if (add.status !== 0) {
				throw new Error(`git worktree add failed: ${add.stderr}`);
			}
			fs.appendFileSync(path.join(treeRootInside(scratchWorkTreePath), 'apps/graph-builder/apps/forger/forger.js'), '\n// touched by the G-SEAM-UNTOUCHED twin\n');
		}
		scenario.workTreePath = scratchWorkTreePath;
	},
});
const removeScratchWorkTree = () => {
	if (scratchWorkTreePath) {
		spawnSync('git', ['worktree', 'remove', '--force', scratchWorkTreePath], { cwd: TREE_ROOT, encoding: 'utf8' });
		scratchWorkTreePath = null;
	}
};
process.on('exit', removeScratchWorkTree);

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the seam, untouched (an instrument)', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: (scenario) => ({ ...toyScenario.cloneScenario(scenario), workTreePath: scenario.workTreePath }), expectedConjunctCount: 1, expectedTwinCount: 1 }, () => { removeScratchWorkTree(); harness.report(); });
