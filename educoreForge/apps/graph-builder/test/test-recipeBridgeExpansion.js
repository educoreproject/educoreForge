#!/usr/bin/env node
'use strict';

// test-recipeBridgeExpansion.js — gate for the NEW recipe bridge form (R3 of the hub-neutral bridge lane, 2026-10-21, step 4):
// a recipe entry { source, hubs:[...], dependencies, facet?, params? } expands, at load, to one old-form { source, hub, bridge,
// dependencies, params? } entry per hub, the bridge name DERIVED from the standard's bridging file by the composer's rule.
//
// PROVES (apps/graph-builder/lib/recipe-bridge-expansion.js, wired through recipe.js loadRecipe):
//   (a) every registered bridge of the shipped tree is reachable: for every (standard, facet, declared hub), the expansion names a
//       bridge the registry holds, for that standard and that hub, and together they name EVERY registered bridge
//   (b) every recipe of record loads to the bridges its build captured at R0 (baseline capture.json: source, hub, bridge name)
//   (c) the expansion's own rules on a toy standard: one entry per hub in order, a pair's dependencies drop the OTHER hubs,
//       params carried, old-form and structural entries untouched and in place
//   (d) refusals by name: hubs mixed with hub/bridge; hubs empty or repeated; facet omitted for a many-facet standard; a facet
//       or hub the standard does not declare; a new-form recipe loaded with no forgesDirPath or a relative one

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the new recipe bridge form expands to the bridges a build has always run
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);
const { getConfig } = process.global;

const fs = require('fs');
const os = require('os');
const path = require('path');

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const FORGES_DIR_PATH = path.join(TREE_ROOT, 'forges');
const recipeBridgeExpansionLib = require('../lib/recipe-bridge-expansion');
const recipeLib = require('../lib/recipe')();
const pluginRegistryLib = require(path.join(TREE_ROOT, 'lib', 'bridge-framework', 'pluginRegistry'));

const registry = pluginRegistryLib.buildRegistryFromDirectory({ forgesDirPath: FORGES_DIR_PATH });
const shippedStandardBridgingFor = (sourceToken) => pluginRegistryLib.standardBridgingFor({ forgesDirPath: FORGES_DIR_PATH, standardKey: sourceToken });

harness.section('(a) every registered bridge is reachable from the new form');
const bundleNameList = Array.from(new Set(Object.keys(registry.entryByBridgeName).map((bridgeName) => registry.entryByBridgeName[bridgeName].standardKey))).sort();
const reachedNameList = [];
const unreachedPairList = [];
bundleNameList.forEach((standardKey) => {
	const found = shippedStandardBridgingFor(standardKey);
	if (found.error) {
		unreachedPairList.push(`${standardKey}: ${found.error.message}`);
		return;
	}
	found.standardBridging.facetList.forEach((oneFacet) => {
		Object.keys(oneFacet.pairByHubToken).forEach((hubToken) => {
			const expanded = recipeBridgeExpansionLib.expandRecipeBridges({ recipe: { bridges: [{ source: standardKey, hubs: [hubToken], dependencies: [standardKey, hubToken], facet: oneFacet.facetName }] }, standardBridgingFor: shippedStandardBridgingFor });
			const entry = expanded.recipe && registry.entryByBridgeName[expanded.recipe.bridges[0].bridge];
			if (entry === undefined || entry.standardKey !== standardKey || entry.targetHub !== hubToken) {
				unreachedPairList.push(`${standardKey} facet ${JSON.stringify(oneFacet.facetName)} → ${hubToken}: ${expanded.error ? expanded.error.message : expanded.recipe.bridges[0].bridge}`);
				return;
			}
			reachedNameList.push(entry.bridgeName);
		});
	});
});
harness.equal('every declared (standard, facet, hub) expands to a registered bridge of that standard and hub', unreachedPairList.join('\n'), '');
harness.equal('the expansions name every registered bridge, each once', reachedNameList.slice().sort().join(','), Object.keys(registry.entryByBridgeName).sort().join(','));

harness.section('(b) every recipe of record loads to the bridges its build captured');
const proofConfig = getConfig('noRebuildProof') || {};
const baselineDirectoryPath = proofConfig.baselineDirectoryPath;
const capturePath = typeof baselineDirectoryPath === 'string' ? path.join(baselineDirectoryPath, 'capture.json') : '';
harness.ok('graphBuilder.ini [noRebuildProof] baselineDirectoryPath holds capture.json', capturePath !== '' && fs.existsSync(capturePath), `got ${JSON.stringify(baselineDirectoryPath)}; there is no default and the gate does not skip`);
if (capturePath !== '' && fs.existsSync(capturePath)) {
	const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
	capture.recipeCaptureList.forEach((recipeCapture) => {
		const loaded = recipeLib.loadRecipe(path.join(TREE_ROOT, 'recipes', `${recipeCapture.recipeName}.recipe.jsonc`), { forgesDirPath: FORGES_DIR_PATH });
		const loadedText = loaded.error ? `REFUSED ${loaded.error}` : loaded.recipe.bridges.filter((oneBridge) => oneBridge.hub !== undefined).map((oneBridge) => `${oneBridge.source}->${oneBridge.hub}:${oneBridge.bridge}`).join('\n');
		const capturedText = recipeCapture.bridgeList.filter((oneBridge) => oneBridge.hub !== undefined && oneBridge.hub !== null).map((oneBridge) => `${oneBridge.source}->${oneBridge.hub}:${oneBridge.bridgeName}`).join('\n');
		harness.equal(`${recipeCapture.recipeName}: loaded mapping bridges equal the R0 capture, in order`, loadedText, capturedText);
	});
}

harness.section('(c) the expansion rules, on a toy standard');
const TOY_BRIDGING = {
	standardKey: 'toy',
	bridgeNameStem: 'toy',
	facetList: [
		{ facetName: '', declarationTemplate: { matchBasis: 'derived' }, subjectRenderingAllowList: null, pairByHubToken: { hubx: {}, huby: {} } },
		{ facetName: 'Codes', declarationTemplate: { matchBasis: 'declared' }, subjectRenderingAllowList: null, pairByHubToken: { hubx: {} } },
	],
};
const toyStandardBridgingFor = (sourceToken) => (sourceToken === 'toy' ? { standardBridging: TOY_BRIDGING } : { error: new Error(`no bridging file for '${sourceToken}'`) });
const toyExpand = (bridgeList) => recipeBridgeExpansionLib.expandRecipeBridges({ recipe: { recipeName: 'toyRecipe', bridges: bridgeList }, standardBridgingFor: toyStandardBridgingFor });
const OLD_ENTRY = { source: 'other', hub: 'hubx', bridge: 'otherHubxDerivedPlugin', dependencies: ['other', 'hubx'] };
const STRUCTURAL_ENTRY = { source: 'toy', pairWith: 'toy2', bridge: 'toyStructure', dependencies: ['toy', 'toy2'] };
const expandedToy = toyExpand([OLD_ENTRY, { source: 'toy', hubs: ['huby', 'hubx'], facet: '', dependencies: ['toy', 'hubx', 'huby', 'toyHelper'], params: { specifiedMatchPropertyNames: ['refId'] } }, STRUCTURAL_ENTRY]);
harness.equal('one entry per hub, in the hubs order, between the untouched neighbours', JSON.stringify(expandedToy.recipe && expandedToy.recipe.bridges), JSON.stringify([
	OLD_ENTRY,
	{ source: 'toy', hub: 'huby', bridge: 'toyHubyDerivedPlugin', dependencies: ['toy', 'huby', 'toyHelper'], params: { specifiedMatchPropertyNames: ['refId'] } },
	{ source: 'toy', hub: 'hubx', bridge: 'toyHubxDerivedPlugin', dependencies: ['toy', 'hubx', 'toyHelper'], params: { specifiedMatchPropertyNames: ['refId'] } },
	STRUCTURAL_ENTRY,
]));
harness.equal('expandedEntryCount counts new-form entries', expandedToy.expandedEntryCount, 1);
harness.equal('a facet with a different basis derives its own name', toyExpand([{ source: 'toy', hubs: ['hubx'], facet: 'Codes', dependencies: ['toy'] }]).recipe.bridges[0].bridge, 'toyCodesHubxDeclaredCorrespondence');
const oldOnlyRecipe = { recipeName: 'oldOnly', bridges: [OLD_ENTRY] };
harness.ok('a recipe with no new-form entry is returned as it came, no bridging file read', recipeBridgeExpansionLib.expandRecipeBridges({ recipe: oldOnlyRecipe, standardBridgingFor: undefined }).recipe === oldOnlyRecipe);

harness.section('(d) refusals by name');
const refusalText = (bridgeList) => {
	const expanded = toyExpand(bridgeList);
	return expanded.error ? expanded.error.message : '';
};
harness.ok('hubs beside hub/bridge is refused', /names hubs\[\] and also \[hub, bridge\]/.test(refusalText([{ source: 'toy', hubs: ['hubx'], hub: 'hubx', bridge: 'toyHubxDerivedPlugin', facet: '', dependencies: ['toy'] }])));
harness.ok('an empty hubs list is refused', /is not a non-empty list of distinct hub tokens/.test(refusalText([{ source: 'toy', hubs: [], facet: '', dependencies: ['toy'] }])));
harness.ok('a repeated hub is refused', /is not a non-empty list of distinct hub tokens/.test(refusalText([{ source: 'toy', hubs: ['hubx', 'hubx'], facet: '', dependencies: ['toy'] }])));
harness.ok('facet omitted for a two-facet standard is refused, naming the facets', /names no facet, and 'toy' declares 2 \["", "Codes"\]/.test(refusalText([{ source: 'toy', hubs: ['hubx'], dependencies: ['toy'] }])));
harness.ok('an undeclared facet is refused', /facet "Nope" is not declared by 'toy'/.test(refusalText([{ source: 'toy', hubs: ['hubx'], facet: 'Nope', dependencies: ['toy'] }])));
harness.ok('a hub the facet does not pair with is refused, naming the declared hubs', /facet "Codes" does not pair with hub\(s\) \[huby\]; it declares \[hubx\]/.test(refusalText([{ source: 'toy', hubs: ['huby'], facet: 'Codes', dependencies: ['toy'] }])));
harness.ok('a source with no bridging file is refused', /no bridging file for 'nobody'/.test(refusalText([{ source: 'nobody', hubs: ['hubx'], dependencies: ['nobody'] }])));
harness.ok('every refusal in a recipe is reported, not only the first', refusalText([{ source: 'toy', hubs: [], dependencies: ['toy'] }, { source: 'nobody', hubs: ['hubx'], dependencies: ['nobody'] }]).split('\n').length === 2);
harness.ok('the shipped tree: edfi does not pair with ctdl', /does not pair with hub\(s\) \[ctdl\]; it declares \[ceds\]/.test((recipeBridgeExpansionLib.expandRecipeBridges({ recipe: { bridges: [{ source: 'edfi', hubs: ['ceds', 'ctdl'], dependencies: ['edfi', 'ceds', 'ctdl'] }] }, standardBridgingFor: shippedStandardBridgingFor }).error || {}).message || ''));
const scratchDirectoryPath = fs.mkdtempSync(path.join(os.tmpdir(), `${moduleName}-`));
const newFormRecipePath = path.join(scratchDirectoryPath, 'newForm.recipe.jsonc');
fs.writeFileSync(newFormRecipePath, JSON.stringify({ recipeName: 'newForm', bridges: [{ source: 'edfi', hubs: ['ceds'], dependencies: ['edfi', 'ceds'] }] }));
harness.ok('loadRecipe of a new-form recipe with no forgesDirPath is refused by name', /no standardBridgingFor was supplied/.test(recipeLib.loadRecipe(newFormRecipePath).error || ''));
harness.ok('loadRecipe with a relative forgesDirPath is refused by name', /an absolute forges directory and a standard token are both required/.test(recipeLib.loadRecipe(newFormRecipePath, { forgesDirPath: 'forges' }).error || ''));
harness.equal('loadRecipe with the tree\'s forges directory expands it', JSON.stringify((recipeLib.loadRecipe(newFormRecipePath, { forgesDirPath: FORGES_DIR_PATH }).recipe || {}).bridges), JSON.stringify([{ source: 'edfi', hub: 'ceds', bridge: 'edfiCedsDerivedPlugin', dependencies: ['edfi', 'ceds'] }]));
harness.ok('loadRecipe keeps the file\'s own text as recipeText (the recipeHash is of the text)', recipeLib.loadRecipe(newFormRecipePath, { forgesDirPath: FORGES_DIR_PATH }).recipeText === fs.readFileSync(newFormRecipePath, 'utf8'));
fs.rmSync(scratchDirectoryPath, { recursive: true, force: true });

harness.report();
