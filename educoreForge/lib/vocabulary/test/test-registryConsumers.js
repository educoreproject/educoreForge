#!/usr/bin/env node
'use strict';

// test-registryConsumers.js — gate for W-A-12 (V1-C31, V1-S31; campaign P2): every export of the vocabulary has a consumer.
// 24 exports (owner/role tokens, the retired pair/version-key vocabulary, three validators, a sequence constant) and three
// more found by this census (RELATIONSHIP_PRODUCER_SUFFIXES, MAPPING_SOURCE_FAMILY_LIST, MAPPING_SOURCE_NAME_PATTERN: used
// inside vocabulary.js, exported to no one) were deleted; a dead export is a promise nothing keeps.
//
// PROVES:
//   (a) every exported name occurs as a whole word in at least one .js file outside lib/vocabulary's three declaration files,
//       node_modules and the attic (a suite reading a declaration counts: the gate is its consumer); names graph-contract
//       declares are exempt — their consumer is the DME, through graphContract.json
//   (b) the HubReference comment no longer claims cards carry no embedding; HUB_REFERENCE_PROPERTIES has no LABEL
// RED TWIN: the export object with UNUSED_PROBE added (a vocabulary.js double) -> (a) names it.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: every vocabulary export has a consumer
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const path = require('path');
const vocabulary = require('../vocabulary');
const graphContract = require('../graph-contract');
const { loadBuildJsDouble } = require('../../bridge-framework/test/testSupport/bridgeTwinFactories');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const DECLARATION_FILE_LIST = ['vocabulary.js', 'vocabulary-definitions.js', 'graph-contract.js'].map((oneName) => path.join(__dirname, '..', oneName));
const SKIPPED_DIRECTORY_NAME_LIST = ['node_modules', 'codeAttic'];
const jsFileListUnder = (dirPath) =>
	fs.readdirSync(dirPath, { withFileTypes: true }).reduce((soFar, oneEntry) => {
		const entryPath = path.join(dirPath, oneEntry.name);
		if (oneEntry.isDirectory()) return SKIPPED_DIRECTORY_NAME_LIST.indexOf(oneEntry.name) === -1 && !oneEntry.name.startsWith('.') ? soFar.concat(jsFileListUnder(entryPath)) : soFar;
		return /\.(js|mjs|cjs)$/.test(oneEntry.name) && DECLARATION_FILE_LIST.indexOf(entryPath) === -1 ? soFar.concat([entryPath]) : soFar;
	}, []);
const consumerText = jsFileListUnder(TREE_ROOT).filter((oneFilePath) => oneFilePath !== __filename).map((oneFilePath) => fs.readFileSync(oneFilePath, 'utf8')).join('\n');
const contractNameSet = new Set(Object.keys(graphContract));
const unconsumedListOf = (exportedNameList) => exportedNameList.filter((oneName) => !contractNameSet.has(oneName) && !new RegExp(`\\b${oneName}\\b`).test(consumerText));

harness.section('(a) every export has a consumer');
const unconsumedList = unconsumedListOf(Object.keys(vocabulary));
harness.ok(`every one of ${Object.keys(vocabulary).length} exports is consumed outside the declaration files`, unconsumedList.length === 0, unconsumedList.join(', '));
const vocabularyDouble = loadBuildJsDouble({ buildJsPath: path.join(__dirname, '..', 'vocabulary.js'), mutationList: [{ find: '	EDGE_ENDPOINT_KIND_PAIR_LIST_BY_TYPE,\n', replace: '	EDGE_ENDPOINT_KIND_PAIR_LIST_BY_TYPE,\n	UNUSED_PROBE: \'x\',\n' }] });
const twinUnconsumedList = unconsumedListOf(Object.keys(vocabularyDouble));
harness.ok("(a) observed RED with UNUSED_PROBE added to the export object", twinUnconsumedList.indexOf('UNUSED_PROBE') !== -1, twinUnconsumedList.join(', '));
harness.note(`RED-OBSERVED a twin='unusedProbeExported' → unconsumed [${twinUnconsumedList.join(', ')}]`);

harness.section('(b) the stale claims are gone');
const vocabularyText = fs.readFileSync(DECLARATION_FILE_LIST[0], 'utf8');
harness.ok('the DmeEditHistoryEntry comment no longer says HubReference gets no embedding', vocabularyText.indexOf('the same\n\t// treatment HubReference already gets') === -1 && vocabularyText.indexOf('treatment HubReference already gets') === -1);
harness.ok('HUB_REFERENCE_PROPERTIES carries no LABEL (absent on every live card)', vocabulary.HUB_REFERENCE_PROPERTIES.LABEL === undefined);

harness.report();
