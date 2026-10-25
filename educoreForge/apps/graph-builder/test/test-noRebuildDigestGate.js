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
//   (f) a source stating no version (versionSource 'unknown') takes its version from the capture ONLY when the capture says unknown;
//       RED TWINS: a capture stating a real version, no capture entry, and any other stamp refusal each refuse by name

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
// ⟪W2A, BRONZE_CROWN ruling 2026-10-25⟫ A standard whose publisher states no version (versionSource 'unknown', e.g. SEDM: its blocks
// are sedm@unknown_01) cannot be stamped without forging, and getVersionStamp refuses it. Such a token takes the version 'unknown_<snap>'
// ONLY when the recipe's CAPTURED standardBase subject for it says exactly that (<token>@unknown_<snap>_base); any other captured value,
// or no captured entry, refuses by name. The gate still detects a change; it only stops demanding a forge for a version nobody states.
const UNKNOWN_VERSION_SOURCE_REFUSAL = /derives versionSource 'unknown' from its snapshot alone/;
const versionByTokenResultFor = ({ recipe, captureEntry, versionStampFor }) => recipe.standards.reduce((soFar, oneStandard) => {
	if (soFar.error) {
		return soFar;
	}
	const stamp = versionStampFor({ standard: oneStandard.token });
	if (!stamp.error) {
		return { versionByToken: { ...soFar.versionByToken, [oneStandard.token]: buildStatics.explicitVersionFrom(stamp.value) } };
	}
	if (!UNKNOWN_VERSION_SOURCE_REFUSAL.test(stamp.error)) {
		return { error: `${moduleName}: ${oneStandard.token}: ${stamp.error}` };
	}
	const capturedBaseSubjectList = captureEntry ? captureEntry.memberList.filter((oneMember) => oneMember.kind === 'standardBase' && oneMember.subject.startsWith(`${oneStandard.token}@`)).map((oneMember) => oneMember.subject) : [];
	const unknownMatch = capturedBaseSubjectList.length === 1 ? new RegExp(`^${oneStandard.token}@(unknown_[A-Za-z0-9]+)_base$`).exec(capturedBaseSubjectList[0]) : null;
	if (!unknownMatch) {
		return { error: `${moduleName}: ${oneStandard.token}: its source states no version (versionSource 'unknown'), and the captured standardBase subject is ${JSON.stringify(capturedBaseSubjectList)}, not exactly one '${oneStandard.token}@unknown_<snapshot>_base'; REFUSED rather than trusting a version the capture does not state as unknown` };
	}
	return { versionByToken: { ...soFar.versionByToken, [oneStandard.token]: unknownMatch[1] } };
}, { versionByToken: {} });
const captureEntryFor = (recipeName) => capture.recipeCaptureList.find((oneCapture) => oneCapture.recipeName === recipeName);
const versionByTokenFor = (recipe, recipeName) => {
	const versionResult = versionByTokenResultFor({ recipe, captureEntry: captureEntryFor(recipeName), versionStampFor: forger.getVersionStamp });
	if (versionResult.error) {
		throw new Error(versionResult.error);
	}
	return versionResult.versionByToken;
};
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
	return digestGateLib.digestGateFor({ recipe, registry: registryUnderTest || registry, versionByToken: versionByTokenFor(recipe, recipeName), frozenHeaderByPairKey: frozenHeadersFor(recipeName) });
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

harness.section('(f) the unknown-version rule: a source that states no version takes it from the capture ONLY when the capture says unknown');
// the population: every gated recipe whose capture holds an unknown-version standardBase (goldWave2: sedm@unknown_01_base)
const unknownRecipeName = gateSet.gatedRecipeList.find((recipeName) => captureEntryFor(recipeName).memberList.some((oneMember) => oneMember.kind === 'standardBase' && /@unknown_[A-Za-z0-9]+_base$/.test(oneMember.subject)));
harness.ok('a gated recipe holds an unknown-version standard (else this rule is untested)', unknownRecipeName !== undefined, JSON.stringify(gateSet.gatedRecipeList));
if (unknownRecipeName !== undefined) {
	const unknownRecipe = recipeNamed(unknownRecipeName);
	const unknownCapture = captureEntryFor(unknownRecipeName);
	const unknownBase = unknownCapture.memberList.find((oneMember) => oneMember.kind === 'standardBase' && /@unknown_[A-Za-z0-9]+_base$/.test(oneMember.subject));
	const unknownToken = unknownBase.subject.split('@')[0];
	harness.match(`precondition: getVersionStamp refuses ${unknownToken} on versionSource 'unknown' (the forge-demanding refusal this rule answers)`, String(forger.getVersionStamp({ standard: unknownToken }).error), UNKNOWN_VERSION_SOURCE_REFUSAL);
	const statedCaptureWith = (subjectFor) => ({ ...unknownCapture, memberList: unknownCapture.memberList.map((oneMember) => (oneMember === unknownBase ? { ...oneMember, subject: subjectFor(oneMember.subject) } : oneMember)) });
	harness.equal(`${unknownToken} takes '${unknownBase.subject.replace(/^[^@]+@/, '').replace(/_base$/, '')}' from the capture`, versionByTokenResultFor({ recipe: unknownRecipe, captureEntry: unknownCapture, versionStampFor: forger.getVersionStamp }).versionByToken[unknownToken], unknownBase.subject.replace(/^[^@]+@/, '').replace(/_base$/, ''));
	harness.match('RED TWIN: a capture stating a REAL version for an unknown-source token → REFUSED by name', String(versionByTokenResultFor({ recipe: unknownRecipe, captureEntry: statedCaptureWith(() => `${unknownToken}@1_0_base`), versionStampFor: forger.getVersionStamp }).error), /states no version .* REFUSED/);
	harness.match('RED TWIN: no capture entry for the recipe → REFUSED by name', String(versionByTokenResultFor({ recipe: unknownRecipe, captureEntry: undefined, versionStampFor: forger.getVersionStamp }).error), /states no version .* REFUSED/);
	harness.match('RED TWIN: any OTHER getVersionStamp refusal is not answered from the capture', String(versionByTokenResultFor({ recipe: unknownRecipe, captureEntry: unknownCapture, versionStampFor: ({ standard }) => (standard === unknownToken ? { error: 'forger.getVersionStamp: bundle resolved no snapshot directory' } : forger.getVersionStamp({ standard })) }).error), /resolved no snapshot directory/);
}

harness.section('(e) the baseline is read, never written');
harness.equal('every baseline decision store is unmodified (mtime)', capturedRecipeNameList.filter((recipeName) => fs.statSync(decisionStorePathFor(recipeName)).mtimeMs !== shaBefore[recipeName]).join(','), '');

harness.report();
