#!/usr/bin/env node
'use strict';

// writeScopeAndSections.js — the CLI that writes a release bridge's reachable-subject list and section
// partition file from the release's own forge (DESIGN-pescForge.md §4.1; DESIGN-pescBridge.md §1.1).
// It forges the bundle's pinned snapshot through the bundle's entry module (no embedding, no Docker),
// and hands the result to writeScopeAndSectionsLib.js, which holds the rules.
//
// Run: node lib/pesc-release-forge/tools/writeScopeAndSections.js \
//        --bundle=forges/pesccollegetranscript1v8v0 --outputDir=forges/pesccollegetranscript1v8v0/bridges

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- write a PESC release bridge's scope list and section partition file

SYNOPSIS
     ${moduleName} --bundle=<forges/<standardKey>> --outputDir=<dir>

DESCRIPTION
     Forges the bundle's default snapshot (skipEmbedding) and writes, into --outputDir,
     <plugin prefix>ReachableSubjects.json (the reachable element declarations' stableIds, sorted) and
     <plugin prefix>SectionPartition.tsv (sectionPath, documentSection; one row per section), then
     prints both paths, the counts and the section file's sha256 (the plugin declaration restates it).
     Refuses, writing nothing, when the forge refuses, when the reachable marks and the occurrences
     disagree, or when --outputDir is not a directory. Existing files of those names are replaced:
     they are derived, and the change is the diff a reviewer reads.

EXIT
     0 both files were written;  1 refused.
`;

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const rosterLib = require(path.join(TREE_ROOT, 'lib', 'forge-framework', 'roster'));
const releaseBundle = require('../releaseBundle');
const { writeScopeAndSectionsFiles } = require('./writeScopeAndSectionsLib');

const FLAG_NAME_LIST = Object.freeze(['bundle', 'outputDir']);
const SNAPSHOT_CONTAINER_RELATIVE_PATH = path.join('assets', 'standardSourceData');

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
const bundleDirPath = path.resolve(flagValueOf('bundle'));
const descriptorFilePath = path.join(bundleDirPath, rosterLib.DESCRIPTOR_FILE_NAME);
if (!fs.existsSync(descriptorFilePath)) {
	refuseAndExit(`--bundle '${bundleDirPath}' holds no ${rosterLib.DESCRIPTOR_FILE_NAME}`);
}
const descriptorValueByName = rosterLib.readDescriptorSection(descriptorFilePath).valueByName;
const { releaseDeclarationData } = releaseBundle.readBundleData({ bundleDirPath });
const bundleFactory = require(path.join(bundleDirPath, descriptorValueByName.entryModule));

bundleFactory({ embedder: null }).forge({ sourcePath: path.join(bundleDirPath, SNAPSHOT_CONTAINER_RELATIVE_PATH, descriptorValueByName.defaultSnapshot), owner: moduleName, skipEmbedding: true }, (forgeError, forged) => {
	if (forgeError) {
		refuseAndExit(`the forge of ${releaseDeclarationData.standardKey} refused: ${forgeError}`);
		return;
	}
	writeScopeAndSectionsFiles({ nodeList: forged.nodes, edgeList: forged.edges, labelPrefix: releaseDeclarationData.labelPrefix, outputDirPath: path.resolve(flagValueOf('outputDir')) }, (writeError, written) => {
		if (writeError) {
			refuseAndExit(writeError);
			return;
		}
		xLog.result(`${moduleName}: ${written.reachableSubjectStableIdList.length} reachable subjects → ${written.scopeFilePath}`);
		xLog.result(`${moduleName}: ${written.sectionRowList.length} sections → ${written.sectionFilePath} (sha256 ${written.sectionFileSha256})`);
	});
});
