#!/usr/bin/env node
'use strict';

// test-bgScopeCensus.js — BG-SCOPECENSUS (W-B-9, V1-C12 / V1-S94; campaign P3 2026-10-06): the frozen census counts the
// subjects a declared scope left out. Before this the only trace was one status line in the build log ("in scope (of N
// labelled)"); the block — the artifact a reader actually holds — said nothing.
//
//   BG-SCOPECENSUS  (a) a toy derived run whose scope file omits ONE labelled subject freezes perSubject
//                   labelledSubjectCount = in-scope + 1 and outOfScopeSubjectCount = 1; (b) with no scope file both say
//                   so (labelled = in scope, nothing out of scope); (c) cardinalityCensus called WITHOUT
//                   inScopeSubjectCount is refused by name — the count is required, never defaulted.
//
// Run: node lib/bridge-framework/test/test-bgScopeCensus.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-SCOPECENSUS: the frozen census counts the subjects the scope left out

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
const scenarioLib = require('./testSupport/toyBridgeScenario');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runConjunct, pureConjunct, succeeded, frameworkMutationTwin, blockOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const SUBJECT_LABEL = 'ToyProperty';
const FRAMEWORK_FILE = 'bridge-framework.js';
const CENSUS_FILE = 'census.js';
const TOY_EMBED_MODEL = 'toy-embed-v1';

const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
// a scope file (absolute path; honoured by the framework) naming every labelled subject but the first
const scopedShape = (scenario) => {
	derivedShape(scenario);
	const labelledStableIdList = scenario.graph.nodeList.filter((oneNode) => oneNode.labels.indexOf(SUBJECT_LABEL) !== -1).map((oneNode) => oneNode.stableId).sort();
	const scopeFilePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bgScopeCensus-')), 'scope.json');
	fs.writeFileSync(scopeFilePath, JSON.stringify(labelledStableIdList.slice(1)));
	const bridgeDeclaration = scenarioLib.cloneJson(require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`)).bridgeDeclaration);
	bridgeDeclaration.subjectSource = { ...bridgeDeclaration.subjectSource, scopeStableIdListPath: scopeFilePath };
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = { ...(scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] || {}), bridgeDeclaration };
	scenario.expectedLabelledCount = labelledStableIdList.length;
};
const censusLibFor = (scenario) => (scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CENSUS_FILE), mutationList: scenario.frameworkMutationList }) : require('../census'));

const conjunctList = [
	runConjunct({
		conjunctId: 'a_scopeOmittingOneIsCountedOutOfScope',
		title: 'a scope file omitting ONE labelled subject freezes labelledSubjectCount = in scope + 1 and outOfScopeSubjectCount = 1',
		twinNameList: ['labelledCountTakenFromScope'],
		shape: scopedShape,
		judge: succeeded((runReport, outcome, scenario) => {
			const perSubject = blockOf(outcome).header.cardinalityCensus.perSubject;
			const pass = perSubject.outOfScopeSubjectCount === 1 && perSubject.labelledSubjectCount === scenario.expectedLabelledCount && perSubject.subjectCount === scenario.expectedLabelledCount - 1;
			return { pass, detail: `labelled ${perSubject.labelledSubjectCount} (expected ${scenario.expectedLabelledCount}); outOfScope ${perSubject.outOfScopeSubjectCount}; subjectCount ${perSubject.subjectCount}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_noScopeFileNothingOutOfScope',
		title: 'with no scope file, labelled = the subject count and nothing is out of scope',
		twinNameList: ['outOfScopeOffByOne'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const perSubject = blockOf(outcome).header.cardinalityCensus.perSubject;
			return { pass: perSubject.outOfScopeSubjectCount === 0 && perSubject.labelledSubjectCount === perSubject.subjectCount && perSubject.subjectCount > 0, detail: `labelled ${perSubject.labelledSubjectCount}; outOfScope ${perSubject.outOfScopeSubjectCount}; subjectCount ${perSubject.subjectCount}` };
		}),
	}),
	pureConjunct({
		conjunctId: 'c_censusWithoutInScopeCountRefused',
		title: 'cardinalityCensus without inScopeSubjectCount is refused by name (required, never defaulted)',
		twinNameList: ['inScopeCountDefaulted'],
		judge: (scenario) => {
			const censusLib = censusLibFor(scenario);
			let refusalText = '';
			try {
				censusLib.cardinalityCensus({ decisionRecordList: [], subjectCollisionList: [], sourceGapList: [], labelledSubjectCount: 3 });
			} catch (censusError) {
				refusalText = censusError.message;
			}
			return { pass: /needs labelledSubjectCount and inScopeSubjectCount as non-negative integers/.test(refusalText), detail: refusalText ? refusalText.slice(0, 200) : 'NOT refused' };
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-SCOPECENSUS', conjunctId: 'a_scopeOmittingOneIsCountedOutOfScope', twinName: 'labelledCountTakenFromScope', fileName: FRAMEWORK_FILE, find: 'labelledSubjectCount: labelledNodeList.length, inScopeSubjectCount: inScopeNodeList.length });', replace: 'labelledSubjectCount: inScopeNodeList.length, inScopeSubjectCount: inScopeNodeList.length });' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-SCOPECENSUS', conjunctId: 'b_noScopeFileNothingOutOfScope', twinName: 'outOfScopeOffByOne', fileName: CENSUS_FILE, find: '		outOfScopeSubjectCount: labelledSubjectCount - inScopeSubjectCount,', replace: '		outOfScopeSubjectCount: labelledSubjectCount - inScopeSubjectCount + 1,' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-SCOPECENSUS', conjunctId: 'c_censusWithoutInScopeCountRefused', twinName: 'inScopeCountDefaulted', fileName: CENSUS_FILE, find: '	if (!Number.isInteger(labelledSubjectCount) || labelledSubjectCount < 0 || !Number.isInteger(inScopeSubjectCount) || inScopeSubjectCount < 0) {', replace: '	if (inScopeSubjectCount === undefined) { inScopeSubjectCount = labelledSubjectCount; }\n	if (!Number.isInteger(labelledSubjectCount) || labelledSubjectCount < 0 || !Number.isInteger(inScopeSubjectCount) || inScopeSubjectCount < 0) {' });

const gateDeclarationList = [{ gateId: 'BG-SCOPECENSUS', title: 'the frozen census counts the subjects the scope left out', conjunctList }];

runGateFamily(
	{ harness, familyName: 'BG-SCOPECENSUS', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 3 },
	() => harness.report(),
);
