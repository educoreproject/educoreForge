#!/usr/bin/env node
'use strict';

// test-gAdapter.js — G-ADAPTER (SPEC-forgeFramework-v1.md §10.1; §6.1 step 5; Profile §2.2): a hook that
// THROWS inside the pure layer surfaces as callback('forge-toy buildContractGraph: …'), never as a
// thrown error across forge(). Twin: a framework double with the adapter removed → the throw escapes.
//
// Run: node lib/forge-framework/test/test-gAdapter.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-ADAPTER: a pure-layer throw becomes callback('forge-<key> buildContractGraph: …')

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, shapedConjunct } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');

const GATE_ID = 'G-ADAPTER';
const twinRegistry = makeTwinRegistry();

const withThrowingWalk = (scenario) => {
	scenario.hookOverrides.emitContractGraph = ({ parsed, metadata, kit }) => {
		throw new Error('the walk found a malformed construct');
	};
};

const conjunctList = [
	shapedConjunct({
		conjunctId: 'throwSurfacesAsCallbackError',
		title: "a hook throw inside the pure layer surfaces as callback('forge-toy buildContractGraph: <message>') — the error-string PREFIX is asserted",
		twinNameList: ['removeAdapter'],
		shape: withThrowingWalk,
		judge: (outcome) => {
			if (outcome.thrownFromForge) {
				return { pass: false, detail: `the throw ESCAPED forge(): ${outcome.thrownFromForge}` };
			}
			const expectedPrefix = 'forge-toy buildContractGraph: forge-toy buildContractGraph: ';
			const pass = typeof outcome.forgeError === 'string' && outcome.forgeError.startsWith('forge-toy buildContractGraph: ') && /the walk found a malformed construct/.test(outcome.forgeError);
			return { pass, detail: pass ? outcome.forgeError.slice(0, 120) : `got ${JSON.stringify(outcome.forgeError)}` };
		},
	}),
	shapedConjunct({
		conjunctId: 'kitRefusalSurfacesAsCallbackError',
		title: "a KIT refusal (a named Error thrown by makeNode) surfaces through the same adapter with the same prefix",
		twinNameList: ['removeAdapter'],
		shape: (scenario) => {
			const baseHooks = toyScenario.toyHooksFactory();
			scenario.hookOverrides.emitContractGraph = (context) => {
				const walkResult = baseHooks.emitContractGraph(context);
				context.kit.makeNode({ role: 'DmeClass', perStandardLabel: 'ToyClass', stableId: 'toy:class/Person', name: 'Dup', structural: { parentId: context.kit.rootStableId, path: 'Dup' }, origin: 'dup' });
				return walkResult;
			};
		},
		judge: (outcome) => {
			if (outcome.thrownFromForge) {
				return { pass: false, detail: `the throw ESCAPED forge(): ${outcome.thrownFromForge}` };
			}
			const pass = typeof outcome.forgeError === 'string' && outcome.forgeError.startsWith('forge-toy buildContractGraph: contractGraphKit REFUSED: makeNode: duplicate stableId');
			return { pass, detail: String(outcome.forgeError).slice(0, 140) };
		},
	}),
];

const ADAPTER_FIND = "\t\t\t\t\tlet contractGraph;\n\t\t\t\t\tlet buildError = '';\n\t\t\t\t\ttry {\n\t\t\t\t\t\tcontractGraph = buildContractGraph({ parsed: args.parsed, metadata: args.metadata });\n\t\t\t\t\t} catch (thrownError) {\n\t\t\t\t\t\tbuildError = thrownError.message;\n\t\t\t\t\t}";
const ADAPTER_REPLACE = "\t\t\t\t\tlet buildError = '';\n\t\t\t\t\tconst contractGraph = buildContractGraph({ parsed: args.parsed, metadata: args.metadata });";
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'throwSurfacesAsCallbackError', twinName: 'removeAdapter', fileName: 'forge-framework.js', find: ADAPTER_FIND, replace: ADAPTER_REPLACE });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'kitRefusalSurfacesAsCallbackError', twinName: 'removeAdapter', fileName: 'forge-framework.js', find: ADAPTER_FIND, replace: ADAPTER_REPLACE });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the ONE adapter', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 2, expectedTwinCount: 2 }, () => harness.report());
