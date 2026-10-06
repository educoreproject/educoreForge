#!/usr/bin/env node
'use strict';

// test-bgSiblingDeclarations.js — BG-SIBLINGS (W-B-5, V1-C07 / V1-S78; campaign P3 2026-10-06): the derived plugins ONE
// recipe runs agree on every declaration key except the ones declared per-standard (bridgePluginContract
// DERIVED_PLUGIN_PER_STANDARD_KEY_LIST). The survey found Ed-Fi's plugin missing two opt-ins every sibling declares
// (blockRecordsJudgeConfig, promptIdentifierScan); nothing tested sibling consistency, so the gap was invisible.
//
// THE SCOPE IS A RECIPE, NOT THE TREE. forges/pesc260805 keeps two older derived plugins (categoryTable-v1, no opt-ins)
// that no gold recipe runs; holding them to the gold's siblings would make the gate red for a bundle nothing builds.
// The recipe named below is the one R2 builds, so "siblings" means the plugins that freeze blocks side by side in it.
//
//   BG-SIBLINGS  (a) every non-per-standard key is canonically identical across the recipe's derived plugins, and a
//                dotted per-standard member relaxes only that member of its object; (b) the recipe names at least two
//                derived plugins and each one registers (a scope of one would agree with itself vacuously).
//
// Run: node lib/bridge-framework/test/test-bgSiblingDeclarations.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-SIBLINGS: derived plugins of one recipe agree outside their per-standard keys

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { pureConjunct, scenarioTwin } = require('./testSupport/bridgeTwinFactories');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');
const CONTRACT_FILE = 'bridgePluginContract.js';
const SIBLING_RECIPE_PATH = path.join(TREE_ROOT, 'recipes', 'goldJevAcceptance2.recipe.jsonc');
const recipeLib = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'lib', 'recipe'))();
const pluginRegistryLib = require('../pluginRegistry');

const contractLibFor = (scenario) =>
	scenario.frameworkMutationList.length ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CONTRACT_FILE), mutationList: scenario.frameworkMutationList }) : require('../bridgePluginContract');

// the recipe's derived plugins, each declaration cloned so a twin may alter one without touching the loaded module
const siblingDeclarationListFor = (scenario) => {
	const loaded = recipeLib.loadRecipe(SIBLING_RECIPE_PATH);
	if (loaded.error) {
		return { error: loaded.error };
	}
	const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });
	const declarationList = loaded.recipe.bridges.map((oneBridge) => {
		const entry = registry.entryByBridgeName[oneBridge.bridge];
		return entry === undefined ? { bridgeName: oneBridge.bridge, unregistered: true } : JSON.parse(JSON.stringify(entry.bridgeDeclaration));
	});
	const overrideByBridgeName = scenario.siblingDeclarationMutationByBridgeName || {};
	declarationList.forEach((oneDeclaration) => {
		if (overrideByBridgeName[oneDeclaration.bridgeName]) {
			overrideByBridgeName[oneDeclaration.bridgeName](oneDeclaration);
		}
	});
	return { declarationList: declarationList.filter((oneDeclaration) => oneDeclaration.unregistered || oneDeclaration.matchBasis === 'derived') };
};

// comparableTextFor — a key's canonical text with its relaxed members removed ('<absent>' when the key is absent)
const comparableTextFor = ({ contractLib, bridgeDeclaration, declarationKeyName, relaxedMemberNameList }) => {
	if (!Object.prototype.hasOwnProperty.call(bridgeDeclaration, declarationKeyName)) {
		return '<absent>';
	}
	const keyValue = bridgeDeclaration[declarationKeyName];
	if (relaxedMemberNameList.length === 0 || keyValue === null || typeof keyValue !== 'object' || Array.isArray(keyValue)) {
		return contractLib.canonicalJsonText(keyValue);
	}
	const trimmed = Object.keys(keyValue)
		.filter((oneMemberName) => relaxedMemberNameList.indexOf(oneMemberName) === -1)
		.reduce((accumulator, oneMemberName) => ({ ...accumulator, [oneMemberName]: keyValue[oneMemberName] }), {});
	return contractLib.canonicalJsonText(trimmed);
};

const siblingFaultListFor = (scenario) => {
	const contractLib = contractLibFor(scenario);
	const { declarationList, error } = siblingDeclarationListFor(scenario);
	if (error) {
		return { error };
	}
	const perStandardKeyList = contractLib.DERIVED_PLUGIN_PER_STANDARD_KEY_LIST;
	const wholeKeyList = perStandardKeyList.filter((oneName) => oneName.indexOf('.') === -1);
	const relaxedMemberListByKey = perStandardKeyList
		.filter((oneName) => oneName.indexOf('.') !== -1)
		.reduce((accumulator, oneName) => {
			const [declarationKeyName, memberName] = oneName.split('.');
			return { ...accumulator, [declarationKeyName]: (accumulator[declarationKeyName] || []).concat([memberName]) };
		}, {});
	const keyNameList = Array.from(new Set(declarationList.reduce((accumulator, oneDeclaration) => accumulator.concat(Object.keys(oneDeclaration)), []))).sort();
	const faultList = [];
	keyNameList
		.filter((oneKeyName) => wholeKeyList.indexOf(oneKeyName) === -1)
		.forEach((oneKeyName) => {
			const textByBridgeName = declarationList.reduce(
				(accumulator, oneDeclaration) => ({ ...accumulator, [oneDeclaration.bridgeName]: comparableTextFor({ contractLib, bridgeDeclaration: oneDeclaration, declarationKeyName: oneKeyName, relaxedMemberNameList: relaxedMemberListByKey[oneKeyName] || [] }) }),
				{},
			);
			const firstBridgeName = declarationList[0].bridgeName;
			const divergentBridgeName = Object.keys(textByBridgeName).find((oneBridgeName) => textByBridgeName[oneBridgeName] !== textByBridgeName[firstBridgeName]);
			if (divergentBridgeName !== undefined) {
				faultList.push(`${oneKeyName}: ${divergentBridgeName} ${textByBridgeName[divergentBridgeName].slice(0, 60)} vs ${firstBridgeName} ${textByBridgeName[firstBridgeName].slice(0, 60)}`);
			}
		});
	return { faultList, declarationList };
};

const siblingConjunctList = [
	pureConjunct({
		conjunctId: 'a_siblingsAgreeOutsidePerStandardKeys',
		title: "every key outside DERIVED_PLUGIN_PER_STANDARD_KEY_LIST is canonically identical across the recipe's derived plugins",
		twinNameList: ['edfiDropsBlockRecordsJudgeConfig'],
		judge: (scenario) => {
			const { faultList, declarationList, error } = siblingFaultListFor(scenario);
			if (error) {
				return { pass: false, detail: error };
			}
			return { pass: faultList.length === 0, detail: faultList.length ? `${faultList.length} divergent key(s): ${faultList.join(' | ')}` : `${declarationList.length} derived plugin(s) agree outside their per-standard keys` };
		},
	}),
	pureConjunct({
		conjunctId: 'b_recipeNamesRegisteredDerivedSiblings',
		title: 'the recipe names at least two derived plugins and every one registers',
		twinNameList: ['recipeBridgeUnregistered'],
		judge: (scenario) => {
			const { declarationList, error } = siblingDeclarationListFor(scenario);
			if (error) {
				return { pass: false, detail: error };
			}
			const unregisteredList = declarationList.filter((oneDeclaration) => oneDeclaration.unregistered).map((oneDeclaration) => oneDeclaration.bridgeName);
			return { pass: declarationList.length >= 2 && unregisteredList.length === 0, detail: `${declarationList.length} derived plugin(s); unregistered: ${unregisteredList.length ? unregisteredList.join(', ') : 'none'}` };
		},
	}),
];
scenarioTwin({
	registry: twinRegistry,
	gateId: 'BG-SIBLINGS',
	conjunctId: 'a_siblingsAgreeOutsidePerStandardKeys',
	twinName: 'edfiDropsBlockRecordsJudgeConfig',
	leverKind: 'inputFault',
	mutate: (scenario) => {
		scenario.siblingDeclarationMutationByBridgeName = { edfiCedsDerivedPlugin: (bridgeDeclaration) => delete bridgeDeclaration.blockRecordsJudgeConfig };
	},
});
scenarioTwin({
	registry: twinRegistry,
	gateId: 'BG-SIBLINGS',
	conjunctId: 'b_recipeNamesRegisteredDerivedSiblings',
	twinName: 'recipeBridgeUnregistered',
	leverKind: 'inputFault',
	mutate: (scenario) => {
		scenario.siblingDeclarationMutationByBridgeName = { sif260928CedsDerivedPlugin: (bridgeDeclaration) => Object.assign(bridgeDeclaration, { unregistered: true }) };
	},
});

const gateDeclarationList = [{ gateId: 'BG-SIBLINGS', title: 'derived plugins of one recipe agree outside their per-standard keys', conjunctList: siblingConjunctList }];

runGateFamily(
	{ harness, familyName: 'BG-SIBLINGS', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 2 },
	() => harness.report(),
);
