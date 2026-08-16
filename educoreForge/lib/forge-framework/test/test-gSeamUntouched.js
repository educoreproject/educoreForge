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
const PRE_MIGRATION_REF = 'preEdfiMigration-081626'; // the tag AMBER_TRAIL cut at 428ca06 (F3a CLEARED HEAD) before the Ed-Fi migration (F3b, ruling 03:20 #5); before F3b: ae41a89 (F3a start)
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
	// OWNED by lib/bridge-framework/test/test-bgSeamUntouched.js (BG-SEAM-UNTOUCHED (i)), which asserts interfaces.js against
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
