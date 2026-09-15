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
// BG-NV conjunct l (SPEC-bridgeRevision-091426.md §9 l, B3a) rides in the same family: every candidateRetrieval
// method-registry and neighbourVote declaration refusal, each with its own twin, plus two must-register
// conjuncts. Those are pure validations; the section header above them says why.
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

const fs = require('fs');
const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { refusalCase, pureConjunct, frameworkMutationTwin } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const contractLib = require('../bridgePluginContract');
const { BRIDGE_DECLARATION_CONTRACT, SOURCE_ACQUISITION_REGISTRY } = contractLib;

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

// =====================================================================
// BG-NV conjunct l (SPEC-bridgeRevision-091426.md §5, §9 l; B3a): every candidateRetrieval declaration
// refusal fires by name, one conjunct per refusal, each with its OWN twin; plus the two things that must still
// REGISTER: a complete embedTextVote-v1 declaration, and every shipped plugin that declares candidateRetrieval.
//
// THESE CONJUNCTS ARE PURE. Each hands a declaration to validateBridgeDeclaration, the function registration
// calls (the 38 conjuncts above already prove registration reaches it), instead of running a build. An
// embedTextVote-v1 plugin cannot complete a run before B4 wires the orchestrator, so a run-based twin that
// admitted one would go red on an orchestrator refusal rather than on the check it removed: a gate proven by
// accident. A pure validation isolates exactly the removed check.
//
// Every twin is a productionMutation compiled in memory (moduleDouble), of bridgePluginContract.js or of
// neighbourVote.js, which owns neighbourVote-v1's closed lists. Where deleting a check would leave the
// validator reading an undefined registry row (a crash, which observes nothing), the twin is a REGISTRY
// DOUBLE admitting the faulted value instead, the PRODUCER_KIND_LIST precedent above: the faulted
// declaration is then ACCEPTED, and that is the red.
// =====================================================================
const NV_GATE_ID = 'BG-NV';
const NEIGHBOUR_VOTE_FILE = 'neighbourVote.js';
const TOY_BUNDLE_DIR = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy');
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FORGES_DIR = path.join(TREE_ROOT, 'forges');
// LITERAL (the BR3-6 lesson at the foot of this file): R-BR-10 counted three shipped plugins declaring
// candidateRetrieval. A plugin gained or lost changes this number here, with a reason, rather than quietly.
const EXPECTED_SHIPPED_DECLARING_PLUGIN_COUNT = 3;
const EMBED_TEXT_VOTE_RETRIEVAL = Object.freeze({
	method: 'embedTextVote-v1',
	hitsPerText: 20,
	minScore: 0.3,
	k: 3,
	embeddingModelVersion: 'toy-embed-v1',
	neighbourVote: {
		method: 'neighbourVote-v1',
		owner: { kind: 'propertyValue', property: 'ownerRef' },
		siblings: { kind: 'sameOwner' },
		referencedObject: { kind: 'edgeTarget', edgeTypeList: ['POINTS_AT'] },
		earnRule: 'topShare',
	},
});
const COSINE_TOP_K_ROW_LINE = "\t'cosineTopK-v1': Object.freeze({ fieldNameList: Object.freeze(['method', 'k', 'floor', 'embeddingModelVersion']) }),";
const EMBED_TEXT_VOTE_ROW_LINE = "\t'embedTextVote-v1': Object.freeze({ fieldNameList: Object.freeze(['method', 'hitsPerText', 'minScore', 'k', 'embeddingModelVersion', 'neighbourVote']) }),\n";

const contractUnder = (scenario) => (scenario.frameworkMutationList.length === 0 ? contractLib : moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE), mutationList: scenario.frameworkMutationList }));
const toyDerivedDeclaration = () => cloneJson(require(path.join(TOY_BUNDLE_DIR, 'bridges', 'toyDerivedPlugin.js')).bridgeDeclaration);
const withEmbedTextVote = (shapeRetrieval) => (bridgeDeclaration) => {
	bridgeDeclaration.candidateRetrieval = cloneJson(EMBED_TEXT_VOTE_RETRIEVAL);
	shapeRetrieval(bridgeDeclaration.candidateRetrieval);
};
const withCosineTopK = (shapeRetrieval) => (bridgeDeclaration) => shapeRetrieval(bridgeDeclaration.candidateRetrieval);

// nvRefusalCase — the toy derived declaration, shaped, must be REFUSED with a reason matching regex; the twin
// is registered beside it
const nvRefusalCase = ({ conjunctId, title, shapeDeclaration, regex, twinName, fileName, find, replace }) => {
	frameworkMutationTwin({ registry: twinRegistry, gateId: NV_GATE_ID, conjunctId, twinName, fileName, find, replace });
	return pureConjunct({
		conjunctId,
		title,
		twinNameList: [twinName],
		judge: (scenario) => {
			const bridgeDeclaration = toyDerivedDeclaration();
			shapeDeclaration(bridgeDeclaration);
			const validated = contractUnder(scenario).validateBridgeDeclaration({ bridgeDeclaration, bundleDirPath: TOY_BUNDLE_DIR });
			if (validated.error === undefined) {
				return { pass: false, detail: 'expected a refusal but the declaration was ACCEPTED' };
			}
			return regex.test(validated.error.message) ? { pass: true, detail: validated.error.message.slice(0, 220) } : { pass: false, detail: `refused for the WRONG reason — no match for ${regex}: ${validated.error.message.slice(0, 320)}` };
		},
	});
};

// shippedDeclaringPluginList — every forges/<bundle>/bridges/*.js whose declaration carries candidateRetrieval,
// read from the tree rather than named, so a plugin added later is covered without an edit here
const shippedDeclaringPluginList = () =>
	fs
		.readdirSync(FORGES_DIR, { withFileTypes: true })
		.filter((oneEntry) => oneEntry.isDirectory() && fs.existsSync(path.join(FORGES_DIR, oneEntry.name, 'bridges')))
		.reduce((soFar, oneEntry) => soFar.concat(fs.readdirSync(path.join(FORGES_DIR, oneEntry.name, 'bridges')).filter((oneFileName) => /\.js$/.test(oneFileName)).map((oneFileName) => ({ bundleDirPath: path.join(FORGES_DIR, oneEntry.name), pluginFilePath: path.join(FORGES_DIR, oneEntry.name, 'bridges', oneFileName) }))), [])
		.filter((onePlugin) => require(onePlugin.pluginFilePath).bridgeDeclaration.candidateRetrieval !== undefined)
		.sort((leftPlugin, rightPlugin) => (leftPlugin.pluginFilePath < rightPlugin.pluginFilePath ? -1 : 1));
const toyFixturePluginList = () => fs.readdirSync(path.join(TOY_BUNDLE_DIR, 'bridges')).filter((oneFileName) => /\.js$/.test(oneFileName)).sort().map((oneFileName) => ({ bundleDirPath: TOY_BUNDLE_DIR, pluginFilePath: path.join(TOY_BUNDLE_DIR, 'bridges', oneFileName) }));

const nvConjunctList = [
	nvRefusalCase({
		conjunctId: 'l_methodAbsent',
		title: 'candidateRetrieval without a method is refused by name, never read as the cosine search (R-BR-10)',
		shapeDeclaration: withCosineTopK((retrieval) => { delete retrieval.method; }),
		regex: /candidateRetrieval declares no method; there is no default/,
		twinName: 'disableMethodAbsentCheck', fileName: CONTRACT_FILE, find: '\tif (retrievalDeclaration.method === undefined) {', replace: '\tif (false) {',
	}),
	nvRefusalCase({
		conjunctId: 'l_methodUnknown',
		title: 'an unregistered candidateRetrieval.method is refused naming every registered method',
		shapeDeclaration: withCosineTopK((retrieval) => { retrieval.method = 'cosineTopK-v2'; }),
		regex: /candidateRetrieval\.method "cosineTopK-v2" is not one of: cosineTopK-v1, embedTextVote-v1/,
		twinName: 'admitUnregisteredMethod', fileName: CONTRACT_FILE, find: COSINE_TOP_K_ROW_LINE, replace: `${COSINE_TOP_K_ROW_LINE}\n\t'cosineTopK-v2': Object.freeze({ fieldNameList: Object.freeze(['method', 'k', 'floor', 'embeddingModelVersion']) }),`,
	}),
	nvRefusalCase({
		conjunctId: 'l_neighbourVoteUnderCosineTopK',
		title: "neighbourVote declared under cosineTopK-v1 is refused naming it as embedTextVote-v1's field",
		shapeDeclaration: withCosineTopK((retrieval) => { retrieval.neighbourVote = null; }),
		regex: /candidateRetrieval carries 'neighbourVote', a field of method embedTextVote-v1 that method 'cosineTopK-v1' does not take/,
		twinName: 'disableForeignFieldCheck', fileName: CONTRACT_FILE, find: '\tif (foreignFieldName !== undefined) {', replace: '\tif (false) {',
	}),
	nvRefusalCase({
		conjunctId: 'l_unknownField',
		title: 'a field no method takes is refused naming it (the wording the PESC probes assert is kept)',
		shapeDeclaration: withCosineTopK((retrieval) => { retrieval.referenceTier = 'value'; }),
		regex: /candidateRetrieval carries unknown key 'referenceTier'/,
		twinName: 'disableUnknownFieldCheck', fileName: CONTRACT_FILE, find: '\tif (outsideFieldNameList.length > 0) {', replace: '\tif (false) {',
	}),
	nvRefusalCase({
		conjunctId: 'l_requiredFieldAbsent',
		title: "an embedTextVote-v1 declaration without minScore is refused naming the absent field (no default)",
		shapeDeclaration: withEmbedTextVote((retrieval) => { delete retrieval.minScore; }),
		regex: /candidateRetrieval method 'embedTextVote-v1' requires 'minScore' and it is absent/,
		twinName: 'disableAbsentFieldCheck', fileName: CONTRACT_FILE, find: '\tif (absentFieldName !== undefined) {', replace: '\tif (false) {',
	}),
	nvRefusalCase({
		conjunctId: 'l_neighbourVoteAbsent',
		title: 'an embedTextVote-v1 declaration without neighbourVote is refused: the votes-only form is an explicit null, never an absence',
		shapeDeclaration: withEmbedTextVote((retrieval) => { delete retrieval.neighbourVote; }),
		regex: /candidateRetrieval method 'embedTextVote-v1' requires 'neighbourVote' and it is absent/,
		twinName: 'disableAbsentFieldCheck', fileName: CONTRACT_FILE, find: '\tif (absentFieldName !== undefined) {', replace: '\tif (false) {',
	}),
	nvRefusalCase({
		conjunctId: 'l_minScoreOutOfRange',
		title: 'minScore outside [-1, 1] is refused by name',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.minScore = 1.5; }),
		regex: /candidateRetrieval\.minScore 1\.5 must be a finite cosine in \[-1, 1\]/,
		twinName: 'disableMinScoreRule', fileName: CONTRACT_FILE, find: '\tminScore: (value) => (isFiniteCosine(value) ?', replace: '\tminScore: (value) => (true ?',
	}),
	nvRefusalCase({
		conjunctId: 'l_minScoreNotNumber',
		title: 'minScore declared as a string is refused by name, never coerced',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.minScore = '0.30'; }),
		regex: /candidateRetrieval\.minScore "0\.30" must be a finite cosine in \[-1, 1\]/,
		twinName: 'disableMinScoreRule', fileName: CONTRACT_FILE, find: '\tminScore: (value) => (isFiniteCosine(value) ?', replace: '\tminScore: (value) => (true ?',
	}),
	nvRefusalCase({
		conjunctId: 'l_hitsPerTextNotPositiveInteger',
		title: 'hitsPerText that is not a positive integer is refused by name',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.hitsPerText = 0; }),
		regex: /candidateRetrieval\.hitsPerText 0 must be a positive integer/,
		twinName: 'disableHitsPerTextRule', fileName: CONTRACT_FILE, find: '\thitsPerText: (value) => (Number.isInteger(value) && value >= 1 ?', replace: '\thitsPerText: (value) => (true ?',
	}),
	nvRefusalCase({
		conjunctId: 'l_kNotPositiveInteger',
		title: 'k that is not a positive integer is refused by name under embedTextVote-v1 (one k rule serves both methods)',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.k = 2.5; }),
		regex: /candidateRetrieval\.k 2\.5 must be a positive integer/,
		twinName: 'disableKRule', fileName: CONTRACT_FILE, find: '\tk: (value) => (Number.isInteger(value) && value >= 1 ?', replace: '\tk: (value) => (true ?',
	}),
	nvRefusalCase({
		conjunctId: 'l_neighbourVoteUnknownField',
		title: 'an unknown neighbourVote field is refused naming it',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.neighbourVote.weight = 2; }),
		regex: /candidateRetrieval\.neighbourVote is refused: neighbourVote carries 'weight', outside \{ method, owner, siblings, referencedObject, earnRule \}/,
		twinName: 'disableNeighbourVoteUnknownFieldCheck', fileName: NEIGHBOUR_VOTE_FILE, find: "\tif (unknownFieldName !== undefined) {\n\t\treturn `neighbourVote carries '", replace: "\tif (false) {\n\t\treturn `neighbourVote carries '",
	}),
	nvRefusalCase({
		conjunctId: 'l_neighbourVoteFieldAbsent',
		title: 'a neighbourVote without earnRule is refused naming the absent field (no default rule)',
		shapeDeclaration: withEmbedTextVote((retrieval) => { delete retrieval.neighbourVote.earnRule; }),
		regex: /candidateRetrieval\.neighbourVote is refused: neighbourVote lacks 'earnRule'; there is no default/,
		twinName: 'disableNeighbourVoteMissingFieldCheck', fileName: NEIGHBOUR_VOTE_FILE, find: '\tif (missingFieldName !== undefined) {', replace: '\tif (false) {',
	}),
	nvRefusalCase({
		conjunctId: 'l_neighbourVoteMethodUnknown',
		title: 'an unregistered neighbourVote.method is refused by name',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.neighbourVote.method = 'neighbourVote-v2'; }),
		regex: /neighbourVote\.method "neighbourVote-v2" is none of neighbourVote-v1/,
		twinName: 'admitUnregisteredNeighbourVoteMethod', fileName: NEIGHBOUR_VOTE_FILE, find: "const NEIGHBOUR_VOTE_METHOD_LIST = Object.freeze(['neighbourVote-v1']);", replace: "const NEIGHBOUR_VOTE_METHOD_LIST = Object.freeze(['neighbourVote-v1', 'neighbourVote-v2']);",
	}),
	nvRefusalCase({
		conjunctId: 'l_ownerKindUnknown',
		title: 'an owner.kind outside OWNER_KIND_REGISTRY is refused by name (a later owner rule is a row, not a branch)',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.neighbourVote.owner = { kind: 'xpathAscent' }; }),
		regex: /neighbourVote\.owner\.kind "xpathAscent" is none of propertyValue/,
		twinName: 'admitUnregisteredOwnerKind', fileName: NEIGHBOUR_VOTE_FILE, find: 'const OWNER_KIND_REGISTRY = Object.freeze({\n', replace: "const OWNER_KIND_REGISTRY = Object.freeze({\n\txpathAscent: Object.freeze({ fieldList: Object.freeze(['kind']), declarationRefusal: () => '' }),\n",
	}),
	nvRefusalCase({
		conjunctId: 'l_ownerPropertyAbsent',
		title: 'owner.kind propertyValue without its property is refused by name',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.neighbourVote.owner = { kind: 'propertyValue' }; }),
		regex: /owner\.property undefined is not a non-empty string/,
		twinName: 'disableOwnerPropertyRule', fileName: NEIGHBOUR_VOTE_FILE, find: 'declarationRefusal: (ownerDeclaration) => (isNonEmptyString(ownerDeclaration.property) ?', replace: 'declarationRefusal: (ownerDeclaration) => (true ?',
	}),
	nvRefusalCase({
		conjunctId: 'l_siblingsKindUnknown',
		title: 'a siblings.kind outside SIBLING_KIND_REGISTRY is refused by name',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.neighbourVote.siblings = { kind: 'sameParentClass' }; }),
		regex: /neighbourVote\.siblings\.kind "sameParentClass" is none of sameOwner/,
		twinName: 'admitUnregisteredSiblingsKind', fileName: NEIGHBOUR_VOTE_FILE, find: 'const SIBLING_KIND_REGISTRY = Object.freeze({\n', replace: "const SIBLING_KIND_REGISTRY = Object.freeze({\n\tsameParentClass: Object.freeze({ fieldList: Object.freeze(['kind']), declarationRefusal: () => '' }),\n",
	}),
	nvRefusalCase({
		conjunctId: 'l_referencedObjectKindUnknown',
		title: 'a referencedObject.kind outside REFERENCED_OBJECT_KIND_REGISTRY is refused by name',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.neighbourVote.referencedObject = { kind: 'pathTarget' }; }),
		regex: /neighbourVote\.referencedObject\.kind "pathTarget" is none of edgeTarget, none/,
		twinName: 'admitUnregisteredReferencedObjectKind', fileName: NEIGHBOUR_VOTE_FILE, find: 'const REFERENCED_OBJECT_KIND_REGISTRY = Object.freeze({\n', replace: "const REFERENCED_OBJECT_KIND_REGISTRY = Object.freeze({\n\tpathTarget: Object.freeze({ fieldList: Object.freeze(['kind']), declarationRefusal: () => '' }),\n",
	}),
	nvRefusalCase({
		conjunctId: 'l_edgeTypeListEmpty',
		title: 'referencedObject.kind edgeTarget with an EMPTY edgeTypeList is refused by name',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.neighbourVote.referencedObject.edgeTypeList = []; }),
		regex: /referencedObject\.edgeTypeList \[\] is not a non-empty list of edge type names/,
		twinName: 'admitEmptyEdgeTypeList', fileName: NEIGHBOUR_VOTE_FILE, find: 'referencedObjectDeclaration.edgeTypeList.length > 0 &&', replace: 'referencedObjectDeclaration.edgeTypeList.length >= 0 &&',
	}),
	nvRefusalCase({
		conjunctId: 'l_earnRuleUnknown',
		title: 'an earnRule outside topShare and anyHit is refused by name',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.neighbourVote.earnRule = 'weightedShare'; }),
		regex: /neighbourVote\.earnRule "weightedShare" is none of topShare, anyHit/,
		twinName: 'admitUnregisteredEarnRule', fileName: NEIGHBOUR_VOTE_FILE, find: 'const EARN_RULE_REGISTRY = Object.freeze({\n', replace: 'const EARN_RULE_REGISTRY = Object.freeze({\n\tweightedShare: () => new Set(),\n',
	}),
	nvRefusalCase({
		conjunctId: 'l_ownerPropertyBlinded',
		title: 'an owner.property the plugin names in blindingDeclaration is refused by name',
		shapeDeclaration: withEmbedTextVote((retrieval) => { retrieval.neighbourVote.owner.property = 'hubAnchorId'; }),
		regex: /candidateRetrieval\.neighbourVote\.owner\.property 'hubAnchorId' is named in blindingDeclaration/,
		twinName: 'disableBlindedOwnerPropertyCheck', fileName: CONTRACT_FILE, find: '\tif (isPlainObject(neighbourVoteDeclaration) && bridgeDeclaration.blindingDeclaration.indexOf(', replace: '\tif (false && isPlainObject(neighbourVoteDeclaration) && bridgeDeclaration.blindingDeclaration.indexOf(',
	}),
	pureConjunct({
		conjunctId: 'l_embedTextVoteDeclarationsRegister',
		title: 'a complete embedTextVote-v1 declaration REGISTERS, both with the neighbourVote object and with the explicit null',
		twinNameList: ['unregisterEmbedTextVoteMethod'],
		judge: (scenario) => {
			const contractForRun = contractUnder(scenario);
			const outcomeList = [EMBED_TEXT_VOTE_RETRIEVAL, { ...EMBED_TEXT_VOTE_RETRIEVAL, neighbourVote: null }].map((oneRetrieval) => {
				const bridgeDeclaration = toyDerivedDeclaration();
				bridgeDeclaration.candidateRetrieval = cloneJson(oneRetrieval);
				const validated = contractForRun.validateBridgeDeclaration({ bridgeDeclaration, bundleDirPath: TOY_BUNDLE_DIR });
				return `neighbourVote ${oneRetrieval.neighbourVote === null ? 'null' : 'object'}: ${validated.error === undefined ? 'registers' : `REFUSED ${validated.error.message.slice(0, 200)}`}`;
			});
			return { pass: outcomeList.every((oneOutcome) => /: registers$/.test(oneOutcome)), detail: outcomeList.join('; ') };
		},
	}),
	pureConjunct({
		conjunctId: 'l_shippedDeclaringPluginsRegister',
		title: `every shipped plugin declaring candidateRetrieval (${EXPECTED_SHIPPED_DECLARING_PLUGIN_COUNT}, now with an explicit method per R-BR-10) and every toy fixture plugin still REGISTERS`,
		twinNameList: ['unregisterCosineTopKMethod'],
		judge: (scenario) => {
			const contractForRun = contractUnder(scenario);
			const shippedList = shippedDeclaringPluginList();
			const outcomeList = shippedList.concat(toyFixturePluginList()).map((onePlugin) => {
				const validated = contractForRun.validateBridgeDeclaration({ bridgeDeclaration: require(onePlugin.pluginFilePath).bridgeDeclaration, bundleDirPath: onePlugin.bundleDirPath });
				return { pluginFileName: path.basename(onePlugin.pluginFilePath), refusalText: validated.error === undefined ? '' : validated.error.message };
			});
			const refusedList = outcomeList.filter((oneOutcome) => oneOutcome.refusalText !== '');
			const countHolds = shippedList.length === EXPECTED_SHIPPED_DECLARING_PLUGIN_COUNT;
			return {
				pass: countHolds && refusedList.length === 0,
				detail: `${shippedList.length} shipped declaring (expected ${EXPECTED_SHIPPED_DECLARING_PLUGIN_COUNT}): ${outcomeList.map((oneOutcome) => oneOutcome.pluginFileName).join(', ')}; ${refusedList.length === 0 ? 'all register' : `REFUSED ${refusedList.map((oneOutcome) => `${oneOutcome.pluginFileName}: ${oneOutcome.refusalText.slice(0, 160)}`).join(' | ')}`}`,
			};
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: NV_GATE_ID, conjunctId: 'l_embedTextVoteDeclarationsRegister', twinName: 'unregisterEmbedTextVoteMethod', fileName: CONTRACT_FILE, find: EMBED_TEXT_VOTE_ROW_LINE, replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: NV_GATE_ID, conjunctId: 'l_shippedDeclaringPluginsRegister', twinName: 'unregisterCosineTopKMethod', fileName: CONTRACT_FILE, find: "\t'cosineTopK-v1': Object.freeze({", replace: "\t'cosineTopKRetired-v1': Object.freeze({" });

const gateDeclarationList = [
	{ gateId: GATE_ID, title: 'the plugin declaration object, validated by name at registration', conjunctList },
	{ gateId: NV_GATE_ID, title: 'conjunct l: every candidateRetrieval declaration refusal fires by name, and what must register still does', conjunctList: nvConjunctList },
];

runGateFamily(
	{
		harness,
		familyName: `${GATE_ID}+${NV_GATE_ID}`,
		gateDeclarationList,
		twinRegistry,
		makeSubject: scenarioLib.makeScenario,
		cloneSubject: scenarioLib.cloneScenario,
		// B3a (2026-09-15): 38 → 60. BG-NV conjunct l adds 22 conjuncts, each with one twin: 20 declaration
		// refusals and 2 must-register conjuncts. The BG-DECL count is unchanged at 38.
		// ⟪LITERAL, NOT DERIVED — RULING BR3-6 applied properly, GRANITE_VALLEY 2026-08-17⟫ These were
		// `requiredKeyList.length + 18`, which is a count DERIVED FROM THE SAME QUANTITY THE GENERATOR USES.
		// When two keys stopped being `required: true`, requiredKeyList shrank, the EXPECTATION shrank with it,
		// and a family that had quietly lost two conjuncts still reported 36/36 ALL GREEN. A guard that moves
		// with the thing it guards is not a guard. The number is now a LITERAL: any change to the contract's
		// key set must come here and be justified, which is the whole point of declaring a count.
		expectedConjunctCount: 60,
		expectedTwinCount: 60,
	},
	() => harness.report(),
);
