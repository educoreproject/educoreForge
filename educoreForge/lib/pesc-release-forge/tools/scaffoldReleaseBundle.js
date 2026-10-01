#!/usr/bin/env node
'use strict';

// scaffoldReleaseBundle.js — the CLI that writes one PESC release bundle (DESIGN-pescForge.md §4.2).
// Adding a release is: expander run, this, a recipe line, a build. The work is in
// scaffoldReleaseBundleLib.js; this file reads the flags and the facts of the moment (today's date,
// the expander's git commit), and calls it.
//
// Run: node lib/pesc-release-forge/tools/scaffoldReleaseBundle.js \
//        --releaseFolder=<pescReleaseExpander/system/dataStores/releases/CollegeTranscript_v1.8.0> \
//        --manifest=<pescReleaseExpander/system/dataStores/releases/releaseManifest.json> \
//        --outputRoot=<educoreForge/forges> \
//        --expanderCodeDir=<pescReleaseExpander/system/code>

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- write one PESC release forge bundle from a release folder and its manifest entry

SYNOPSIS
     ${moduleName} --releaseFolder=<dir> --manifest=<releaseManifest.json> --outputRoot=<forges dir> --expanderCodeDir=<dir>

DESCRIPTION
     Refuses, writing nothing, when the folder disagrees with its manifest entry, when the parser
     refuses any construct in it, when a reference leaves the release, or when the bundle directory
     already exists. Otherwise writes <outputRoot>/<standardKey>/ and prints what it wrote.
     --expanderCodeDir is pescReleaseExpander's git repository; its HEAD commit is recorded in the
     bundle's README_PROVENANCE.md.

EXIT
     0 the bundle was written;  1 refused.
`;

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const { scaffoldReleaseBundle } = require('./scaffoldReleaseBundleLib');

const FLAG_NAME_LIST = Object.freeze(['releaseFolder', 'manifest', 'outputRoot', 'expanderCodeDir']);

const refuseAndExit = (refusalText) => {
	xLog.error(`${moduleName}: REFUSED: ${refusalText}`);
	process.exit(1);
};
const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};

const missingFlagName = FLAG_NAME_LIST.find((oneFlagName) => typeof flagValueOf(oneFlagName) !== 'string' || flagValueOf(oneFlagName).length === 0);
if (missingFlagName !== undefined) {
	refuseAndExit(`--${missingFlagName} is required (${helpText.split('SYNOPSIS')[1].split('DESCRIPTION')[0].trim()})`);
}
const expanderCodeDirPath = path.resolve(flagValueOf('expanderCodeDir'));
if (!fs.existsSync(path.join(expanderCodeDirPath, '.git'))) {
	refuseAndExit(`--expanderCodeDir '${expanderCodeDirPath}' is not a git repository`);
}
const expanderCommit = childProcess.execFileSync('git', ['-C', expanderCodeDirPath, 'rev-parse', 'HEAD']).toString().trim();
const expanderStatusText = childProcess.execFileSync('git', ['-C', expanderCodeDirPath, 'status', '--porcelain']).toString().trim();
const expanderProvenanceText = `${expanderCodeDirPath} at commit ${expanderCommit} (${expanderStatusText === '' ? 'clean working tree' : 'working tree had uncommitted changes'})`;

scaffoldReleaseBundle(
	{
		releaseFolderPath: path.resolve(flagValueOf('releaseFolder')),
		manifestPath: path.resolve(flagValueOf('manifest')),
		outputRootPath: path.resolve(flagValueOf('outputRoot')),
		expanderProvenanceText,
		scaffoldCommandText: `node ${path.relative(TREE_ROOT, __filename)} ${FLAG_NAME_LIST.map((oneFlagName) => `--${oneFlagName}=${flagValueOf(oneFlagName)}`).join(' ')}`,
		copiedDateText: new Date().toISOString().slice(0, 10),
	},
	(scaffoldError, scaffolded) => {
		if (scaffoldError) {
			refuseAndExit(scaffoldError);
			return;
		}
		xLog.result(`${moduleName}: wrote ${scaffolded.bundleDirPath} (${scaffolded.releaseNames.standardSource}, '${scaffolded.releaseNames.standardDisplayName}')`);
		scaffolded.writtenRelativePathList.forEach((oneRelativePath) => xLog.result(`  ${oneRelativePath}`));
		xLog.result(`  census: ${JSON.stringify(scaffolded.releaseCensus)}`);
	},
);
