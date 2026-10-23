'use strict';

// suiteDiscovery.js — which files runAllTests runs (zeroBacklog lane A, A3).
//
// A SUITE is every file named test-*.js that sits anywhere below a directory named `test`, found by walking the whole tree.
// It replaced a module-shaped rule (a package.json module's OWN test/ dir, or a lib directory's) that measured 20 suites short
// on 2026-10-22: forges/*/tools/test, apps/graph-builder/apps/replay-manager/lib/finishing/test (a lib/ under an app module)
// and apps/graph-builder/test/bridgeAcceptance (a subdirectory of a test dir) were never run. A naming convention does not
// fall out of step with the tree's shape; a shape rule does, silently.
//
// The directories the walk deliberately does not enter are DATA (test/suiteDiscoveryExclusionList.json), each with its
// reason, and every one is reported back as skipped. A directoryPath entry that no longer exists is refused by name, so an
// exclusion cannot outlive the thing it excluded.
//
// discoverSuites({ treeRootPath, exclusionList }) -> { refusalText, suitePathList, skippedDirectoryList }
//   suitePathList: absolute paths, sorted; skippedDirectoryList: [{ directoryPath (absolute), reason }], sorted
// moduleOwnTestDirSuites({ moduleDirPath }) -> the suites in a module's OWN test/ dir (the old rule; the runner still uses it
//   for the per-module coverage report, and the discovery test uses it as the twin that must miss a nested suite)

const fs = require('fs');
const path = require('path');

const SUITE_FILE_NAME_PATTERN = /^test-.*\.js$/;
const TEST_DIRECTORY_NAME = 'test';
const EXCLUSION_FIELD_LIST = ['directoryName', 'directoryPath', 'reason'];

const exclusionRefusalText = ({ treeRootPath, exclusionList }) => {
	if (!Array.isArray(exclusionList)) {
		return 'suiteDiscovery: REFUSED — exclusionList is not an array';
	}
	const faultList = exclusionList.reduce((soFar, oneExclusion, exclusionIndex) => {
		const unknownFieldList = Object.keys(oneExclusion).filter((oneField) => EXCLUSION_FIELD_LIST.indexOf(oneField) === -1);
		const namedBy = ['directoryName', 'directoryPath'].filter((oneField) => typeof oneExclusion[oneField] === 'string' && oneExclusion[oneField] !== '');
		const entryFaultList = []
			.concat(unknownFieldList.length ? [`unknown field(s) ${unknownFieldList.join(', ')}`] : [])
			.concat(namedBy.length !== 1 ? ['exactly one of directoryName or directoryPath is required'] : [])
			.concat(typeof oneExclusion.reason !== 'string' || oneExclusion.reason.trim() === '' ? ['a reason is required'] : [])
			.concat(
				namedBy[0] === 'directoryPath' && namedBy.length === 1 && !fs.existsSync(path.join(treeRootPath, oneExclusion.directoryPath))
					? [`directoryPath '${oneExclusion.directoryPath}' does not exist: a stale exclusion`]
					: [],
			);
		return soFar.concat(entryFaultList.map((oneFault) => `entry ${exclusionIndex}: ${oneFault}`));
	}, []);
	return faultList.length ? `suiteDiscovery: REFUSED — the exclusion list: ${faultList.join('; ')}` : '';
};

const discoverSuites = ({ treeRootPath, exclusionList }) => {
	const refusalText = exclusionRefusalText({ treeRootPath, exclusionList });
	if (refusalText) {
		return { refusalText, suitePathList: [], skippedDirectoryList: [] };
	}
	const exclusionOf = (directoryPath) =>
		exclusionList.find(
			(oneExclusion) =>
				(oneExclusion.directoryName && path.basename(directoryPath) === oneExclusion.directoryName) ||
				(oneExclusion.directoryPath && path.resolve(treeRootPath, oneExclusion.directoryPath) === directoryPath),
		);
	const suitePathList = [];
	const skippedDirectoryList = [];
	const walk = (directoryPath, isBelowTestDirectory) => {
		fs.readdirSync(directoryPath, { withFileTypes: true }).forEach((oneEntry) => {
			const entryPath = path.join(directoryPath, oneEntry.name);
			if (oneEntry.isDirectory()) {
				const exclusion = exclusionOf(entryPath);
				if (exclusion) {
					skippedDirectoryList.push({ directoryPath: entryPath, reason: exclusion.reason });
					return;
				}
				walk(entryPath, isBelowTestDirectory || oneEntry.name === TEST_DIRECTORY_NAME);
				return;
			}
			if (isBelowTestDirectory && oneEntry.isFile() && SUITE_FILE_NAME_PATTERN.test(oneEntry.name)) {
				suitePathList.push(entryPath);
			}
		});
	};
	walk(path.resolve(treeRootPath), false);
	return {
		refusalText: '',
		suitePathList: suitePathList.sort(),
		skippedDirectoryList: skippedDirectoryList.sort((left, right) => (left.directoryPath < right.directoryPath ? -1 : left.directoryPath > right.directoryPath ? 1 : 0)),
	};
};

const moduleOwnTestDirSuites = ({ moduleDirPath }) => {
	const testDirPath = path.join(moduleDirPath, TEST_DIRECTORY_NAME);
	if (!fs.existsSync(testDirPath)) {
		return [];
	}
	return fs
		.readdirSync(testDirPath)
		.filter((oneName) => SUITE_FILE_NAME_PATTERN.test(oneName))
		.sort()
		.map((oneName) => path.join(testDirPath, oneName));
};

module.exports = { discoverSuites, moduleOwnTestDirSuites, SUITE_FILE_NAME_PATTERN };
