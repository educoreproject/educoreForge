#!/usr/bin/env node
'use strict';

// test-gFinalizers.js — G-FINALIZERS (SPEC-forgeFramework-v1.md §10.1; §6.2 steps 5-6): after forge(),
// every node's depth EQUALS an independent chain-length computation; crossRefs present on every node;
// sequence properties present where groups were declared with the per-group orderSemantics value;
// finalizeSequence ran BEFORE finalizeStructuralContract (an instrumented double records the order);
// a group without orderSemantics is refused by sequence-contract naming the group.
//
// Run: node lib/forge-framework/test/test-gFinalizers.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-FINALIZERS: depth = chain length, crossRefs universal, sequence stamped, order sequence→structural

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, scenarioTwin, refusalCase, shapedConjunct, forgeConjunct, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const { DME_ROLES } = require(path.join(toyScenario.FRAMEWORK_DIR, '..', 'vocabulary', 'vocabulary'));

const GATE_ID = 'G-FINALIZERS';
const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'forge-framework.js';
const frameworkFilePath = path.join(toyScenario.FRAMEWORK_DIR, FRAMEWORK_FILE);

const SKIP_STRUCTURAL = { modulePath: frameworkFilePath, find: '\t\t\t\tstructuralContractLib.finalizeStructuralContract({ nodes, edges });', replace: '\t\t\t\t// structural finalizer skipped by twin' };
const SEQUENCE_CALL_FIND = '\t\t\t\t\tsequenceContractLib.finalizeSequence({ nodes, orderingByParent: sequenceGroups.orderingByParent }, (finalizeError) => {';
// instrumentation the SUBJECT carries for the order conjunct: both finalizer calls append to a global ledger
const INSTRUMENT_SEQUENCE = { modulePath: frameworkFilePath, find: SEQUENCE_CALL_FIND, replace: "\t\t\t\t\t(process.__gFinalizerOrder = process.__gFinalizerOrder || []).push('sequence');\n" + SEQUENCE_CALL_FIND };
const INSTRUMENT_STRUCTURAL = { modulePath: frameworkFilePath, find: '\t\t\t\tstructuralContractLib.finalizeStructuralContract({ nodes, edges });', replace: "\t\t\t\t(process.__gFinalizerOrder = process.__gFinalizerOrder || []).push('structural');\n\t\t\t\tstructuralContractLib.finalizeStructuralContract({ nodes, edges });" };

const independentDepth = (result) => {
	const nodeByStableId = {};
	result.nodes.forEach((oneNode) => { nodeByStableId[oneNode.stableId] = oneNode; });
	const depthOf = (oneNode) => {
		let depth = 0;
		let cursor = oneNode;
		while (cursor && cursor.role !== DME_ROLES.STANDARD_ROOT) {
			cursor = nodeByStableId[cursor.properties.parentId];
			depth += 1;
			if (depth > 50) {
				return -1;
			}
		}
		return cursor ? depth : -1;
	};
	return result.nodes.find((oneNode) => oneNode.properties.depth !== depthOf(oneNode));
};

const conjunctList = [
	forgeConjunct({
		conjunctId: 'depthEqualsChainLength',
		title: "every node's depth EQUALS an independent parentId-chain-length computation",
		twinNameList: ['stampDepth99AndSkipFinalizer'],
		judge: succeeded((result) => { const offender = independentDepth(result); return { pass: offender === undefined, detail: offender ? `'${offender.stableId}' depth ${offender.properties.depth} ≠ chain length` : `all ${result.nodes.length} depths equal chain length` }; }),
	}),
	forgeConjunct({
		conjunctId: 'crossRefsOnEveryNode',
		title: "crossRefs present on every node ('[]' where the walk stamped none)",
		twinNameList: ['skipStructuralFinalizer'],
		judge: succeeded((result) => { const offender = result.nodes.find((oneNode) => oneNode.properties.crossRefs === undefined); return { pass: offender === undefined, detail: offender ? `'${offender.stableId}' lacks crossRefs` : 'crossRefs on all nodes' }; }),
	}),
	forgeConjunct({
		conjunctId: 'sequencePropertiesStamped',
		title: "sequenceOrdinal/siblingCount/orderSemantics stamped on every property of every class group, with the per-group value 'document'",
		twinNameList: ['skipFinalizeSequence'],
		judge: succeeded((result) => {
			const propertyList = result.nodes.filter((oneNode) => oneNode.role === DME_ROLES.PROPERTY);
			const offender = propertyList.find((oneNode) => typeof oneNode.properties.sequenceOrdinal !== 'number' || typeof oneNode.properties.siblingCount !== 'number' || oneNode.properties.orderSemantics !== 'document');
			const personProps = propertyList.filter((oneNode) => oneNode.properties.parentId === 'toy:class/Person');
			const ordinalText = personProps.map((oneNode) => oneNode.properties.sequenceOrdinal).join(',');
			return { pass: offender === undefined && ordinalText === '0,1,2' && personProps.every((oneNode) => oneNode.properties.siblingCount === 3), detail: offender ? `'${offender.stableId}' lacks sequence stamps` : `Person ordinals ${ordinalText}, siblingCount 3, orderSemantics document` };
		}),
	}),
	shapedConjunct({
		conjunctId: 'sequenceBeforeStructural',
		title: 'finalizeSequence ran BEFORE finalizeStructuralContract (instrumented double records the call order)',
		twinNameList: ['swapFinalizerOrder'],
		shape: (scenario) => { scenario.frameworkMutationList.push(INSTRUMENT_SEQUENCE, INSTRUMENT_STRUCTURAL); process.__gFinalizerOrder = []; },
		judge: succeeded(() => { const orderText = (process.__gFinalizerOrder || []).join(','); return { pass: orderText === 'sequence,structural', detail: `recorded order: ${orderText}` }; }),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'groupWithoutOrderSemanticsRefused',
		title: 'a sequence group without orderSemantics is refused by sequence-contract naming the group',
		shape: (scenario) => {
			const baseHooks = toyScenario.toyHooksFactory();
			scenario.hookOverrides.emitContractGraph = (context) => {
				const walkResult = baseHooks.emitContractGraph(context);
				delete walkResult.sequenceGroups.orderingByParent['toy:class/Person'].orderSemantics;
				return walkResult;
			};
		},
		regex: /finalizeSequence: sequence-contract: orderingByParent\['toy:class\/Person'\].orderSemantics must be one of normative, document/,
		twinName: 'defaultOrderSemanticsToDocument', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tsequenceContractLib.finalizeSequence({ nodes, orderingByParent: sequenceGroups.orderingByParent }, (finalizeError) => {',
		replace: "\t\t\t\t\tObject.keys(sequenceGroups.orderingByParent).forEach((oneGroupKey) => { if (sequenceGroups.orderingByParent[oneGroupKey].orderSemantics === undefined) { sequenceGroups.orderingByParent[oneGroupKey].orderSemantics = 'document'; } });\n\t\t\t\t\tsequenceContractLib.finalizeSequence({ nodes, orderingByParent: sequenceGroups.orderingByParent }, (finalizeError) => {",
	}),
];

scenarioTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'depthEqualsChainLength', twinName: 'stampDepth99AndSkipFinalizer', leverKind: 'productionMutation',
	mutate: (scenario) => {
		scenario.frameworkMutationList.push(SKIP_STRUCTURAL);
		const baseHooks = toyScenario.toyHooksFactory();
		scenario.hookOverrides.emitContractGraph = (context) => {
			const walkResult = baseHooks.emitContractGraph(context);
			// the walk stamps a wrong depth through carriedProperties (P1-style) — the finalizer would supersede it
			walkResult.nodes.filter((oneNode) => oneNode.role === DME_ROLES.CLASS).forEach((oneNode) => { oneNode.properties.depth = 99; });
			walkResult.nodes.forEach((oneNode) => { if (oneNode.properties.crossRefs === undefined) { oneNode.properties.crossRefs = '[]'; } });
			return walkResult;
		};
	},
});
scenarioTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'crossRefsOnEveryNode', twinName: 'skipStructuralFinalizer', leverKind: 'productionMutation', mutate: (scenario) => { scenario.frameworkMutationList.push(SKIP_STRUCTURAL); } });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'sequencePropertiesStamped', twinName: 'skipFinalizeSequence', fileName: FRAMEWORK_FILE, find: '\t\t\t\tif (sequenceGroups !== undefined) {\n\t\t\t\t\tif (!isPlainObject(sequenceGroups)', replace: '\t\t\t\tif (false && sequenceGroups !== undefined) {\n\t\t\t\t\tif (!isPlainObject(sequenceGroups)' });
scenarioTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'sequenceBeforeStructural', twinName: 'swapFinalizerOrder', leverKind: 'productionMutation',
	mutate: (scenario) => {
		// the swap: the structural finalizer runs FIRST (its ledger entry moves ahead of the sequence one)
		scenario.frameworkMutationList.push({ modulePath: frameworkFilePath, find: '\t\t\t\t// 5. finalizeSequence — BEFORE the structural finalizer', replace: "\t\t\t\t(process.__gFinalizerOrder = process.__gFinalizerOrder || []).push('structural'); structuralContractLib.finalizeStructuralContract({ nodes, edges });\n\t\t\t\t// 5. finalizeSequence — BEFORE the structural finalizer" });
	},
});

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the two finalizers, in order', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 5, expectedTwinCount: 5 }, () => harness.report());
