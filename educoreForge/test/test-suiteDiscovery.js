#!/usr/bin/env node
'use strict';

// test-suiteDiscovery.js — ⟪zeroBacklog lane A, A3⟫ runAllTests runs every suite the tree holds, by naming convention.
//
// The module-shaped rule this replaced ran 20 suites fewer than the tree held (measured 2026-10-22). This suite builds a small
// SCRATCH tree in the system temporary directory, shaped like the three places the old rule missed, and proves the tree-wide
// discovery (test/testLib/suiteDiscovery.js) finds them; then it checks the REAL tree against git's own list of tracked
// test-*.js files.
//
// CONJUNCTS
//   a  a planted suite in a NEW nested test dir (apps/app1/test/deep/newer/) is found
//   b  a forge's tools/test suite and a suite under a lib/ dir inside an app module are found
//   c  the module rule's suites are all found (the discovery is a superset of what used to run)
//   d  excluded directories are skipped and REPORTED with their reasons: by name (node_modules, anywhere) and by path
//   e  a test-*.js NOT below a directory named test is not a suite
//   f  the real tree: the discovered suites are exactly git's tracked test-*.js files minus those under the excluded directories
//   g  a malformed exclusion list is refused by name: a stale directoryPath, an unknown field, no reason, both names given
//
// RED TWINS: a, b and d are each observed red under a changed discoverer or exclusion list (the old module rule; an empty
// exclusion list). A conjunct whose twin is not observed red fails the suite.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- runAllTests discovers every test-*.js below a test/ directory, skipping only declared exclusions

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Builds a scratch tree in the system temporary directory (removed afterwards), runs the tree-wide discovery and the old
     module rule over it, checks the real tree against git ls-files, and observes each discovery conjunct red under a twin.

EXIT STATUS
     0 every conjunct passed and every twin observed red;  1 otherwise.
`;

require('./testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('./testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { discoverSuites, moduleOwnTestDirSuites } = require('./testLib/suiteDiscovery');

const TREE_ROOT = path.join(__dirname, '..');
const REAL_EXCLUSION_LIST = JSON.parse(fs.readFileSync(path.join(__dirname, 'suiteDiscoveryExclusionList.json'), 'utf8')).exclusionList;

// ---- the scratch tree: one file per shape the old rule handled or missed ----
const scratchRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'suiteDiscovery-'));
const SCRATCH_FILE_LIST = [
	'apps/app1/package.json',
	'apps/app1/test/test-ownSuite.js', //                       the old rule's shape
	'apps/app1/test/deep/newer/test-plantedNested.js', //       a: a new nested test dir
	'apps/app1/apps/inner/lib/finishing/test/test-libInsideApp.js', // b: a lib/ dir inside an app module
	'forges/forge1/package.json',
	'forges/forge1/tools/test/test-forgeTool.js', //             b: a forge's tools/test
	'apps/app1/lib/test-notASuite.js', //                        e: test-*.js not below a test dir
	'apps/app1/node_modules/dep/test/test-dependency.js', //     d: excluded by name
	'retired/old/test/test-retiredSuite.js', //                  d: excluded by path
];
SCRATCH_FILE_LIST.forEach((relativePath) => {
	fs.mkdirSync(path.join(scratchRootPath, path.dirname(relativePath)), { recursive: true });
	fs.writeFileSync(path.join(scratchRootPath, relativePath), relativePath.endsWith('package.json') ? '{}\n' : "'use strict';\n");
});
const SCRATCH_EXCLUSION_LIST = [
	{ directoryName: 'node_modules', reason: 'scratch: third-party' },
	{ directoryPath: 'retired', reason: 'scratch: retired code' },
];
const scratchPath = (relativePath) => path.join(scratchRootPath, relativePath);
const relativeToScratch = (absolutePath) => path.relative(scratchRootPath, absolutePath);

// the OLD rule over the scratch tree, as a discoverer of the same shape: the module dirs' own test/ dirs
const oldRuleDiscover = ({ treeRootPath }) => ({
	refusalText: '',
	suitePathList: ['apps/app1', 'apps/app1/apps/inner', 'forges/forge1']
		.reduce((soFar, moduleRelativePath) => soFar.concat(moduleOwnTestDirSuites({ moduleDirPath: path.join(treeRootPath, moduleRelativePath) })), [])
		.sort(),
	skippedDirectoryList: [],
});

const judgeByConjunct = {
	a_plantedNestedSuiteFound: ({ discovered }) => ({
		pass: discovered.suitePathList.indexOf(scratchPath('apps/app1/test/deep/newer/test-plantedNested.js')) !== -1,
		detail: `found: ${discovered.suitePathList.map(relativeToScratch).join(', ')}`,
	}),
	b_toolsTestAndLibInsideAppFound: ({ discovered }) => {
		const missingList = ['forges/forge1/tools/test/test-forgeTool.js', 'apps/app1/apps/inner/lib/finishing/test/test-libInsideApp.js'].filter(
			(relativePath) => discovered.suitePathList.indexOf(scratchPath(relativePath)) === -1,
		);
		return { pass: missingList.length === 0, detail: missingList.length ? `missing: ${missingList.join(', ')}` : 'both found' };
	},
	c_supersetOfTheModuleRule: ({ discovered }) => {
		const lostList = oldRuleDiscover({ treeRootPath: scratchRootPath }).suitePathList.filter((suitePath) => discovered.suitePathList.indexOf(suitePath) === -1);
		return { pass: lostList.length === 0, detail: lostList.length ? `lost: ${lostList.map(relativeToScratch).join(', ')}` : 'every module-rule suite found' };
	},
	d_exclusionsSkippedAndReported: ({ discovered }) => {
		const foundExcludedList = ['apps/app1/node_modules/dep/test/test-dependency.js', 'retired/old/test/test-retiredSuite.js'].filter(
			(relativePath) => discovered.suitePathList.indexOf(scratchPath(relativePath)) !== -1,
		);
		const reportedText = discovered.skippedDirectoryList.map((oneSkip) => `${relativeToScratch(oneSkip.directoryPath)} (${oneSkip.reason})`).join(', ');
		const reportedBoth = reportedText === 'apps/app1/node_modules (scratch: third-party), retired (scratch: retired code)';
		return { pass: foundExcludedList.length === 0 && reportedBoth, detail: `run though excluded: [${foundExcludedList.join(', ')}]; reported skips: ${reportedText}` };
	},
	e_testNamedFileOutsideTestDirIsNotASuite: ({ discovered }) => ({
		pass: discovered.suitePathList.indexOf(scratchPath('apps/app1/lib/test-notASuite.js')) === -1,
		detail: discovered.suitePathList.indexOf(scratchPath('apps/app1/lib/test-notASuite.js')) === -1 ? 'not a suite' : 'counted as a suite',
	}),
};

harness.section('THE SCRATCH TREE — every shape found, every exclusion skipped and reported');
const discovered = discoverSuites({ treeRootPath: scratchRootPath, exclusionList: SCRATCH_EXCLUSION_LIST });
harness.equal('the scratch discovery is not refused', discovered.refusalText, '');
Object.keys(judgeByConjunct).forEach((conjunctRefId) => {
	const verdict = judgeByConjunct[conjunctRefId]({ discovered });
	harness.ok(`${conjunctRefId} PASS`, verdict.pass, verdict.detail);
	harness.note(`${conjunctRefId}: ${verdict.detail}`);
});

harness.section('THE TWIN SWEEP — each discovery conjunct OBSERVED RED under a changed discoverer or exclusion list');
const TWIN_LIST = [
	{ conjunctRefId: 'a_plantedNestedSuiteFound', twinName: 'theOldModuleRule', subject: () => ({ discovered: oldRuleDiscover({ treeRootPath: scratchRootPath }) }) },
	{ conjunctRefId: 'b_toolsTestAndLibInsideAppFound', twinName: 'theOldModuleRule', subject: () => ({ discovered: oldRuleDiscover({ treeRootPath: scratchRootPath }) }) },
	{ conjunctRefId: 'd_exclusionsSkippedAndReported', twinName: 'noExclusionList', subject: () => ({ discovered: discoverSuites({ treeRootPath: scratchRootPath, exclusionList: [] }) }) },
	{ conjunctRefId: 'e_testNamedFileOutsideTestDirIsNotASuite', twinName: 'anyTestNamedFileCounted', subject: () => ({ discovered: { ...discovered, suitePathList: discovered.suitePathList.concat([scratchPath('apps/app1/lib/test-notASuite.js')]) } }) },
	{ conjunctRefId: 'c_supersetOfTheModuleRule', twinName: 'ownTestDirDropped', subject: () => ({ discovered: { ...discovered, suitePathList: discovered.suitePathList.filter((suitePath) => suitePath !== scratchPath('apps/app1/test/test-ownSuite.js')) } }) },
];
const reddenedConjunctSet = new Set();
TWIN_LIST.forEach((oneTwin) => {
	const verdict = judgeByConjunct[oneTwin.conjunctRefId](oneTwin.subject());
	harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
	harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail.slice(0, 200)}`);
	if (!verdict.pass) {
		reddenedConjunctSet.add(oneTwin.conjunctRefId);
	}
});
harness.equal('every discovery conjunct has an observed twin', Object.keys(judgeByConjunct).filter((conjunctRefId) => !reddenedConjunctSet.has(conjunctRefId)).join(','), '');

harness.section('f — the REAL tree: exactly git\'s tracked test-*.js below a test/ dir, minus the declared exclusions');
const realDiscovery = discoverSuites({ treeRootPath: TREE_ROOT, exclusionList: REAL_EXCLUSION_LIST });
harness.equal('f: the real discovery is not refused', realDiscovery.refusalText, '');
const gitListRun = spawnSync('git', ['ls-files', '--', '.'], { cwd: TREE_ROOT, encoding: 'utf8' });
const isExcludedRelativePath = (relativePath) =>
	REAL_EXCLUSION_LIST.some(
		(oneExclusion) =>
			(oneExclusion.directoryName && relativePath.split('/').slice(0, -1).indexOf(oneExclusion.directoryName) !== -1) ||
			(oneExclusion.directoryPath && relativePath.startsWith(`${oneExclusion.directoryPath}/`)),
	);
const trackedSuiteList = String(gitListRun.stdout || '')
	.split('\n')
	.filter((relativePath) => /(^|\/)test-[^/]*\.js$/.test(relativePath) && relativePath.split('/').slice(0, -1).indexOf('test') !== -1 && !isExcludedRelativePath(relativePath))
	.sort();
const discoveredRelativeList = realDiscovery.suitePathList.map((suitePath) => path.relative(TREE_ROOT, suitePath)).sort();
harness.equal('f: git ls-files ran', gitListRun.status, 0);
harness.equal(
	'f: discovered = tracked (no tracked suite missed, no untracked file run)',
	JSON.stringify({ missed: trackedSuiteList.filter((oneSuite) => discoveredRelativeList.indexOf(oneSuite) === -1), untracked: discoveredRelativeList.filter((oneSuite) => trackedSuiteList.indexOf(oneSuite) === -1) }),
	JSON.stringify({ missed: [], untracked: [] }),
);
harness.note(`f: ${discoveredRelativeList.length} suite(s) discovered; skipped: ${realDiscovery.skippedDirectoryList.map((oneSkip) => path.relative(TREE_ROOT, oneSkip.directoryPath)).join(', ')}`);

harness.section('g — a malformed exclusion list is refused by name');
const refusalFor = (exclusionList) => discoverSuites({ treeRootPath: scratchRootPath, exclusionList }).refusalText;
harness.match('g: a stale directoryPath is refused', refusalFor([{ directoryPath: 'noSuchDirectory', reason: 'r' }]), /directoryPath 'noSuchDirectory' does not exist: a stale exclusion/);
harness.match('g: an unknown field is refused', refusalFor([{ directoryName: 'node_modules', reason: 'r', why: 'x' }]), /unknown field\(s\) why/);
harness.match('g: an entry with no reason is refused', refusalFor([{ directoryName: 'node_modules' }]), /a reason is required/);
harness.match('g: an entry naming both is refused', refusalFor([{ directoryName: 'node_modules', directoryPath: 'retired', reason: 'r' }]), /exactly one of directoryName or directoryPath/);
harness.match('g: a list that is not an array is refused', refusalFor({ directoryName: 'node_modules' }), /exclusionList is not an array/);
harness.equal('g: CONTROL — the well-formed scratch list is admitted', refusalFor(SCRATCH_EXCLUSION_LIST), '');

fs.rmSync(scratchRootPath, { recursive: true, force: true });
harness.report();
