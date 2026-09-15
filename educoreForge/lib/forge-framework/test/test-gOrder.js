#!/usr/bin/env node
'use strict';

// test-gOrder.js — G-ORDER (SPEC-forgeFramework-v1.md §10.1; §6.4): (a) census.collisionCensus over the
// fixture output EQUALS the frozen expected (0/0/0 for the toy — the trap is "no crash"); (b) forge()
// returns nodes/edges in the walk's emission order. Twin (a), by the accepted deviation (RULINGS
// "F3a in flight"): a walk that emits one EDGE TRIPLE twice → duplicateEdgeTripleCount 1 ≠ 0 (no C2
// needed); twin (b): a framework double that sorts inside the return step.
//
// Run: node lib/forge-framework/test/test-gOrder.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-ORDER: collision census EQUALS the frozen 0/0/0; emission order passed through untouched

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, scenarioTwin, forgeConjunct, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const censusLib = require('../census');
const { EDGE_TYPES } = require(path.join(toyScenario.FRAMEWORK_DIR, '..', 'vocabulary', 'vocabulary'));

const GATE_ID = 'G-ORDER';
const twinRegistry = makeTwinRegistry();
const FROZEN_TOY_CENSUS = { duplicateStableIdCount: 0, duplicateEdgeTripleCount: 0, danglingEndpointCount: 0 };

const conjunctList = [
	forgeConjunct({
		conjunctId: 'censusEqualsFrozen',
		title: 'census.collisionCensus over the toy output EQUALS the frozen 0/0/0',
		twinNameList: ['duplicateEdgeTriple'],
		judge: succeeded((result) => {
			const census = censusLib.collisionCensus({ nodes: result.nodes, edges: result.edges });
			const asText = (oneCensus) => `${oneCensus.duplicateStableIdCount}/${oneCensus.duplicateEdgeTripleCount}/${oneCensus.danglingEndpointCount}`;
			return { pass: asText(census) === asText(FROZEN_TOY_CENSUS), detail: `census ${asText(census)} (frozen ${asText(FROZEN_TOY_CENSUS)})${census.firstDuplicateEdgeTriple ? ` first duplicate triple ${JSON.stringify(census.firstDuplicateEdgeTriple)}` : ''}` };
		}),
	}),
	{
		conjunctId: 'emissionOrderPassedThrough',
		title: "forge() returns nodes and edges in the walk's emission order (stableId sequence EQUALS the sequence captured at the walk's return)",
		twinNameList: ['sortInsideReturnStep'],
		evaluate: (scenario, callback) => {
			const captured = { nodeSequence: null, edgeSequence: null };
			const baseHooks = toyScenario.toyHooksFactory();
			scenario.hookOverrides.emitContractGraph = (context) => {
				const walkResult = baseHooks.emitContractGraph(context);
				captured.nodeSequence = walkResult.nodes.map((oneNode) => oneNode.stableId).join(',');
				captured.edgeSequence = walkResult.edges.map((oneEdge) => `${oneEdge.fromRef.id}>${oneEdge.type}>${oneEdge.toRef.id}`).join(',');
				return walkResult;
			};
			toyScenario.runScenario(scenario, (runError, outcome) => {
				if (outcome.forgeError || outcome.injectionError || outcome.thrownFromForge) {
					callback('', { pass: false, detail: outcome.forgeError || outcome.injectionError || outcome.thrownFromForge });
					return;
				}
				const returnedNodeSequence = outcome.result.nodes.map((oneNode) => oneNode.stableId).join(',');
				const returnedEdgeSequence = outcome.result.edges.map((oneEdge) => `${oneEdge.fromRef.id}>${oneEdge.type}>${oneEdge.toRef.id}`).join(',');
				const pass = returnedNodeSequence === captured.nodeSequence && returnedEdgeSequence === captured.edgeSequence;
				callback('', { pass, detail: pass ? `${outcome.result.nodes.length} nodes / ${outcome.result.edges.length} edges in walk order` : `node order ${returnedNodeSequence === captured.nodeSequence ? 'same' : 'DIFFERS'}, edge order ${returnedEdgeSequence === captured.edgeSequence ? 'same' : 'DIFFERS'}` });
			});
		},
	},
];

scenarioTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'censusEqualsFrozen', twinName: 'duplicateEdgeTriple', leverKind: 'productionMutation',
	mutate: (scenario) => {
		const baseHooks = toyScenario.toyHooksFactory();
		scenario.hookOverrides.emitContractGraph = (context) => {
			const walkResult = baseHooks.emitContractGraph(context);
			context.kit.addEdge({ edgeType: EDGE_TYPES.HAS_CLASS, fromStableId: context.kit.rootStableId, toStableId: 'toy:class/Person', edgeContext: 'root->Person (again)' });
			return walkResult;
		};
	},
});
frameworkMutationTwin({
	registry: twinRegistry, gateId: GATE_ID, conjunctId: 'emissionOrderPassedThrough', twinName: 'sortInsideReturnStep', fileName: 'forge-framework.js',
	find: '\t\t\t\tconst nodes = returnedNodes === kitInternals.nodes ? returnedNodes : returnedNodes.concat(embedTextNodeList);\n\t\t\t\tconst edges = returnedEdges === kitInternals.edges ? returnedEdges : returnedEdges.concat(embedTextEdgeList);',
	replace: "\t\t\t\tconst nodes = returnedNodes.slice().sort((leftNode, rightNode) => (leftNode.stableId < rightNode.stableId ? -1 : 1));\n\t\t\t\tconst edges = returnedEdges.slice().sort((leftEdge, rightEdge) => (`${leftEdge.fromRef.id}${leftEdge.type}` < `${rightEdge.fromRef.id}${rightEdge.type}` ? -1 : 1));",
});

const gateDeclarationList = [{ gateId: GATE_ID, title: 'collision census and emission order', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 2, expectedTwinCount: 2 }, () => harness.report());
