#!/usr/bin/env node
'use strict';

// test-gEmbed.js — G-EMBED (SPEC-forgeFramework-v1.md §10.1; §6.3): skipEmbedding true → embedCallCount 0
// and a spy embedder that throws on call is never called; skipEmbedding false + embedder null → refused
// by name; N embeddable nodes → ceil(N/128) calls; embedNodeLimit n → exactly min(n, embeddable) nodes
// carry vectors, role filter FIRST then slice in emission order; non-embeddable roles carry none and
// stay in place; a vector/text count mismatch is refused; a batch failure names its batch number.
// EQUALITY of counts throughout — the trap is "count is a number".
//
// Run: node lib/forge-framework/test/test-gEmbed.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-EMBED: the embed pass — counts EQUAL, filter then slice, refusals by name

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const toyScenario = require('./testSupport/toyScenario');
const { frameworkMutationTwin, refusalCase, shapedConjunct, succeeded } = require('./testSupport/twinFactories');
const { runGateFamily } = require('./testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../roundTripHarness/twinRegistry');
const { DME_ROLES } = require(path.join(toyScenario.FRAMEWORK_DIR, '..', 'vocabulary', 'vocabulary'));

const GATE_ID = 'G-EMBED';
const twinRegistry = makeTwinRegistry();
const EMBED_FILE = 'embedPass.js';
const FRAMEWORK_FILE = 'forge-framework.js';
const TOY_EMBEDDABLE_COUNT = 15; // 16 nodes − the one DmeSupport (non-embeddable by declaration)

const withSpy = (scenario, spyOptions) => {
	scenario.spyEmbedder = toyScenario.makeSpyEmbedder(spyOptions);
	scenario.deps = { ...scenario.deps, embedder: scenario.spyEmbedder };
	scenario.forgeArgs = { ...scenario.forgeArgs, skipEmbedding: false };
};
// a walk that mints `count` extra classes (to cross a batch boundary)
const withExtraClasses = (scenario, count) => {
	const baseHooks = toyScenario.toyHooksFactory();
	scenario.hookOverrides.emitContractGraph = (context) => {
		const walkResult = baseHooks.emitContractGraph(context);
		for (let extraIndex = 0; extraIndex < count; extraIndex++) {
			context.kit.makeNode({ role: DME_ROLES.CLASS, perStandardLabel: 'ToyClass', stableId: `toy:class/Bulk${extraIndex}`, name: `Bulk${extraIndex}`, structural: { parentId: context.kit.rootStableId, path: `Bulk${extraIndex}` }, origin: `bulk ${extraIndex}` });
		}
		return walkResult;
	};
};
// a walk that mints the (non-embeddable) support node FIRST, so a slice-before-filter double would burn a slot on it
const withSupportFirst = (scenario) => {
	const baseHooks = toyScenario.toyHooksFactory();
	scenario.hookOverrides.emitContractGraph = (context) => {
		context.kit.makeNode({ role: DME_ROLES.SUPPORT, perStandardLabel: 'ToySupport', stableId: 'toy:support/FirstNote', name: 'FirstNote', structural: { parentId: context.kit.rootStableId, path: 'FirstNote' }, origin: 'support first' });
		context.kit.addEdge({ edgeType: 'HAS_SUPPORT', fromStableId: context.kit.rootStableId, toStableId: 'toy:support/FirstNote', edgeContext: 'root->FirstNote' });
		return baseHooks.emitContractGraph(context);
	};
};

const conjunctList = [
	shapedConjunct({
		conjunctId: 'skipEmbeddingNeverCallsEmbedder',
		title: 'skipEmbedding: true → embedCallCount EQUALS 0 and a spy embedder that throws on call is never called',
		twinNameList: ['embedDespiteSkip'],
		shape: (scenario) => { scenario.spyEmbedder = toyScenario.makeSpyEmbedder({ throwOnCall: true }); scenario.deps = { ...scenario.deps, embedder: scenario.spyEmbedder }; scenario.forgeArgs = { ...scenario.forgeArgs, skipEmbedding: true }; },
		judge: (outcome, scenario) => {
			if (outcome.forgeError || outcome.thrownFromForge || outcome.injectionError) {
				return { pass: false, detail: outcome.forgeError || outcome.thrownFromForge || outcome.injectionError };
			}
			return { pass: outcome.result.embedCallCount === 0 && scenario.spyEmbedder.callCount === 0, detail: `embedCallCount ${outcome.result.embedCallCount}, spy calls ${scenario.spyEmbedder.callCount}` };
		},
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'nullEmbedderRefused',
		title: 'skipEmbedding: false with embedder null is refused by name ("silence is not consent to spend")',
		shape: (scenario) => { scenario.forgeArgs = { ...scenario.forgeArgs, skipEmbedding: false }; },
		regex: /embedding requested \(skipEmbedding: false\) with embedder null/,
		twinName: 'disableNullEmbedderCheck', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\tif (skipEmbedding === false && embedder === null) {', replace: '\t\t\t\t\tif (false && skipEmbedding === false && embedder === null) {',
	}),
	shapedConjunct({
		conjunctId: 'batchCountEqualsCeil',
		title: `N embeddable nodes → embedCallCount EQUALS ceil(N/128): ${TOY_EMBEDDABLE_COUNT}+130 embeddable → 2 calls`,
		twinNameList: ['batchSize256'],
		shape: (scenario) => { withSpy(scenario, {}); withExtraClasses(scenario, 130); },
		judge: succeeded((result, outcome) => ({ pass: result.embedCallCount === 2 && outcome.result.nodes.filter((oneNode) => oneNode.properties.embedding !== undefined).length === TOY_EMBEDDABLE_COUNT + 130, detail: `embedCallCount ${result.embedCallCount}, embedded ${result.nodes.filter((oneNode) => oneNode.properties.embedding !== undefined).length}` })),
	}),
	shapedConjunct({
		conjunctId: 'limitFilterThenSlice',
		title: 'embedNodeLimit 3 with the non-embeddable support node emitted FIRST → exactly 3 nodes carry vectors (role filter FIRST, then slice in emission order)',
		twinNameList: ['sliceBeforeFilter'],
		shape: (scenario) => { withSpy(scenario, {}); withSupportFirst(scenario); scenario.forgeArgs = { ...scenario.forgeArgs, embedNodeLimit: 3 }; },
		judge: succeeded((result) => {
			const embeddedList = result.nodes.filter((oneNode) => oneNode.properties.embedding !== undefined);
			const supportEmbedded = result.nodes.some((oneNode) => oneNode.role === DME_ROLES.SUPPORT && oneNode.properties.embedding !== undefined);
			return { pass: embeddedList.length === 3 && !supportEmbedded, detail: `embedded ${embeddedList.length}: ${embeddedList.map((oneNode) => oneNode.stableId).join(', ')}${supportEmbedded ? ' (a SUPPORT node consumed a slot)' : ''}` };
		}),
	}),
	shapedConjunct({
		conjunctId: 'nonEmbeddableStaysInPlace',
		title: 'non-embeddable roles carry NO vector and remain in the array in place; every embeddable node carries one (count EQUALS 15)',
		twinNameList: ['embedNonEmbeddableToo'],
		shape: (scenario) => withSpy(scenario, {}),
		judge: succeeded((result) => {
			const supportNode = result.nodes.find((oneNode) => oneNode.role === DME_ROLES.SUPPORT);
			const embeddedCount = result.nodes.filter((oneNode) => oneNode.properties.embedding !== undefined).length;
			return { pass: supportNode !== undefined && supportNode.properties.embedding === undefined && embeddedCount === TOY_EMBEDDABLE_COUNT && result.nodes.length === 16, detail: `support has vector: ${supportNode && supportNode.properties.embedding !== undefined}; embedded ${embeddedCount} of ${result.nodes.length}` };
		}),
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'vectorCountMismatchRefused',
		title: 'vectors.length !== texts.length is refused naming both counts',
		shape: (scenario) => withSpy(scenario, { vectorCountDelta: 1 }),
		regex: /embedder returned 16 vectors for 15 texts/,
		twinName: 'disableVectorCountCheck', fileName: EMBED_FILE,
		find: '\t\t\t\t\tif (!embedResult || !Array.isArray(embedResult.vectors) || embedResult.vectors.length !== texts.length) {', replace: '\t\t\t\t\tif (false && (!embedResult || !Array.isArray(embedResult.vectors) || embedResult.vectors.length !== texts.length)) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'batchFailureNamesBatch',
		title: 'a batch failure is refused with its batch number in the text',
		shape: (scenario) => withSpy(scenario, { failOnCall: true }),
		regex: /embedNodes batch 1 failed: voyage said no/,
		twinName: 'dropBatchNumber', fileName: EMBED_FILE,
		find: '\t\t\t\t\t\tcallback(`${prefixText} embedNodes batch ${batchIndex} failed: ${embedError}`);', replace: '\t\t\t\t\t\tcallback(`${prefixText} embedNodes failed: ${embedError}`);',
	}),
	refusalCase({
		registry: twinRegistry, gateId: GATE_ID, conjunctId: 'missingModelVersionRefused',
		title: 'an embedder returning no embeddingModelVersion is refused (the model version is CARRIED, never invented)',
		shape: (scenario) => withSpy(scenario, { omitModelVersion: true }),
		regex: /embedder returned no embeddingModelVersion/,
		twinName: 'disableModelVersionCheck', fileName: EMBED_FILE,
		find: "\t\t\t\t\tif (typeof embedResult.embeddingModelVersion !== 'string' || embedResult.embeddingModelVersion.length === 0) {", replace: "\t\t\t\t\tif (false && (typeof embedResult.embeddingModelVersion !== 'string' || embedResult.embeddingModelVersion.length === 0)) {",
	}),
];

frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'skipEmbeddingNeverCallsEmbedder', twinName: 'embedDespiteSkip', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\tif (skipEmbedding === true) {\n\t\t\t\t\t\tnext(\'\', { ...args, embedCallCount: 0 });', replace: '\t\t\t\t\tif (false) {\n\t\t\t\t\t\tnext(\'\', { ...args, embedCallCount: 0 });' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'batchCountEqualsCeil', twinName: 'batchSize256', fileName: EMBED_FILE, find: 'const EMBED_BATCH_SIZE = 128;', replace: 'const EMBED_BATCH_SIZE = 256;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'limitFilterThenSlice', twinName: 'sliceBeforeFilter', fileName: EMBED_FILE,
	find: "\t\t\tconst embeddableNodeList = nodes.filter((oneNode) => passNonEmbeddableRoleList.indexOf(oneNode.role) === -1);\n\t\t\tconst targetNodeList =\n\t\t\t\tnodeSubsetLimit !== undefined && nodeSubsetLimit < embeddableNodeList.length\n\t\t\t\t\t? embeddableNodeList.slice(0, nodeSubsetLimit)\n\t\t\t\t\t: embeddableNodeList;",
	replace: "\t\t\tconst slicedFirst = nodeSubsetLimit !== undefined && nodeSubsetLimit < nodes.length ? nodes.slice(0, nodeSubsetLimit) : nodes;\n\t\t\tconst targetNodeList = slicedFirst.filter((oneNode) => passNonEmbeddableRoleList.indexOf(oneNode.role) === -1);" });
frameworkMutationTwin({ registry: twinRegistry, gateId: GATE_ID, conjunctId: 'nonEmbeddableStaysInPlace', twinName: 'embedNonEmbeddableToo', fileName: EMBED_FILE, find: '\t\t\tconst embeddableNodeList = nodes.filter((oneNode) => passNonEmbeddableRoleList.indexOf(oneNode.role) === -1);', replace: '\t\t\tconst embeddableNodeList = nodes.slice();' });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the embed pass', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject: toyScenario.makeScenario, cloneSubject: toyScenario.cloneScenario, expectedConjunctCount: 8, expectedTwinCount: 8 }, () => harness.report());
