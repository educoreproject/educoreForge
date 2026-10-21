#!/usr/bin/env node
'use strict';

// hubLiteralCensus.js — the CLI over apps/graph-builder/lib/hub-literal-census.js (R0 proof kit, 2026-10-21, step 9): count
// a hub's name outside that hub's own forge bundle, by class, and optionally hold the count against a recorded baseline.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = `
NAME
     ${moduleName} -- count a hub's name in the tree outside its own forge bundle, by class (read-only)

SYNOPSIS
     ${moduleName} --hubToken=<bundle token> [--outputFilePath=<json>] [--baselineCensusPath=<json>] [-list] [-help]

DESCRIPTION
     Reads every TRACKED file of this tree (git ls-files) outside forges/<hubToken>/ and counts the hub token,
     case-insensitive, where it starts a name (a lower-case run inside another word is not counted; the rules file
     declares the few words that start with the token and are still not the hub). Writes nothing unless
     --outputFilePath is given.

     Classes, from apps/graph-builder/lib/hubLiteralCensusRules.json (first matching path rule wins):
       code             .js text outside comments (string literals included: they are runtime text)
       comments         .js text inside // or /* */
       data             any other file outside the classes below (recipes, json, tsv, ini)
       testsAndFixtures test/, fixtures/, testSupport/, probes/
       docs             .md, README*, .txt, .html
       assets           forges/<bundle>/assets/, bridgeData/
       retired          codeAttic/, experiments/, retiredBridges/
     Each class reports lineCount (lines holding at least one occurrence), occurrenceCount and fileCount.

     --baselineCensusPath  a census written earlier by this tool for the SAME hub token. The run then FAILS if the
                           code class's lineCount or occurrenceCount rose; every class's change is printed.
     -list                 print every counted line (path:line) under its class

EXIT STATUS
     0 counted (and, with --baselineCensusPath, the code count did not rise);  1 the code count rose, or refused.

EXAMPLES
     node apps/graph-builder/tools/hubLiteralCensus.js --hubToken=<hub> --outputFilePath=<lane dataStore>/baseline/literalCensus.json
     node apps/graph-builder/tools/hubLiteralCensus.js --hubToken=<hub> --baselineCensusPath=<lane dataStore>/baseline/literalCensus.json
`;

const fs = require('fs');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
require(path.join(TREE_ROOT, 'test', 'testLib', 'testAppStartup'))({ moduleName, helpText });
const { xLog, commandLineParameters } = process.global;
const hubLiteralCensusLib = require(path.join(__dirname, '..', 'lib', 'hub-literal-census'));

// xLog.result writes raw text (no newline of its own)
const say = (lineText) => xLog.result(`${lineText}\n`);
const flagValueOf = (flagName) => {
	const flagValue = commandLineParameters.values[flagName];
	return Array.isArray(flagValue) ? flagValue[0] : flagValue;
};
const refuse = (reasonText) => {
	xLog.error(`${moduleName}: REFUSED: ${reasonText}\n(${moduleName} -help for the full page)`);
	process.exit(1);
};
// the class whose count may never rise
const GATED_CLASS_NAME = 'code';

const hubToken = flagValueOf('hubToken');
if (typeof hubToken !== 'string' || hubToken === '') {
	refuse('--hubToken is required and absent. There is no default hub.');
}
const counted = hubLiteralCensusLib.censusOfTree({ treeRootPath: TREE_ROOT, hubToken, rules: hubLiteralCensusLib.readRules() });
if (counted.error) {
	refuse(counted.error);
}
const { census } = counted;
census.treeHead = require('child_process').spawnSync('git', ['-C', TREE_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

Object.keys(census.countByClass).forEach((className) => {
	const oneCount = census.countByClass[className];
	say(`${className.padEnd(17)} lines ${String(oneCount.lineCount).padStart(7)}  occurrences ${String(oneCount.occurrenceCount).padStart(7)}  files ${String(oneCount.fileCount).padStart(5)}`);
});
if (commandLineParameters.switches.list) {
	Object.keys(census.occurrenceListByClass).forEach((className) => census.occurrenceListByClass[className].forEach((oneLocation) => say(`${className} ${oneLocation}`)));
}
if (typeof flagValueOf('outputFilePath') === 'string') {
	fs.writeFileSync(flagValueOf('outputFilePath'), `${JSON.stringify(census, null, '\t')}\n`);
	say(`${moduleName}: wrote ${flagValueOf('outputFilePath')}`);
}

let gatePassed = true;
if (typeof flagValueOf('baselineCensusPath') === 'string') {
	if (!fs.existsSync(flagValueOf('baselineCensusPath'))) {
		refuse(`--baselineCensusPath ${flagValueOf('baselineCensusPath')} is not on disk`);
	}
	const baselineCensus = JSON.parse(fs.readFileSync(flagValueOf('baselineCensusPath'), 'utf8'));
	if (baselineCensus.hubToken !== hubToken) {
		refuse(`the baseline counts hub token '${baselineCensus.hubToken}', this run '${hubToken}'`);
	}
	Object.keys(census.countByClass).forEach((className) => {
		const before = baselineCensus.countByClass[className] || { lineCount: 0, occurrenceCount: 0 };
		const after = census.countByClass[className];
		say(`  ${className.padEnd(17)} lines ${before.lineCount} -> ${after.lineCount}   occurrences ${before.occurrenceCount} -> ${after.occurrenceCount}`);
	});
	const beforeGated = baselineCensus.countByClass[GATED_CLASS_NAME];
	const afterGated = census.countByClass[GATED_CLASS_NAME];
	gatePassed = afterGated.lineCount <= beforeGated.lineCount && afterGated.occurrenceCount <= beforeGated.occurrenceCount;
	say(`${moduleName}: ${GATED_CLASS_NAME} count ${gatePassed ? 'did not rise: PASS' : 'ROSE: FAIL'} (baseline at ${baselineCensus.treeHead})`);
}
process.exit(gatePassed ? 0 : 1);
