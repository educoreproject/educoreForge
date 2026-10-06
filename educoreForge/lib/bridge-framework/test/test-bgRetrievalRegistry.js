#!/usr/bin/env node
'use strict';

// test-bgRetrievalRegistry.js — BG-RREG: candidate retrieval as a method REGISTRY (lane C, 2026-10-01;
// DESIGN-C-candidateRegistry.md §1, §2, §6.5). Hermetic: the toy derived bridge under the debug judge, no container.
//
//   BG-RREG (a1) an UNREGISTERED method is refused by name by the registry itself, listing the registered methods
//           (a2) a declaration naming NO method is refused by name; there is no default row
//           (b1) a method whose pool seats one card twice is refused, through the full run, naming method and card
//           (b2) a method whose trace carries a field its row does not declare is refused, naming both field sets
//           (b3) a method whose seat is not a card stableId is refused by the registry, before the card index is consulted
//           (c1) a row missing a CANDIDATE_RETRIEVAL_METHOD_ROW_SHAPE member is refused at framework construction
//           (c2) two rows sharing one method name are refused when the contract loads (which happens first)
//           (c3) ... and by the registry's own construction guard behind it
//           (d)  the contract's field lists ARE the registry rows' (one home): a field added to a row reaches the contract
//
// The malformed-pool conjuncts (b) fault a REAL row through moduleDouble — the defect is planted in the method, where a
// real defect would be — and the twin removes the one check that names it. The contract-level unknown-method refusal is
// BG-NV (l_methodUnknown) in test-bgDecl.js; a1 is the registry's own guard behind it.
//
// Run: node lib/bridge-framework/test/test-bgRetrievalRegistry.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-RREG: candidate retrieval as a method registry

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { pureConjunct, succeeded, refusalCase, frameworkMutationTwin, frameworkFile } = require('./testSupport/bridgeTwinFactories');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const GATE_ID = 'BG-RREG';
const REGISTRY_FILE = 'candidateRetrievalMethodRegistry.js';
const CONTRACT_FILE = 'bridgePluginContract.js';
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const TOY_EMBED_MODEL = 'toy-embed-v1';

// the toy derived bridge (cosineTopK-v1), exactly as test-bgDerived.js shapes it
const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};

// plantInRegistry — a shape that faults a REAL row (moduleDouble), on top of derivedShape
const plantInRegistry = ({ find, replace }) => (scenario) => {
	derivedShape(scenario);
	moduleDouble.assertMutationApplies({ modulePath: frameworkFile(REGISTRY_FILE), find });
	scenario.frameworkMutationList.push({ modulePath: frameworkFile(REGISTRY_FILE), find, replace });
};

// registryUnder / contractLoadUnder — the module as the scenario's mutations leave it
const registryUnder = (scenario) => (scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: frameworkFile(REGISTRY_FILE), mutationList: scenario.frameworkMutationList }) : require(frameworkFile(REGISTRY_FILE)));
const contractLoadUnder = (scenario) => {
	// the test's OBSERVATION instrument: the contract refuses an unruled field by THROWING at load, so the throw is the result
	try {
		moduleDouble.loadWithMutations({ modulePath: frameworkFile(CONTRACT_FILE), mutationList: scenario.frameworkMutationList });
		return { loadError: '' };
	} catch (loadThrow) {
		if (String(loadThrow.message).startsWith(moduleDouble.MUTATION_REFUSAL_TAG)) {
			throw loadThrow;
		}
		return { loadError: loadThrow.message };
	}
};

const COSINE_TOP_K_POOL_RETURN = 'return { seatStableIdList: retrieved.seatList.map((oneSeat) => oneSeat.stableId), recordTraceByFieldName: { retrievalSeatList: retrieved.seatList.map((oneSeat) => ({ stableId: oneSeat.stableId, rank: oneSeat.rank, cosine: oneSeat.cosine })) } };';
const COSINE_TOP_K_TRACE_DECLARATION = "\t\trecordTraceFieldNameList: Object.freeze(['retrievalSeatList']),\n";
const COSINE_TOP_K_FIELD_DECLARATION = "\t\tfieldNameList: Object.freeze(['method', 'k', 'floor', 'embeddingModelVersion']),";
const EMBED_TEXT_METHOD_NAME_LINE = "\t\tmethodName: 'embedTextVote-v1',";
const CONTRACT_METHOD_ROW_LIST_READ = 'candidateRetrievalMethodRegistryLib.CANDIDATE_RETRIEVAL_METHOD_ROW_LIST.reduce(';

const pureRefusal = ({ conjunctId, title, twinName, find, replace, refusalFor, regex, plantList = [] }) => {
	frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId, twinName, fileName: REGISTRY_FILE, find, replace });
	return pureConjunct({
		conjunctId,
		title,
		twinNameList: [twinName],
		judge: (scenario) => {
			plantList.forEach((onePlant) => moduleDouble.assertMutationApplies({ modulePath: frameworkFile(REGISTRY_FILE), find: onePlant.find }));
			const plantedMutationList = scenario.frameworkMutationList.concat(plantList.map((onePlant) => ({ modulePath: frameworkFile(REGISTRY_FILE), find: onePlant.find, replace: onePlant.replace })));
			const looked = refusalFor(registryUnder({ ...scenario, frameworkMutationList: plantedMutationList }));
			if (looked.error === undefined) {
				return { pass: false, detail: `expected a refusal but got a row (${looked.methodRow ? looked.methodRow.methodName : JSON.stringify(looked)})` };
			}
			return regex.test(looked.error.message) ? { pass: true, detail: looked.error.message.slice(0, 220) } : { pass: false, detail: `refused for the WRONG reason — no match for ${regex}: ${looked.error.message.slice(0, 260)}` };
		},
	});
};

const registryConjunctList = [
	pureRefusal({
		conjunctId: 'a1_unregisteredMethodRefusedByName',
		title: 'an unregistered method is refused by the registry by name, listing the registered methods',
		twinName: 'unregisteredFallsToFirstRow',
		find: '\treturn methodRow !== undefined\n\t\t? { methodRow }',
		replace: '\treturn CANDIDATE_RETRIEVAL_METHOD_ROW_LIST[0] !== undefined\n\t\t? { methodRow: methodRow || CANDIDATE_RETRIEVAL_METHOD_ROW_LIST[0] }',
		refusalFor: (registryLib) => registryLib.methodRowFor({ method: 'classTree-v0' }),
		regex: /candidateRetrieval\.method "classTree-v0" is not a registered candidate retrieval method \(registered: cosineTopK-v1, embedTextVote-v1\)/,
	}),
	pureRefusal({
		conjunctId: 'a2_absentMethodRefusedNoDefault',
		title: 'a declaration naming no method is refused by name; no row is a default',
		twinName: 'absentMethodCheckRemoved',
		find: '\tif (!isPlainObject(retrievalDeclaration) || !isNonBlank(retrievalDeclaration.method)) {',
		replace: '\tif (!isPlainObject(retrievalDeclaration)) {',
		refusalFor: (registryLib) => registryLib.methodRowFor({ k: 3 }),
		regex: /no candidate retrieval method is named/,
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: GATE_ID,
		conjunctId: 'b1_duplicateSeatRefused',
		title: 'a method seating one card twice is refused through the full run, naming the method and the card',
		shape: plantInRegistry({ find: COSINE_TOP_K_POOL_RETURN, replace: COSINE_TOP_K_POOL_RETURN.replace('seatStableIdList: retrieved.seatList.map((oneSeat) => oneSeat.stableId),', 'seatStableIdList: retrieved.seatList.map((oneSeat) => oneSeat.stableId).concat(retrieved.seatList.slice(0, 1).map((oneSeat) => oneSeat.stableId)),') }),
		regex: /candidate retrieval method 'cosineTopK-v1' seats card toyhub:card\/\S+ twice; one card holds at most one seat in a pool for subject toy:property\//,
		twinName: 'duplicateSeatCheckRemoved',
		fileName: REGISTRY_FILE,
		find: '\tif (duplicatedSeatStableId !== undefined) {',
		replace: '\tif (false) {',
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: GATE_ID,
		conjunctId: 'b2_undeclaredTraceFieldRefused',
		title: 'a method whose trace carries an undeclared field is refused, naming both field sets',
		shape: plantInRegistry({ find: COSINE_TOP_K_POOL_RETURN, replace: COSINE_TOP_K_POOL_RETURN.replace('recordTraceByFieldName: { retrievalSeatList:', 'recordTraceByFieldName: { strayTraceField: 1, retrievalSeatList:') }),
		regex: /returned trace fields \{ retrievalSeatList, strayTraceField \} where its row declares \{ retrievalSeatList \}/,
		twinName: 'traceFieldCheckRemoved',
		fileName: REGISTRY_FILE,
		find: '\tif (fieldNameTextOf(recordTraceByFieldName) !== methodRow.recordTraceFieldNameList.join(\', \')) {',
		replace: '\tif (false) {',
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: GATE_ID,
		conjunctId: 'b3_nonStableIdSeatRefusedByTheRegistry',
		title: "a seat that is not a card stableId is refused by the registry's shape check, not left to the card index",
		shape: plantInRegistry({ find: COSINE_TOP_K_POOL_RETURN, replace: COSINE_TOP_K_POOL_RETURN.replace('seatStableIdList: retrieved.seatList.map((oneSeat) => oneSeat.stableId),', 'seatStableIdList: retrieved.seatList.map((oneSeat) => oneSeat.rank),') }),
		regex: /candidate retrieval method 'cosineTopK-v1' returned seatStableIdList\[0\] 1, not a card stableId/,
		twinName: 'seatShapeCheckRemoved',
		fileName: REGISTRY_FILE,
		find: '\tif (blankSeatIndex !== -1) {',
		replace: '\tif (false) {',
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: GATE_ID,
		conjunctId: 'c1_rowMissingAMemberRefusedAtConstruction',
		title: 'a row missing a declared member is refused at framework construction, before any run',
		shape: plantInRegistry({ find: COSINE_TOP_K_TRACE_DECLARATION, replace: '' }),
		regex: /CANDIDATE_RETRIEVAL_METHOD_ROW_LIST\[0\] carries \{ fieldNameList, mappingMethodFor, methodName, poolForSubject, prepareRetrieval, settingsPairListFor \}/,
		twinName: 'memberSetCheckRemoved',
		fileName: REGISTRY_FILE,
		find: '\tif (malformedRowIndex !== -1) {',
		replace: '\tif (false) {',
	}),
	refusalCase({
		registry: twinRegistry,
		gateId: GATE_ID,
		conjunctId: 'c2_duplicateMethodNameRefusedWhenTheContractLoads',
		title: 'two rows sharing one method name are refused when the contract loads, before any declaration is judged',
		shape: plantInRegistry({ find: EMBED_TEXT_METHOD_NAME_LINE, replace: "\t\tmethodName: 'cosineTopK-v1'," }),
		regex: /CANDIDATE_RETRIEVAL_METHOD_ROW_LIST names method 'cosineTopK-v1' twice/,
		twinName: 'contractDuplicateNameCheckRemoved',
		fileName: CONTRACT_FILE,
		find: 'if (duplicatedRetrievalMethodName !== undefined) {',
		replace: 'if (false) {',
	}),
	pureRefusal({
		conjunctId: 'c3_duplicateMethodNameRefusedByTheRegistryGuard',
		title: "the registry's own construction guard refuses two rows sharing one method name (the guard behind the contract's)",
		twinName: 'registryDuplicateNameCheckRemoved',
		find: '\tif (duplicatedMethodName !== undefined) {',
		replace: '\tif (false) {',
		plantList: [{ find: EMBED_TEXT_METHOD_NAME_LINE, replace: "\t\tmethodName: 'cosineTopK-v1'," }],
		refusalFor: (registryLib) => {
			const violation = registryLib.registryViolation();
			return violation === null ? { methodRow: { methodName: '(registryViolation returned null)' } } : { error: violation };
		},
		regex: /CANDIDATE_RETRIEVAL_METHOD_ROW_LIST names method 'cosineTopK-v1' twice/,
	}),
	pureConjunct({
		conjunctId: 'd_contractFieldListsAreTheRows',
		title: "a field added to a registry row reaches the contract (one home): the contract refuses it at load for want of a value rule",
		twinNameList: ['contractRestatesFieldLists'],
		judge: (scenario) => {
			moduleDouble.assertMutationApplies({ modulePath: frameworkFile(REGISTRY_FILE), find: COSINE_TOP_K_FIELD_DECLARATION });
			const planted = { ...scenario, frameworkMutationList: scenario.frameworkMutationList.concat([{ modulePath: frameworkFile(REGISTRY_FILE), find: COSINE_TOP_K_FIELD_DECLARATION, replace: COSINE_TOP_K_FIELD_DECLARATION.replace("'embeddingModelVersion']", "'embeddingModelVersion', 'unruledField']") }]) };
			const { loadError } = contractLoadUnder(planted);
			const expected = /CANDIDATE_RETRIEVAL_METHOD_REGISTRY names field 'unruledField', which has no row in CANDIDATE_RETRIEVAL_FIELD_RULE_REGISTRY/;
			return expected.test(loadError) ? { pass: true, detail: loadError.slice(0, 220) } : { pass: false, detail: loadError === '' ? 'the contract loaded: it did not see the field the row added' : `wrong load error: ${loadError.slice(0, 220)}` };
		},
	}),
];
// the twin for (d): the contract states its own field lists again, as it did before lane C
frameworkMutationTwin({
	registry: twinRegistry,
	gateId: GATE_ID,
	conjunctId: 'd_contractFieldListsAreTheRows',
	twinName: 'contractRestatesFieldLists',
	fileName: CONTRACT_FILE,
	find: CONTRACT_METHOD_ROW_LIST_READ,
	replace: "[{ methodName: 'cosineTopK-v1', fieldNameList: ['method', 'k', 'floor', 'embeddingModelVersion'] }, { methodName: 'embedTextVote-v1', fieldNameList: ['method', 'hitsPerText', 'minScore', 'k', 'embeddingModelVersion', 'neighbourVote'] }].reduce(",
});

const gateDeclarationList = [{ gateId: GATE_ID, title: 'candidate retrieval as a method registry: refusal by name, the pool shape, the row shape, one home for field lists', conjunctList: registryConjunctList }];

// BASELINE CONTROL, outside the family: the unplanted toy derived run SUCCEEDS, so (b) and (c) fail only where planted
const controlScenario = scenarioLib.makeScenario();
derivedShape(controlScenario);
scenarioLib.runScenario(controlScenario, (unusedError, controlOutcome) => {
	const controlVerdict = succeeded(() => ({ pass: true, detail: 'ran' }))(controlOutcome, controlScenario);
	harness.ok(`CONTROL: the unplanted toy derived run succeeds (${controlVerdict.detail.slice(0, 160)})`, controlVerdict.pass);
	runGateFamily(
		{
			harness,
			familyName: 'BG-RREG',
			gateDeclarationList,
			twinRegistry,
			makeSubject: scenarioLib.makeScenario,
			cloneSubject: scenarioLib.cloneScenario,
			// LITERAL, never derived from a .length (RULING SABLE_RIVER 2026-08-17): a1 a2 b1 b2 b3 c1 c2 c3 d, one twin each
			expectedConjunctCount: 9,
			expectedTwinCount: 9,
		},
		() => harness.report(),
	);
});
