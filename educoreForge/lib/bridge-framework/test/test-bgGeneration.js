#!/usr/bin/env node
'use strict';

// test-bgGeneration.js — BG-GENERATION (W-B-11, V1-C16; campaign P3 2026-10-06): the generation names WHICH declaration
// judged. It used to be '<frameworkGeneration>:<bridgeName>@<pluginVersion>:<rendererVersion>', and every shipped plugin
// says pluginVersion '1.0.0', so two runs of two different declarations wrote one forensics file and one cache generation.
//
//   BG-GENERATION  (a) two toy derived declarations differing in ONE renderingAllowList name freeze blocks whose header
//                  generations differ, both parse with parseGeneration, and each one's digest segment is its own
//                  declaration's; (b) the SSSOM set header's mapping_tool carries the declaration digest beside the
//                  declared tool version.
//
// Run: node lib/bridge-framework/test/test-bgGeneration.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-GENERATION: the generation is derived from the declaration digest

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, succeeded, frameworkMutationTwin, blockOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const decisionBlockLib = require('../decisionBlock');
const bridgePluginContractLib = require('../bridgePluginContract');

const twinRegistry = makeTwinRegistry();
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const DECISION_BLOCK_FILE = 'decisionBlock.js';
const FRAMEWORK_FILE = 'bridge-framework.js';
const TOY_EMBED_MODEL = 'toy-embed-v1';
const fixtureDeclaration = () => scenarioLib.cloneJson(require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`)).bridgeDeclaration);
const digestOf = (bridgeDeclaration) => scenarioLib.sha256Hex(bridgePluginContractLib.canonicalJsonText(bridgeDeclaration));

const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
// the same scenario under the fixture declaration with ONE subject allow-list name dropped
const narrowedDeclaration = () => {
	const bridgeDeclaration = fixtureDeclaration();
	bridgeDeclaration.renderingAllowList = { ...bridgeDeclaration.renderingAllowList, subject: bridgeDeclaration.renderingAllowList.subject.slice(0, -1) };
	return bridgeDeclaration;
};

const conjunctList = [
	{
		conjunctId: 'a_oneAllowListNameMovesTheGeneration',
		title: 'two declarations differing in ONE renderingAllowList name freeze different generations, each parsing and naming its own digest',
		twinNameList: ['generationWithoutDigest'],
		evaluate: (scenario, callback) => {
			const firstScenario = scenarioLib.cloneScenario(scenario);
			derivedShape(firstScenario);
			scenarioLib.runScenario(firstScenario, (unusedFirstError, firstOutcome) => {
				const secondScenario = scenarioLib.cloneScenario(scenario);
				derivedShape(secondScenario);
				const secondDeclaration = narrowedDeclaration();
				secondScenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = { bridgeDeclaration: secondDeclaration };
				scenarioLib.runScenario(secondScenario, (unusedSecondError, secondOutcome) => {
					const firstBlock = blockOf(firstOutcome);
					const secondBlock = blockOf(secondOutcome);
					if (firstBlock === null || secondBlock === null) {
						callback('', { pass: false, detail: `a run froze no block: ${firstOutcome.runError || secondOutcome.runError || 'unknown'}`.slice(0, 300) });
						return;
					}
					const firstParsed = decisionBlockLib.parseGeneration(firstBlock.header.generation);
					const secondParsed = decisionBlockLib.parseGeneration(secondBlock.header.generation);
					const ownDigests = !firstParsed.error && !secondParsed.error && firstParsed.declarationDigest12 === digestOf(fixtureDeclaration()).slice(0, 12) && secondParsed.declarationDigest12 === digestOf(secondDeclaration).slice(0, 12);
					const pass = firstBlock.header.generation !== secondBlock.header.generation && ownDigests;
					callback('', { pass, detail: `generations ${firstBlock.header.generation} / ${secondBlock.header.generation}; parse ${firstParsed.error ? 'REFUSED' : 'ok'} / ${secondParsed.error ? 'REFUSED' : 'ok'}; own digests ${ownDigests}` });
				});
			});
		},
	},
	runConjunct({
		conjunctId: 'b_sssomMappingToolCarriesTheDigest',
		title: "the SSSOM set header's mapping_tool reads '<name> <version>+<declarationDigest12>'",
		twinNameList: ['sssomMappingToolWithoutDigest'],
		shape: derivedShape,
		judge: succeeded((runReport) => {
			const sssomText = fs.readFileSync(runReport.sssomExportPath, 'utf8');
			const toolLine = sssomText.split('\n').find((oneLine) => /mapping_tool/.test(oneLine)) || '';
			const expectedTail = `+${digestOf(fixtureDeclaration()).slice(0, 12)}`;
			return { pass: toolLine.indexOf(expectedTail) !== -1, detail: `mapping_tool line ${JSON.stringify(toolLine.slice(0, 160))}; expected to contain ${expectedTail}` };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-GENERATION', conjunctId: 'a_oneAllowListNameMovesTheGeneration', twinName: 'generationWithoutDigest', fileName: DECISION_BLOCK_FILE, find: '	return `${FRAMEWORK_GENERATION}:${bridgeName}@${pluginVersion}+${declarationDigest.slice(0, GENERATION_DECLARATION_DIGEST_LENGTH)}:${rendererVersion}`;', replace: '	return `${FRAMEWORK_GENERATION}:${bridgeName}@${pluginVersion}+000000000000:${rendererVersion}`;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-GENERATION', conjunctId: 'b_sssomMappingToolCarriesTheDigest', twinName: 'sssomMappingToolWithoutDigest', fileName: FRAMEWORK_FILE, find: '{ mappingTool: `${bridgeDeclaration.mappingTool.name} ${bridgeDeclaration.mappingTool.version}+${declarationDigest.slice(0, 12)}` }', replace: '{ mappingTool: `${bridgeDeclaration.mappingTool.name} ${bridgeDeclaration.mappingTool.version}` }' });

const gateDeclarationList = [{ gateId: 'BG-GENERATION', title: 'the generation is derived from the declaration digest', conjunctList }];

runGateFamily(
	{ harness, familyName: 'BG-GENERATION', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 2 },
	() => harness.report(),
);
