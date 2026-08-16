#!/usr/bin/env node
'use strict';

// test-bgHook.js — BG-HOOK (SPEC-bridgeFramework-v1.md §13.2; §4.2, §4.3; BR-010, BR-016, BR-022): the hook set is
// held to BRIDGE_HOOK_CONTRACT at registration and the walk's yield to the assertion contract at run:
// walkSourceAssertions / subjectStableIdFor required, arity 2; an optional hook only when declared true; a
// declared-true hook that is missing refused; an unknown hook name refused; wrong arity refused; a walk assertion
// carrying objectStableId (or any framework-derived key) refused by name; a walk yielding two assertions with equal
// subject key and unequal identity refused (path-blind key, BR-136); subjectStableIdFor returning a stableId outside
// the declared subject nodes → sourceGap counted, no edge. Twins disable the specific check (productionMutation).
//
// Run: node lib/bridge-framework/test/test-bgHook.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-HOOK: the hook set and the walk's yield, refused by name

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { refusalCase, runConjunct, succeeded, frameworkMutationTwin, edgesOf, blockOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const GATE_ID = 'BG-HOOK';
const twinRegistry = makeTwinRegistry();
const CONTRACT_FILE = 'bridgePluginContract.js';
const FRAMEWORK_FILE = 'bridge-framework.js';
const GROUPING_FILE = 'subjectGrouping.js';
const PLUGIN_NAME = 'toyCrosswalkPlugin';
const PLUGIN_PATH = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyCrosswalkPlugin.js');

const overrideHooks = (scenario, mutateHooks) => {
	const loaded = require(PLUGIN_PATH);
	const bridgeHooks = { ...loaded.bridgeHooks };
	mutateHooks(bridgeHooks, loaded);
	scenario.pluginModuleOverrides[PLUGIN_NAME] = { bridgeHooks };
};
const overrideDeclarationAndHooks = (scenario, mutate) => {
	const loaded = require(PLUGIN_PATH);
	const bridgeDeclaration = scenarioLib.cloneJson(loaded.bridgeDeclaration);
	const bridgeHooks = { ...loaded.bridgeHooks };
	mutate(bridgeDeclaration, bridgeHooks);
	scenario.pluginModuleOverrides[PLUGIN_NAME] = { bridgeDeclaration, bridgeHooks };
};
// wrapWalk — the fixture walk with its yield post-processed (inputFault twins edit the assertions)
const wrapWalk = (scenario, mutateWalked) =>
	overrideHooks(scenario, (bridgeHooks, loaded) => {
		bridgeHooks.walkSourceAssertions = (hookArgs, callback) =>
			loaded.bridgeHooks.walkSourceAssertions(hookArgs, (walkError, walked) => {
				if (walkError) {
					callback(walkError);
					return;
				}
				callback('', mutateWalked(walked));
			});
	});

const conjunctList = [
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'walkSourceAssertions_required',
		title: 'a plugin without walkSourceAssertions is refused naming it',
		shape: (scenario) => overrideHooks(scenario, (bridgeHooks) => { delete bridgeHooks.walkSourceAssertions; }),
		regex: /missing required hook 'walkSourceAssertions'/,
		twinName: 'disableRequiredHookCheck', fileName: CONTRACT_FILE,
		find: "\t\t\tif (contractEntry.required) {\n\t\t\t\treturn refuse.byName({ moduleName, what: `bridgeHooks is missing required hook '${hookName}'`",
		replace: "\t\t\tif (contractEntry.required && false) {\n\t\t\t\treturn refuse.byName({ moduleName, what: `bridgeHooks is missing required hook '${hookName}'`",
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'subjectStableIdFor_required',
		title: 'a plugin without subjectStableIdFor is refused naming it',
		shape: (scenario) => overrideHooks(scenario, (bridgeHooks) => { delete bridgeHooks.subjectStableIdFor; }),
		regex: /missing required hook 'subjectStableIdFor'/,
		twinName: 'disableRequiredHookCheck', fileName: CONTRACT_FILE,
		find: "\t\t\tif (contractEntry.required) {\n\t\t\t\treturn refuse.byName({ moduleName, what: `bridgeHooks is missing required hook '${hookName}'`",
		replace: "\t\t\tif (contractEntry.required && false) {\n\t\t\t\treturn refuse.byName({ moduleName, what: `bridgeHooks is missing required hook '${hookName}'`",
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'arity',
		title: 'a hook of arity 1 (a positional signature) is refused naming the arity',
		shape: (scenario) => overrideHooks(scenario, (bridgeHooks) => { bridgeHooks.subjectStableIdFor = (hookArgs) => hookArgs; }),
		regex: /hook 'subjectStableIdFor' has arity 1; the contract declares 2/,
		twinName: 'disableArityCheck', fileName: CONTRACT_FILE,
		find: '\t\tif (hook.length !== contractEntry.arity) {', replace: '\t\tif (false && hook.length !== contractEntry.arity) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'unknownHook',
		title: "an unknown hook name ('judge') is refused — no resolve/classify/judge/freeze/write/export/run hook exists",
		shape: (scenario) => overrideHooks(scenario, (bridgeHooks) => { bridgeHooks.judge = (hookArgs, callback) => callback(''); }),
		regex: /bridgeHooks carries unknown hook 'judge'/,
		twinName: 'disableUnknownHookCheck', fileName: CONTRACT_FILE,
		find: '\tif (unknownHook !== undefined) {', replace: '\tif (false && unknownHook !== undefined) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'undeclaredOptionalHookPresent',
		title: 'an optional evidence hook present while declared false is refused (BR-016)',
		shape: (scenario) => overrideHooks(scenario, (bridgeHooks) => { bridgeHooks.nominateCandidates = (hookArgs, callback) => callback('', []); }),
		regex: /hook 'nominateCandidates' is present but evidenceHooksDeclared\.nominate is not true/,
		twinName: 'disableUndeclaredPresentCheck', fileName: CONTRACT_FILE,
		find: '\t\tif (!contractEntry.required && !declaredTrue) {', replace: '\t\tif (false && !contractEntry.required && !declaredTrue) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'declaredTrueHookMissing',
		title: 'an evidence hook declared true but absent is refused (BR-016)',
		shape: (scenario) => overrideDeclarationAndHooks(scenario, (declaration) => { declaration.evidenceHooksDeclared.walkEvidence = true; }),
		regex: /evidenceHooksDeclared\.walkEvidence is true but hook 'walkEvidence' is absent/,
		twinName: 'disableDeclaredMissingCheck', fileName: CONTRACT_FILE,
		find: '\t\t\tif (declaredTrue) {\n\t\t\t\treturn refuse.byName({ moduleName, what: `evidenceHooksDeclared.', replace: '\t\t\tif (declaredTrue && false) {\n\t\t\t\treturn refuse.byName({ moduleName, what: `evidenceHooksDeclared.',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'walkAssertionCarriesObjectStableId',
		title: 'a walk assertion carrying objectStableId is refused by name (a plugin never addresses a card, BR-022)',
		shape: (scenario) => wrapWalk(scenario, (walked) => ({ ...walked, assertionList: walked.assertionList.map((oneAssertion, oneIndex) => (oneIndex === 0 ? { ...oneAssertion, objectStableId: 'toyhub:card/P000001.C1' } : oneAssertion)) })),
		regex: /assertion 0 \(.*\) carries 'objectStableId'/,
		twinName: 'disableForbiddenKeyCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\t\t\tif (forbidden !== undefined) {', replace: '\t\t\t\t\t\t\tif (false && forbidden !== undefined) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'walkAssertionCarriesConfidence',
		title: 'a walk assertion carrying confidence is refused by name (BR-022)',
		shape: (scenario) => wrapWalk(scenario, (walked) => ({ ...walked, assertionList: walked.assertionList.map((oneAssertion, oneIndex) => (oneIndex === 2 ? { ...oneAssertion, confidence: 0.9 } : oneAssertion)) })),
		regex: /assertion 2 \(.*\) carries 'confidence'/,
		twinName: 'disableForbiddenKeyCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\t\t\tif (forbidden !== undefined) {', replace: '\t\t\t\t\t\t\tif (false && forbidden !== undefined) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'pathBlindSubjectKey',
		title: 'two assertions with EQUAL subject key and UNEQUAL identity values are refused (path-blind key, BR-136)',
		// the toy's subject key joins the three identity values with the unit separator; a walk that yields the same
		// key text under different identity objects (a value carrying the separator) is the path-blind fault
		shape: (scenario) => wrapWalk(scenario, (walked) => {
			const forged = walked.assertionList.map((oneAssertion) => oneAssertion);
			const first = forged[0];
			forged.push({ ...first, subjectIdentity: { ToyEntity: `${first.subjectIdentity.ToyEntity}${first.subjectIdentity.ToyPath}`, ToyPath: first.subjectIdentity.ToyElementName, ToyElementName: '' }, sourceLocator: { channelKey: 'crosswalk', rowNumber: 999 } });
			return { ...walked, assertionList: forged, channelReport: { ...walked.channelReport, crosswalk: { ...walked.channelReport.crosswalk, rowsRead: walked.channelReport.crosswalk.rowsRead + 1, assertionsYielded: walked.channelReport.crosswalk.assertionsYielded + 1 } } };
		}),
		regex: /lacks subject identity value 'ToyElementName'|shared by assertions with UNEQUAL identity values/,
		twinName: 'disablePathBlindCheck', fileName: GROUPING_FILE,
		find: '\t\t\tif (existing.identityText !== identityText) {', replace: '\t\t\tif (false && existing.identityText !== identityText) {',
	}),
];
// pathBlind: the shape above trips the "lacks identity value" guard first (ToyElementName '') — make the forged
// row carry a non-empty last value that still joins to the same key text
conjunctList[conjunctList.length - 1].evaluate = ((unused) => (scenario, callback) => {
	wrapWalk(scenario, (walked) => {
		const first = walked.assertionList[0];
		const forged = { ...first, subjectIdentity: { ToyEntity: `${first.subjectIdentity.ToyEntity}${first.subjectIdentity.ToyPath}${first.subjectIdentity.ToyElementName}`, ToyPath: 'x', ToyElementName: 'y' }, sourceLocator: { channelKey: 'crosswalk', rowNumber: 999 } };
		// key text: Entity␟Path␟Element␟x␟y ≠ first's key — so instead make the FIRST row's key equal the forged one:
		// simplest honest fault: two rows whose identity objects differ but whose JOINED text is identical
		const forgedEqualKey = { ...first, subjectIdentity: { ToyEntity: `${first.subjectIdentity.ToyEntity}${first.subjectIdentity.ToyPath}`, ToyPath: first.subjectIdentity.ToyElementName, ToyElementName: 'z' }, sourceLocator: { channelKey: 'crosswalk', rowNumber: 999 } };
		const firstEqualKey = { ...first, subjectIdentity: { ToyEntity: first.subjectIdentity.ToyEntity, ToyPath: first.subjectIdentity.ToyPath, ToyElementName: `${first.subjectIdentity.ToyElementName}z` } };
		void forged;
		const assertionList = [firstEqualKey].concat(walked.assertionList.slice(1)).concat([forgedEqualKey]);
		return { ...walked, assertionList, channelReport: { ...walked.channelReport, crosswalk: { ...walked.channelReport.crosswalk, rowsRead: walked.channelReport.crosswalk.rowsRead + 1, assertionsYielded: walked.channelReport.crosswalk.assertionsYielded + 1 } } };
	});
	scenarioLib.runScenario(scenario, (unusedError, outcome) => {
		const refusalText = outcome.constructionError || outcome.runError || outcome.thrownFromRun || '';
		callback('', refusalText ? (/shared by assertions with UNEQUAL identity values/.test(refusalText) ? { pass: true, detail: refusalText.slice(0, 200) } : { pass: false, detail: `wrong reason: ${refusalText.slice(0, 300)}` }) : { pass: false, detail: 'expected a refusal but the run SUCCEEDED' });
	});
})();

// subjectStableIdFor returning a stableId outside the declared subject nodes → sourceGap counted, no edge
conjunctList.push(
	runConjunct({
		conjunctId: 'foreignSubjectStableIdIsSourceGap',
		title: 'subjectStableIdFor returning a stableId outside the declared subject nodes → sourceGap counted, NO edge',
		twinNameList: ['disableSubjectNodeCheck'],
		shape: (scenario) => overrideHooks(scenario, (bridgeHooks, loaded) => {
			bridgeHooks.subjectStableIdFor = (hookArgs, callback) =>
				loaded.bridgeHooks.subjectStableIdFor(hookArgs, (resolveError, resolved) => {
					if (resolveError) {
						callback(resolveError);
						return;
					}
					// re-point FirstName's subject at a card (a stableId that is NOT a source subject node)
					const firstNameKey = Object.keys(resolved.resolutionBySubjectKey).find((oneKey) => resolved.resolutionBySubjectKey[oneKey].subjectStableId === 'toy:property/Student.FirstName');
					resolved.resolutionBySubjectKey[firstNameKey] = { subjectStableId: 'toyhub:card/P000001.C1' };
					callback('', resolved);
				});
		}),
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const gap = block.refusalList.find((oneRefusal) => oneRefusal.kind === 'sourceGap' && oneRefusal.reason === 'subjectStableIdNotADeclaredSubjectNode');
			const edgeFromCard = edgesOf(outcome).find((oneEdge) => oneEdge.fromStableId === 'toyhub:card/P000001.C1');
			return { pass: gap !== undefined && edgeFromCard === undefined && runReport.counts.cardinalityCensus.perSubject.sourceGapCount === 2, detail: `sourceGapCount ${runReport.counts.cardinalityCensus.perSubject.sourceGapCount}; card-as-subject edge ${edgeFromCard === undefined ? 'absent' : 'PRESENT'}` };
		}),
	}),
);
frameworkMutationTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'foreignSubjectStableIdIsSourceGap', twinName: 'disableSubjectNodeCheck', fileName: GROUPING_FILE,
	find: "\t\tif (typeof resolution.subjectStableId !== 'string' || !subjectNodeStableIdSet.has(resolution.subjectStableId)) {",
	replace: "\t\tif (typeof resolution.subjectStableId !== 'string') {",
});

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the hook set and the walk yield, refused by name', conjunctList }];

runGateFamily(
	{ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 10, expectedTwinCount: 10 },
	() => harness.report(),
);
