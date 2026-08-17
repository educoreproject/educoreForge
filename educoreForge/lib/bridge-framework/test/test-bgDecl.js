#!/usr/bin/env node
'use strict';

// test-bgDecl.js — BG-DECL (SPEC-bridgeFramework-v1.md §13.2; §4.1, §4.3; BR-004, BR-009..015): the plugin
// declaration is validated by a TABLE WALK at registration and every violation is refused BY NAME, before any
// forge is spent. One conjunct per required key (drop it → refused naming it) plus: unknown key; each closed value
// outside its list (matchBasis 'derived', producerKind 'inferred', predicateSource.kind 'judge' / 'none');
// producerKind/matchBasis disagreement; a table predicate outside SKOS / an OWL predicate; a value channel not
// refuseByNameAndCount; an unclassified header column / a classified column absent from the header / a duplicated
// header unresolved; a transform outside the registry; a non-empty compatibilityDeclarationList; a non-empty
// globalGuidanceList with the hook undeclared; a mappingProvider.url that is not a URL. Every conjunct's twin
// DISABLES the specific check in bridgePluginContract.js (productionMutation) so the faulted input passes and the
// gate goes red (three-state: before-passes, invert-and-watch-red, fix-to-green = the shipped code).
//
// Run: node lib/bridge-framework/test/test-bgDecl.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-DECL: every declaration violation refused by name at registration

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { refusalCase } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const { BRIDGE_DECLARATION_CONTRACT, SOURCE_ACQUISITION_REGISTRY } = require('../bridgePluginContract');

const GATE_ID = 'BG-DECL';
const twinRegistry = makeTwinRegistry();
const CONTRACT_FILE = 'bridgePluginContract.js';
const PLUGIN_NAME = 'toyCrosswalkPlugin';

// the check-disabling mutations (each find matches exactly once in bridgePluginContract.js)
const REQUIRED_CHECK_FIND = "\t\t} else if (value === undefined) {\n\t\t\treturn refuseWith(`bridgeDeclaration is missing required key '${propertyName}'`";
const REQUIRED_CHECK_REPLACE = "\t\t} else if (value === undefined) {\n\t\t\tcontinue;\n\t\t\treturn refuseWith(`bridgeDeclaration is missing required key '${propertyName}'`";
const KIND_CHECK_FIND = "\t\tif (reason !== '') {\n\t\t\treturn refuseWith(`bridgeDeclaration '${propertyName}' ${reason}`";
const KIND_CHECK_REPLACE = "\t\tif (reason !== '' && false) {\n\t\t\treturn refuseWith(`bridgeDeclaration '${propertyName}' ${reason}`";
const BASIS_REQUIRED_CHECK_FIND = '\t\t\tif (requiredByRow && value === undefined) {';
const BASIS_REQUIRED_CHECK_REPLACE = '\t\t\tif (false && requiredByRow && value === undefined) {';
const UNKNOWN_KEY_FIND = '\tif (unknownName !== undefined) {\n\t\treturn refuseWith(`bridgeDeclaration carries unknown key';
const UNKNOWN_KEY_REPLACE = '\tif (unknownName !== undefined && false) {\n\t\treturn refuseWith(`bridgeDeclaration carries unknown key';
const PRODUCER_MATCH_FIND = '\tif (PRODUCER_KIND_BY_MATCH_BASIS[bridgeDeclaration.matchBasis] !== bridgeDeclaration.producerKind) {';
const PRODUCER_MATCH_REPLACE = '\tif (false && PRODUCER_KIND_BY_MATCH_BASIS[bridgeDeclaration.matchBasis] !== bridgeDeclaration.producerKind) {';
const COVERAGE_FIND = "\tif (resolved.error) {\n\t\treturn refuseWith(resolved.error, 'declared-but-broken";
const COVERAGE_REPLACE = "\tif (resolved.error && false) {\n\t\treturn refuseWith(resolved.error, 'declared-but-broken";

const cloneJson = scenarioLib.cloneJson;
// shape a declaration override for the crosswalk plugin: mutate(declaration) → scenario.pluginModuleOverrides
const overrideDeclaration = (scenario, mutate) => {
	const loaded = require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyCrosswalkPlugin.js'));
	const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
	mutate(bridgeDeclaration);
	scenario.pluginModuleOverrides[PLUGIN_NAME] = { bridgeDeclaration };
};

// The fixture plugin is a CROSSWALK plugin, so "required" for it means BOTH:
//   (1) contract rows marked required: true          — refused by the unconditional branch
//   (2) rows marked basisConditional whose acquisition ROW requires them (RULING §11.9) — refused by the
//       basis-conditional branch, with a different message and therefore a different twin
// ⟪WHY THIS IS SPELLED OUT⟫ When tupleFieldColumnMap and mappingProvider became basisConditional, this
// generator — which filtered on `.required` alone — silently stopped emitting drop_tupleFieldColumnMap and
// drop_mappingProvider. The family still reported ALL GREEN on a smaller suite, which is precisely the
// failure RULING BR3-6 names: a gate that shrinks reads exactly like a gate that passes. The family's
// expectedConjunctCount at the foot of this file is now a LITERAL rather than a derivation, so the next
// person to move a key gets a RED instead of a quiet subtraction.
const FIXTURE_MATCH_BASIS = 'crosswalk';
const FIXTURE_ACQUISITION_ROW = SOURCE_ACQUISITION_REGISTRY[FIXTURE_MATCH_BASIS];
const unconditionalRequiredKeyList = Object.keys(BRIDGE_DECLARATION_CONTRACT).filter((oneName) => BRIDGE_DECLARATION_CONTRACT[oneName].required);
const rowRequiredKeyList = Object.keys(BRIDGE_DECLARATION_CONTRACT).filter((oneName) => BRIDGE_DECLARATION_CONTRACT[oneName].basisConditional === true && FIXTURE_ACQUISITION_ROW.requiredDeclarationKeyList.indexOf(oneName) !== -1);
const requiredKeyList = unconditionalRequiredKeyList.concat(rowRequiredKeyList);
const conjunctList = [];

// one conjunct PER required key: drop it → refused naming it
unconditionalRequiredKeyList.forEach((oneKeyName) => {
	conjunctList.push(
		refusalCase({
			registry: twinRegistry, gateId: GATE_ID, conjunctId: `drop_${oneKeyName}`,
			title: `dropping required '${oneKeyName}' is refused naming it at registration`,
			shape: (scenario) => overrideDeclaration(scenario, (declaration) => { delete declaration[oneKeyName]; }),
			regex: new RegExp(`missing required key '${oneKeyName}'`),
			twinName: 'disableRequiredKeyCheck', fileName: CONTRACT_FILE, find: REQUIRED_CHECK_FIND, replace: REQUIRED_CHECK_REPLACE,
		}),
	);
});
// one conjunct PER key the fixture's acquisition ROW requires: drop it → refused naming it AND naming the basis
rowRequiredKeyList.forEach((oneKeyName) => {
	conjunctList.push(
		refusalCase({
			registry: twinRegistry, gateId: GATE_ID, conjunctId: `drop_${oneKeyName}`,
			title: `dropping '${oneKeyName}', which matchBasis '${FIXTURE_MATCH_BASIS}' requires, is refused naming both`,
			shape: (scenario) => overrideDeclaration(scenario, (declaration) => { delete declaration[oneKeyName]; }),
			regex: new RegExp(`missing key '${oneKeyName}', which matchBasis '${FIXTURE_MATCH_BASIS}' REQUIRES`),
			twinName: 'disableBasisRequiredKeyCheck', fileName: CONTRACT_FILE, find: BASIS_REQUIRED_CHECK_FIND, replace: BASIS_REQUIRED_CHECK_REPLACE,
		}),
	);
});

conjunctList.push(
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'unknownKey',
		title: 'an UNKNOWN declaration key (a typo) is refused naming it',
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.subjectCuriePrefx = 'toy'; }),
		regex: /unknown key 'subjectCuriePrefx'/,
		twinName: 'disableUnknownKeyCheck', fileName: CONTRACT_FILE, find: UNKNOWN_KEY_FIND, replace: UNKNOWN_KEY_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'globalGuidanceList_missingWhenHookTrue',
		title: "globalGuidanceList ABSENT while evidenceHooksDeclared.globalGuidance is true is refused naming it (REQUIRED iff the hook is declared — RULING BR4)",
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.evidenceHooksDeclared = { ...declaration.evidenceHooksDeclared, globalGuidance: true }; delete declaration.globalGuidanceList; }),
		regex: /missing key 'globalGuidanceList' \(REQUIRED because evidenceHooksDeclared\.globalGuidance is true\)/,
		twinName: 'disableConditionalRequiredCheck', fileName: CONTRACT_FILE, find: '\t\t\tif (expectedPresent && value === undefined) {', replace: '\t\t\tif (false && expectedPresent && value === undefined) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'globalGuidanceList_presentWhenHookFalse',
		title: "globalGuidanceList PRESENT (even []) while evidenceHooksDeclared.globalGuidance is false is refused naming it (FORBIDDEN — an empty list is not absence — RULING BR4)",
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.globalGuidanceList = []; }),
		regex: /carries key 'globalGuidanceList' which is FORBIDDEN while evidenceHooksDeclared\.globalGuidance is not true/,
		twinName: 'disableConditionalForbiddenCheck', fileName: CONTRACT_FILE, find: '\t\t\tif (!expectedPresent && value !== undefined) {', replace: '\t\t\tif (false && !expectedPresent && value !== undefined) {',
	}),
	// ⟪RETIRED BY NAME — RULING §11.6 (the R6 reversal, owned), SABLE_RIVER 2026-08-17⟫ Three conjuncts here
	// asserted that `derived`, `inferred` and predicateSource kind `judge` are REFUSED. TQ's correction of
	// 2026-08-17 ("derived mappings are going to be the vast majority") reverses R6, so all three are now
	// ADMITTED and those conjuncts would assert the opposite of the ruling. They are retired, NOT deleted
	// quietly: the three replacements below keep the family's conjunct count and keep proving what the closed
	// lists are FOR — that an UNREGISTERED value still refuses by name, and that admitting `judge` admitted a
	// closed SHAPE rather than an open door.
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'closedValue_matchBasisUnregistered',
		title: "an UNREGISTERED matchBasis is refused by name, and the refusal names every registered basis (replaces the retired closedValue_matchBasisDerived, RULING §11.6)",
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.matchBasis = 'inventedBasis'; }),
		regex: /'matchBasis' matchBasis 'inventedBasis' is not one of: standard, crosswalk, derived/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'closedValue_producerKindUnregistered',
		title: "an UNREGISTERED producerKind is refused by name (replaces the retired closedValue_producerKindInferred, RULING §11.6)",
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.producerKind = 'guessed'; }),
		regex: /'producerKind' producerKind 'guessed' is not one of: authored, inferred/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'predicateSourceKindJudgeShapeIsClosed',
		title: "predicateSource.kind 'judge' is ADMITTED but its shape is CLOSED — a judge kind carrying a column/table is refused by name (replaces the retired closedValue_predicateSourceKindJudge, RULING §11.6/§11.7)",
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.predicateSource = { kind: 'judge', column: 'MappingConfidence', table: {} }; }),
		regex: /kind 'judge' carries no column, no table and no predicate/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'closedValue_predicateSourceKindNone',
		title: "predicateSource.kind 'none' is refused — declare what the source asserts or do not register the channel",
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.predicateSource = { kind: 'none' }; }),
		regex: /predicateSource\.kind 'none' is not one of/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'producerKindDisagreesWithMatchBasis',
		title: 'producerKind disagreeing with matchBasis is refused (declared AND checked, RULING A1)',
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.matchBasis = 'standard'; declaration.sourceChannelList = [scenarioLib.cloneJson(require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyStandardPlugin.js')).bridgeDeclaration.sourceChannelList[0])]; declaration.subjectIdentity = { kind: 'forgedNode', property: 'stableId' }; declaration.tupleFieldColumnMap = { canonicalKey: { column: 'hubAnchorId', transform: 'identity' } }; declaration.predicateSource = { kind: 'channelAssertion', predicate: 'exactMatch', assertedBy: { documentName: 'x', citation: 'y' } }; declaration.evidenceColumnMap = { subject: [], assertion: [] }; declaration.consistencyCheckColumnList = []; }),
		// the shape above is a valid STANDARD declaration except producerKind — the fixture has only 'authored'
		// for both bases, so the twin flips the registry row and the disagreement check must catch it
		regex: /producerKind 'structural' disagrees with matchBasis 'standard'/,
		twinName: 'disableProducerMatchBasisCheck', fileName: CONTRACT_FILE, find: PRODUCER_MATCH_FIND, replace: PRODUCER_MATCH_REPLACE,
	}),
);
// the disagreement conjunct needs producerKind outside the closed list to be a DIFFERENT value than authored — the
// closed-value check would refuse 'structural' first; so this conjunct's shape mutates the closed list too (a
// registry double: PRODUCER_KIND_LIST gains 'structural' for the run) — a scenario mutation on the framework
conjunctList[conjunctList.length - 1].evaluate = ((innerEvaluate) => (scenario, callback) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE), find: "const PRODUCER_KIND_LIST = Object.freeze(['authored', 'inferred']);", replace: "const PRODUCER_KIND_LIST = Object.freeze(['authored', 'inferred', 'structural']);" });
	scenario.pluginModuleOverrides = scenario.pluginModuleOverrides || {};
	const loaded = require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyStandardPlugin.js'));
	const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
	bridgeDeclaration.producerKind = 'structural';
	scenario.pluginModuleOverrides.toyStandardPlugin = { bridgeDeclaration };
	scenario.spec.bridge = 'toyStandardPlugin';
	scenarioLib.runScenario(scenario, (unusedError, outcome) => {
		const refusalText = outcome.constructionError || outcome.runError || outcome.thrownFromRun || '';
		callback('', refusalText ? (/producerKind 'structural' disagrees with matchBasis 'standard'/.test(refusalText) ? { pass: true, detail: refusalText.slice(0, 200) } : { pass: false, detail: `wrong reason: ${refusalText.slice(0, 300)}` }) : { pass: false, detail: 'expected a refusal but the run SUCCEEDED' });
	});
})(conjunctList[conjunctList.length - 1].evaluate);

conjunctList.push(
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'tablePredicateNotSkos',
		title: 'a table predicate outside SKOS_PREDICATES is refused',
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.predicateSource.table.Yes = { disposition: 'predicate', predicate: 'sameAs' }; }),
		regex: /table\['Yes'\]\.predicate 'sameAs' is not a SKOS_PREDICATES member/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'owlPredicateAnywhere',
		title: 'an OWL predicate (owl:equivalentProperty) anywhere in the table is refused',
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.predicateSource.table.Maybe = { disposition: 'tentative', predicateIfPicked: 'owl:equivalentProperty' }; }),
		regex: /predicateIfPicked 'owl:equivalentProperty' is not a SKOS_PREDICATES member/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'valueChannelNotRefuseByNameAndCount',
		title: "a value-tier channel not 'refuseByNameAndCount' is refused (BR-080, BR-134)",
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.sourceChannelList[1].disposition = 'walk'; declaration.sourceChannelList[1].columnClassification = { subjectIdentityColumnList: [], tupleFieldColumnList: [], sourceLabelColumnList: [], carriedRecordColumnList: [], evidenceOnlyColumnList: [], consistencyCheckColumnList: [], ignoredColumnList: ['ToyEntity', 'ToyDescriptor', 'HubOptionId', 'Confidence'] }; delete declaration.sourceChannelList[1].headerColumnList; }),
		regex: /channel 'descriptors' is tier 'value' and MUST carry disposition 'refuseByNameAndCount'/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'headerColumnUnclassified',
		title: 'a header column classified in NO list is refused naming it (coverage, RULING BF6)',
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.sourceChannelList[0].columnClassification.ignoredColumnList = []; }),
		regex: /header column 'LegacyColumn' is UNCLASSIFIED/,
		twinName: 'disableCoverageCheck', fileName: CONTRACT_FILE, find: COVERAGE_FIND, replace: COVERAGE_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'classifiedColumnAbsentFromHeader',
		title: 'a classified column ABSENT from the header is refused naming it',
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.sourceChannelList[0].columnClassification.ignoredColumnList.push('PhantomColumn'); }),
		regex: /classifies column 'PhantomColumn', which is ABSENT from the header/,
		twinName: 'disableCoverageCheck', fileName: CONTRACT_FILE, find: COVERAGE_FIND, replace: COVERAGE_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'transformOutsideRegistry',
		title: 'a tuple-field transform outside TRANSFORM_REGISTRY is refused',
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.tupleFieldColumnMap.canonicalKey.transform = 'cedsPropertyKeyFromGlobalId'; }),
		regex: /canonicalKey\.transform 'cedsPropertyKeyFromGlobalId' is not in TRANSFORM_REGISTRY/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'nonEmptyCompatibilityDeclarationList',
		title: 'a non-empty compatibilityDeclarationList is refused (BRIDGE_ALLOWANCE_REGISTRY is EMPTY in v1)',
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.compatibilityDeclarationList = [{ allowanceId: 'X1' }]; }),
		regex: /compatibilityDeclarationList is non-empty \(1\) but BRIDGE_ALLOWANCE_REGISTRY has NO rows/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'mappingProviderUrlNotUrl',
		title: 'a mappingProvider.url that is not a URL is refused',
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.mappingProvider.url = 'the crosswalk'; }),
		regex: /'mappingProvider' url "the crosswalk" is not a URL/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'forgedGraphChannelWithoutPropertyList',
		title: 'a forgedGraph channel without channelPropertyList is refused (RULING BF7)',
		shape: (scenario) => {
			const loaded = require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyStandardPlugin.js'));
			const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
			delete bridgeDeclaration.sourceChannelList[0].channelPropertyList;
			scenario.pluginModuleOverrides.toyStandardPlugin = { bridgeDeclaration };
		},
		regex: /forgedGraph channel 'anchorColumn' MUST declare a non-empty channelPropertyList/,
		twinName: 'disableKindCheck', fileName: CONTRACT_FILE, find: KIND_CHECK_FIND, replace: KIND_CHECK_REPLACE,
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'documentChannelFileAbsent',
		title: 'a document channel whose file is absent on disk is refused at registration (declared-but-broken refuses every build)',
		shape: (scenario) => overrideDeclaration(scenario, (declaration) => { declaration.sourceChannelList[0].relativePathFromBundleRoot = 'assets/standardSourceData/01/missing.csv'; }),
		regex: /document channel 'crosswalk' file is absent on disk/,
		twinName: 'disableCoverageCheck', fileName: CONTRACT_FILE, find: COVERAGE_FIND, replace: COVERAGE_REPLACE,
	}),
);

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the plugin declaration object, validated by name at registration', conjunctList }];

runGateFamily(
	{
		harness,
		familyName: GATE_ID,
		gateDeclarationList,
		twinRegistry,
		makeSubject: scenarioLib.makeScenario,
		cloneSubject: scenarioLib.cloneScenario,
		// ⟪LITERAL, NOT DERIVED — RULING BR3-6 applied properly, GRANITE_VALLEY 2026-08-17⟫ These were
		// `requiredKeyList.length + 18`, which is a count DERIVED FROM THE SAME QUANTITY THE GENERATOR USES.
		// When two keys stopped being `required: true`, requiredKeyList shrank, the EXPECTATION shrank with it,
		// and a family that had quietly lost two conjuncts still reported 36/36 ALL GREEN. A guard that moves
		// with the thing it guards is not a guard. The number is now a LITERAL: any change to the contract's
		// key set must come here and be justified, which is the whole point of declaring a count.
		expectedConjunctCount: 38,
		expectedTwinCount: 38,
	},
	() => harness.report(),
);
