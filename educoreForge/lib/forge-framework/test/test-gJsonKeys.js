#!/usr/bin/env node
'use strict';

// test-gJsonKeys.js — G-JSONKEYS (SPEC-forgeFramework-v1.md §10.1; §4.1; §6.4): mappingInstruction,
// crossRefs and (Ed-Fi's) mergeDirectives strings produced THROUGH the framework are byte-identical
// to today's literal-order strings, for a fixture of each forge's values (test/fixtures/jsonKeys/).
// Twin: a builder that stringifies with keys in alphabetical order → red on mappingInstruction (its
// literal order is not alphabetical) and on crossRefs.
//
// Run: node lib/forge-framework/test/test-gJsonKeys.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-JSONKEYS: JSON-string bytes (mappingInstruction, crossRefs, mergeDirectives) identical to today's literal order

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, shapedConjunct, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const { DME_ROLES } = require(path.join(toyScenario.FRAMEWORK_DIR, '..', 'vocabulary', 'vocabulary'));
const expected = require('./fixtures/jsonKeys/expectedJsonStrings.json');

const GATE_ID = 'G-JSONKEYS';
const twinRegistry = makeTwinRegistry();

const conjunctList = [];
Object.keys(expected.mappingInstructionByForge).forEach((oneForgeKey) => {
	const { declared, expectedString } = expected.mappingInstructionByForge[oneForgeKey];
	conjunctList.push(
		shapedConjunct({
			conjunctId: `mappingInstruction_${oneForgeKey}`,
			title: `${oneForgeKey}'s mappingInstruction, declared in literal order, is stringified onto the root BYTE-IDENTICAL to today's string`,
			twinNameList: ['alphabeticalMappingInstruction'],
			shape: (scenario) => { scenario.forgeDeclaration.mappingInstruction = JSON.parse(JSON.stringify(declared)); },
			judge: succeeded((result) => {
				const rootNode = result.nodes.find((oneNode) => oneNode.role === DME_ROLES.STANDARD_ROOT);
				return { pass: rootNode.properties.mappingInstruction === expectedString, detail: rootNode.properties.mappingInstruction === expectedString ? 'byte-identical' : `got ${rootNode.properties.mappingInstruction}` };
			}),
		}),
	);
	frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: `mappingInstruction_${oneForgeKey}`, twinName: 'alphabeticalMappingInstruction', fileName: 'rootNode.js', find: '\t\tmappingInstruction: JSON.stringify(mappingInstruction),', replace: '\t\tmappingInstruction: JSON.stringify(mappingInstruction, Object.keys(mappingInstruction).sort()),' });
});

conjunctList.push(
	shapedConjunct({
		conjunctId: 'crossRefsJson',
		title: 'kit.crossRefsJson stringifies [{ system, id, raw, locator }] in EXACTLY that key order, raw null-not-string when null',
		twinNameList: ['alphabeticalCrossRefs'],
		shape: (scenario) => {
			const baseHooks = toyScenario.toyHooksFactory();
			scenario.hookOverrides.emitContractGraph = (context) => {
				const walkResult = baseHooks.emitContractGraph(context);
				context.kit.makeNode({ role: DME_ROLES.CLASS, perStandardLabel: 'ToyClass', stableId: 'toy:class/CrossRefProbe', name: 'CrossRefProbe', structural: { parentId: context.kit.rootStableId, path: 'CrossRefProbe' }, carriedProperties: { crossRefs: context.kit.crossRefsJson(expected.crossRefs.input) }, origin: 'probe' });
				return walkResult;
			};
		},
		judge: succeeded((result) => { const probe = result.nodes.find((oneNode) => oneNode.stableId === 'toy:class/CrossRefProbe'); return { pass: probe.properties.crossRefs === expected.crossRefs.expectedString, detail: probe.properties.crossRefs === expected.crossRefs.expectedString ? 'byte-identical' : `got ${probe.properties.crossRefs}` }; }),
	}),
	shapedConjunct({
		conjunctId: 'mergeDirectivesPassThrough',
		title: 'a walk-composed mergeDirectives JSON string handed through carriedProperties reaches the node BYTE-IDENTICAL',
		twinNameList: ['reserializeCarriedJson'],
		shape: (scenario) => {
			const baseHooks = toyScenario.toyHooksFactory();
			scenario.hookOverrides.emitContractGraph = (context) => {
				const walkResult = baseHooks.emitContractGraph(context);
				context.kit.makeNode({ role: DME_ROLES.CLASS, perStandardLabel: 'ToyClass', stableId: 'toy:class/MergeProbe', name: 'MergeProbe', structural: { parentId: context.kit.rootStableId, path: 'MergeProbe' }, carriedProperties: context.kit.carriedProperties({ parsedObject: { mergeDirectives: expected.mergeDirectives.carriedString }, carryList: ['mergeDirectives'] }), origin: 'probe' });
				return walkResult;
			};
		},
		judge: succeeded((result) => { const probe = result.nodes.find((oneNode) => oneNode.stableId === 'toy:class/MergeProbe'); return { pass: probe.properties.mergeDirectives === expected.mergeDirectives.carriedString, detail: probe.properties.mergeDirectives === expected.mergeDirectives.carriedString ? 'byte-identical' : `got ${probe.properties.mergeDirectives}` }; }),
	}),
);
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'crossRefsJson', twinName: 'alphabeticalCrossRefs', fileName: 'contractGraphKit.js', find: '\t\treturn JSON.stringify(ordered);', replace: "\t\treturn JSON.stringify(ordered, ['id', 'locator', 'raw', 'system']);" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'mergeDirectivesPassThrough', twinName: 'reserializeCarriedJson', fileName: 'contractGraphKit.js', find: '\t\t\t\tcarried[oneFieldName] = parsedObject[oneFieldName];', replace: "\t\t\t\tcarried[oneFieldName] = typeof parsedObject[oneFieldName] === 'string' && parsedObject[oneFieldName].startsWith('[') ? JSON.stringify(JSON.parse(parsedObject[oneFieldName]), Object.keys(JSON.parse(parsedObject[oneFieldName])[0]).sort()) : parsedObject[oneFieldName];" });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'JSON-string bytes', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 6, expectedTwinCount: 6 }, () => harness.report());
