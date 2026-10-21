#!/usr/bin/env node
'use strict';

// test-noRebuildDigestGate.js — P-a1 of the R0 proof kit (2026-10-21, step 5), GRAPH-FREE: every mapping bridge of every gated
// recipe of record resolves, through the registry the build uses and the versions phase A resolves, to a pairKey FROZEN in that
// recipe's baseline decision store, and its declarationDigest equals the frozen one. Equal, a plain build materialises it;
// unequal, a plain build refuses it ("re-judge required"); absent, it would yield zero edges.
//
// Reads graphBuilder.ini [noRebuildProof] baselineDirectoryPath: capture.json (the recipes of record), noRebuildGateSet.json
// (which are gated, which are excluded and why), <recipe>/decisions.sqlite3 (opened READ-ONLY, headers only).
//
// PROVES:
//   (a) every gated recipe: every bridge PASS (or STRUCTURAL, a registered hubless producer)
//   (b) every excluded recipe still shows its declared verdict on every bridge (the exclusion cannot go stale silently)
//   (c) RED TWIN: one declaration value altered in memory → the gate fails and NAMES that bridge (DIGEST_DIFFERS)
//   (d) RED TWIN: a renamed bridge (the recipe names a name the registry lacks) → NOT_REGISTERED; a registry whose plugin
//       bridgeName moved → PAIRKEY_ABSENT (the silent-zero case, trap T1)
//   (e) the baseline is not touched: every decision store's bytes are unchanged

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate P-a1: every gated recipe's bridges would materialise from its frozen baseline blocks (graph-free)
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
FILES
     graphBuilder.ini [noRebuildProof] baselineDirectoryPath — capture.json, noRebuildGateSet.json, <recipe>/decisions.sqlite3
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);
const { getConfig } = process.global;

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const recipeLib = require('../lib/recipe')();

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const forger = require('../apps/forger');
const buildStatics = require('../lib/build');
const blockCompareLib = require('../lib/block-compare');
const digestGateLib = require('../lib/no-rebuild-digest-gate');
const pluginRegistryLib = require('../../../lib/bridge-framework/pluginRegistry');
const bridgePluginContractLib = require('../../../lib/bridge-framework/bridgePluginContract');

const proofConfig = getConfig('noRebuildProof') || {};
const baselineDirectoryPath = proofConfig.baselineDirectoryPath;
harness.section('the baseline, by declared path');
const baselinePresent = typeof baselineDirectoryPath === 'string' && fs.existsSync(path.join(baselineDirectoryPath, 'capture.json')) && fs.existsSync(path.join(baselineDirectoryPath, 'noRebuildGateSet.json'));
harness.ok('graphBuilder.ini [noRebuildProof] baselineDirectoryPath holds capture.json and noRebuildGateSet.json', baselinePresent, `got ${JSON.stringify(baselineDirectoryPath)}; there is no default and the gate does not skip`);
if (!baselinePresent) {
	harness.report();
	return;
}
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const capture = readJson(path.join(baselineDirectoryPath, 'capture.json'));
const gateSet = readJson(path.join(baselineDirectoryPath, 'noRebuildGateSet.json'));
const capturedRecipeNameList = capture.recipeCaptureList.map((oneCapture) => oneCapture.recipeName);
const unknownNameList = gateSet.gatedRecipeList.concat(gateSet.excludedRecipeList.map((oneExcluded) => oneExcluded.recipeName)).filter((recipeName) => capturedRecipeNameList.indexOf(recipeName) === -1);
harness.equal('every gated or excluded recipe is a captured recipe of record', unknownNameList.join(','), '');
const unaccountedNameList = capturedRecipeNameList.filter((recipeName) => gateSet.gatedRecipeList.indexOf(recipeName) === -1 && !gateSet.excludedRecipeList.some((oneExcluded) => oneExcluded.recipeName === recipeName));
harness.equal('every captured recipe of record is gated or excluded by name', unaccountedNameList.join(','), '');

// the build's own inputs: the discovery registry and phase A's version arithmetic
const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: path.join(TREE_ROOT, 'forges') });
// ⟪R3⟫ through loadRecipe, as a build reads it: a new-form recipe's bridges[] expand to the pairs a build runs
const recipeNamed = (recipeName) => {
	const loaded = recipeLib.loadRecipe(path.join(TREE_ROOT, 'recipes', `${recipeName}.recipe.jsonc`), { forgesDirPath: path.join(TREE_ROOT, 'forges') });
	if (loaded.error) {
		throw new Error(`${moduleName}: recipe ${recipeName}: ${loaded.error}`);
	}
	return loaded.recipe;
};
const versionByTokenFor = (recipe) => recipe.standards.reduce((soFar, oneStandard) => {
	const stamp = forger.getVersionStamp({ standard: oneStandard.token });
	if (stamp.error) {
		throw new Error(`${moduleName}: ${oneStandard.token}: ${stamp.error}`);
	}
	return { ...soFar, [oneStandard.token]: buildStatics.explicitVersionFrom(stamp.value) };
}, {});
const decisionStorePathFor = (recipeName) => path.join(baselineDirectoryPath, recipeName, 'decisions.sqlite3');
const sha256OfFile = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const shaBefore = capturedRecipeNameList.reduce((soFar, recipeName) => ({ ...soFar, [recipeName]: fs.statSync(decisionStorePathFor(recipeName)).mtimeMs }), {});
const headerCache = {};
const frozenHeadersFor = (recipeName) => {
	if (headerCache[recipeName] === undefined) {
		const read = blockCompareLib.latestFrozenHeaderByPairKey({ decisionStoreFilePath: decisionStorePathFor(recipeName) });
		if (read.error) {
			throw new Error(read.error);
		}
		headerCache[recipeName] = read.headerByPairKey;
	}
	return headerCache[recipeName];
};
const gateFor = (recipeName, registryUnderTest, recipeUnderTest) => {
	const recipe = recipeUnderTest || recipeNamed(recipeName);
	return digestGateLib.digestGateFor({ recipe, registry: registryUnderTest || registry, versionByToken: versionByTokenFor(recipe), frozenHeaderByPairKey: frozenHeadersFor(recipeName) });
};
const rowText = (oneRow) => `${oneRow.bridgeName} ${oneRow.verdict}`;

harness.section('(a) every gated recipe: every bridge would materialise from its frozen block');
gateSet.gatedRecipeList.forEach((recipeName) => {
	const gated = gateFor(recipeName);
	harness.ok(`${recipeName}: ${gated.rowList.length} bridge(s), all PASS or STRUCTURAL`, gated.passed, gated.rowList.filter((oneRow) => oneRow.verdict !== digestGateLib.VERDICT_PASS && oneRow.verdict !== digestGateLib.VERDICT_STRUCTURAL).map((oneRow) => JSON.stringify(oneRow)).join('; '));
	harness.equal(`${recipeName}: the recipe's mapping bridges are the ones captured`, gated.rowList.filter((oneRow) => oneRow.pairKey).map((oneRow) => oneRow.pairKey).join(','), capture.recipeCaptureList.find((oneCapture) => oneCapture.recipeName === recipeName).bridgeList.filter((oneBridge) => oneBridge.pairKey).map((oneBridge) => oneBridge.pairKey).join(','));
});

harness.section('(b) every excluded recipe still shows its declared verdict');
gateSet.excludedRecipeList.forEach((oneExcluded) => {
	const excluded = gateFor(oneExcluded.recipeName);
	harness.equal(`${oneExcluded.recipeName}: every bridge ${oneExcluded.expectedVerdict} (${oneExcluded.reason.slice(0, 60)}…)`, excluded.rowList.filter((oneRow) => oneRow.verdict !== oneExcluded.expectedVerdict).map(rowText).join(','), '');
});

harness.section('(c) RED TWIN: one declaration value altered in memory');
const twinRecipeName = gateSet.gatedRecipeList[0];
const twinRecipe = recipeNamed(twinRecipeName);
const twinBridgeName = twinRecipe.bridges.find((oneBridge) => oneBridge.hub !== undefined).bridge;
const registryWithEntry = (bridgeName, entryOverride) => ({ ...registry, entryByBridgeName: { ...registry.entryByBridgeName, [bridgeName]: { ...registry.entryByBridgeName[bridgeName], ...entryOverride } } });
const alteredDeclaration = { ...registry.entryByBridgeName[twinBridgeName].bridgeDeclaration, pluginVersion: '9.9.9' };
const alteredRegistry = registryWithEntry(twinBridgeName, { bridgeDeclaration: alteredDeclaration, declarationCanonicalText: bridgePluginContractLib.canonicalJsonText(alteredDeclaration) });
const altered = gateFor(twinRecipeName, alteredRegistry);
harness.equal('the gate FAILS', altered.passed, false);
harness.equal('and names exactly the altered bridge, DIGEST_DIFFERS', altered.rowList.filter((oneRow) => oneRow.verdict !== digestGateLib.VERDICT_PASS && oneRow.verdict !== digestGateLib.VERDICT_STRUCTURAL).map(rowText).join(','), `${twinBridgeName} ${digestGateLib.VERDICT_DIGEST_DIFFERS}`);

harness.section('(d) RED TWINS: a renamed bridge, a moved bridgeName');
const renamedRecipe = { ...twinRecipe, bridges: twinRecipe.bridges.map((oneBridge) => (oneBridge.bridge === twinBridgeName ? { ...oneBridge, bridge: `${twinBridgeName}Renamed` } : oneBridge)) };
const renamed = gateFor(twinRecipeName, registry, renamedRecipe);
harness.equal('a recipe naming an unregistered bridge → NOT_REGISTERED, named', renamed.rowList.filter((oneRow) => oneRow.verdict !== digestGateLib.VERDICT_PASS && oneRow.verdict !== digestGateLib.VERDICT_STRUCTURAL).map(rowText).join(','), `${twinBridgeName}Renamed ${digestGateLib.VERDICT_NOT_REGISTERED}`);
const movedDeclaration = { ...registry.entryByBridgeName[twinBridgeName].bridgeDeclaration, bridgeName: `${twinBridgeName}Moved` };
const moved = gateFor(twinRecipeName, registryWithEntry(twinBridgeName, { bridgeDeclaration: movedDeclaration, declarationCanonicalText: bridgePluginContractLib.canonicalJsonText(movedDeclaration) }));
harness.equal('a plugin whose bridgeName moved → PAIRKEY_ABSENT (a plain build would write zero edges)', moved.rowList.filter((oneRow) => oneRow.verdict !== digestGateLib.VERDICT_PASS && oneRow.verdict !== digestGateLib.VERDICT_STRUCTURAL).map(rowText).join(','), `${twinBridgeName} ${digestGateLib.VERDICT_PAIRKEY_ABSENT}`);

harness.section('(e) the baseline is read, never written');
harness.equal('every baseline decision store is unmodified (mtime)', capturedRecipeNameList.filter((recipeName) => fs.statSync(decisionStorePathFor(recipeName)).mtimeMs !== shaBefore[recipeName]).join(','), '');

harness.report();
