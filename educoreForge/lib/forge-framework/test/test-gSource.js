#!/usr/bin/env node
'use strict';

// test-gSource.js — G-SOURCE and G-UNIQUE (SPEC-forgeFramework-v1.md §10.1; §4.1; RULING 00:15 gate 9):
// declaration.standardSource EQUALS the descriptor's standardName; every node's _source and every edge's
// ref.source EQUAL it; standardName is UNIQUE among enabled bundles (roster.assertUniqueStandardNames
// over the real forges/ dir and over a scratch dir with two bundles sharing one name).
//
// Run: node lib/forge-framework/test/test-gSource.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-SOURCE + G-UNIQUE: _source equals the descriptor's standardName; standardName unique among bundles

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
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, scenarioTwin, forgeConjunct, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const rosterLib = require('../roster');

const SOURCE_GATE_ID = 'G-SOURCE';
const UNIQUE_GATE_ID = 'G-UNIQUE';
const twinRegistry = makeTwinRegistry();
const REAL_FORGES_DIR = path.resolve(toyScenario.FRAMEWORK_DIR, '..', '..', 'forges');
const TOY_DESCRIPTOR_PATH = path.join(toyScenario.TOY_DIR, 'parserDescriptor.ini');

// a scratch forges dir holding ONLY descriptor files (the roster reads nothing else)
const makeScratchForgesDir = ({ duplicate }) => {
	const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forgesRoster-'));
	fs.readdirSync(REAL_FORGES_DIR, { withFileTypes: true })
		.filter((oneEntry) => oneEntry.isDirectory() && fs.existsSync(path.join(REAL_FORGES_DIR, oneEntry.name, 'parserDescriptor.ini')))
		.forEach((oneEntry) => {
			fs.mkdirSync(path.join(scratchRoot, oneEntry.name));
			fs.copyFileSync(path.join(REAL_FORGES_DIR, oneEntry.name, 'parserDescriptor.ini'), path.join(scratchRoot, oneEntry.name, 'parserDescriptor.ini'));
		});
	if (duplicate) {
		fs.mkdirSync(path.join(scratchRoot, 'edfiAgain'));
		fs.writeFileSync(path.join(scratchRoot, 'edfiAgain', 'parserDescriptor.ini'), '[parserDescriptor]\nstandardName=EdFi\ndisplayName=Ed-Fi again\nentryModule=forgeEdfi.js\nroundTripValidator=roundTripValidator.js\ndefaultSnapshot=04\n');
	}
	return scratchRoot;
};

const sourceConjunctList = [
	{
		conjunctId: 'declarationEqualsDescriptor',
		title: "declaration.standardSource EQUALS the toy parserDescriptor.ini standardName ('Toy')",
		twinNameList: ['descriptorSaysTOY'],
		evaluate: (scenario, callback) => {
			const descriptorText = scenario.descriptorTextOverride !== undefined ? scenario.descriptorTextOverride : fs.readFileSync(TOY_DESCRIPTOR_PATH, 'utf8');
			const scratchPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'toyDescriptor-')), 'parserDescriptor.ini');
			fs.writeFileSync(scratchPath, descriptorText);
			const { sectionPresent, valueByName } = rosterLib.readDescriptorSection(scratchPath);
			const pass = sectionPresent && valueByName.standardName === scenario.forgeDeclaration.standardSource;
			callback('', { pass, detail: `descriptor standardName ${JSON.stringify(valueByName.standardName)} vs declaration standardSource ${JSON.stringify(scenario.forgeDeclaration.standardSource)}` });
		},
	},
	forgeConjunct({
		conjunctId: 'everyNodeSource',
		title: "every emitted node's _source EQUALS standardSource",
		twinNameList: ['stampUppercaseSource'],
		judge: succeeded((result, outcome) => { const offender = result.nodes.find((oneNode) => oneNode.properties._source !== outcome.bundle.STANDARD_SOURCE); return { pass: offender === undefined, detail: offender ? `'${offender.stableId}' _source ${offender.properties._source}` : `all ${result.nodes.length} nodes _source '${outcome.bundle.STANDARD_SOURCE}'` }; }),
	}),
	forgeConjunct({
		conjunctId: 'everyEdgeRefSource',
		title: "every edge's fromRef.source and toRef.source EQUAL standardSource",
		twinNameList: ['stampForeignFromRefSource'],
		judge: succeeded((result, outcome) => { const offender = result.edges.find((oneEdge) => oneEdge.fromRef.source !== outcome.bundle.STANDARD_SOURCE || oneEdge.toRef.source !== outcome.bundle.STANDARD_SOURCE); return { pass: offender === undefined, detail: offender ? `edge ${offender.type} carries ${offender.fromRef.source}/${offender.toRef.source}` : `all ${result.edges.length} edges scoped to '${outcome.bundle.STANDARD_SOURCE}'` }; }),
	}),
];
scenarioTwin({ registry: twinRegistry, gateId: SOURCE_GATE_ID, conjunctId: 'declarationEqualsDescriptor', twinName: 'descriptorSaysTOY', leverKind: 'inputFault', mutate: (scenario) => { scenario.descriptorTextOverride = fs.readFileSync(TOY_DESCRIPTOR_PATH, 'utf8').replace('standardName=Toy', 'standardName=TOY'); } });
frameworkMutationTwin({ registry: twinRegistry, gateId: SOURCE_GATE_ID, conjunctId: 'everyNodeSource', twinName: 'stampUppercaseSource', fileName: 'contractGraphKit.js', find: '\t\t\t\t_id: stableId,\n\t\t\t\t_source: standardSource,', replace: '\t\t\t\t_id: stableId,\n\t\t\t\t_source: standardSource.toUpperCase(),' });
frameworkMutationTwin({ registry: twinRegistry, gateId: SOURCE_GATE_ID, conjunctId: 'everyEdgeRefSource', twinName: 'stampForeignFromRefSource', fileName: 'contractGraphKit.js', find: '\t\t\tfromRef: { source: standardSource, id: fromStableId },', replace: "\t\t\tfromRef: { source: 'CEDS', id: fromStableId }," });

const uniqueConjunctList = [
	{
		conjunctId: 'realForgesUnique',
		title: 'roster.assertUniqueStandardNames over the REAL forges/ dir returns null (CEDS/EdFi/SIF/PESC260805 unique today)',
		twinNameList: ['duplicateBundleAdded'],
		evaluate: (scenario, callback) => {
			const verdict = rosterLib.assertUniqueStandardNames({ forgesDirPath: scenario.forgesDirPath || REAL_FORGES_DIR });
			callback('', { pass: verdict === null, detail: verdict === null ? 'no duplicate standardName' : verdict.message });
		},
	},
	{
		conjunctId: 'duplicateRefusedNamingBoth',
		title: 'two bundle directories sharing one standardName are refused NAMING BOTH directories',
		twinNameList: ['disableDuplicateRefusal'],
		evaluate: (scenario, callback) => {
			const rosterModule = scenario.frameworkMutationList.length ? require('./testSupport/moduleDouble').loadWithMutations({ modulePath: path.join(toyScenario.FRAMEWORK_DIR, 'roster.js'), mutationList: scenario.frameworkMutationList }) : rosterLib;
			const verdict = rosterModule.assertUniqueStandardNames({ forgesDirPath: makeScratchForgesDir({ duplicate: true }) });
			const pass = verdict !== null && /standardName 'EdFi' is declared by TWO bundle directories: 'edfi' and 'edfiAgain'/.test(verdict.message);
			callback('', { pass, detail: verdict === null ? 'NOT refused' : verdict.message.slice(0, 200) });
		},
	},
];
scenarioTwin({ registry: twinRegistry, gateId: UNIQUE_GATE_ID, conjunctId: 'realForgesUnique', twinName: 'duplicateBundleAdded', leverKind: 'inputFault', mutate: (scenario) => { scenario.forgesDirPath = makeScratchForgesDir({ duplicate: true }); } });
frameworkMutationTwin({ registry: twinRegistry, gateId: UNIQUE_GATE_ID, conjunctId: 'duplicateRefusedNamingBoth', twinName: 'disableDuplicateRefusal', fileName: 'roster.js', find: '\t\tif (bundleDirNameByStandardName[standardName] !== undefined) {', replace: '\t\tif (bundleDirNameByStandardName[standardName] !== undefined && false) {' });

const gateDeclarationList = [
	{ gateId: SOURCE_GATE_ID, title: '_source equals the descriptor standardName', conjunctList: sourceConjunctList },
	{ gateId: UNIQUE_GATE_ID, title: 'standardName unique among bundles', conjunctList: uniqueConjunctList },
];
runGateFamily({ harness, familyName: 'G-SOURCE + G-UNIQUE', gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: (scenario) => ({ ...toyScenario.cloneScenario(scenario), descriptorTextOverride: scenario.descriptorTextOverride, forgesDirPath: scenario.forgesDirPath }), expectedConjunctCount: 5, expectedTwinCount: 5 }, () => harness.report());
