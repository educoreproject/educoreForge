#!/usr/bin/env node
'use strict';

// test-recipeLayers.js — a recipe's `layers` (lane DES, campaign cedsRichness-101226, 2026-10-12): the schema admits
// { standard, layer } and nothing else; a layer of a standard the recipe does not forge, and the same layer named twice,
// are refused by name; the CEDS layers recipe validates whole. And the roundTrip attestation (build.js roundTripRowFor) counts
// STANDARDS apart from their layers: a layer row adds its omission line and totals but not to standardCount. Pure.

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: recipe layers (schema and referential refusals)
SYNOPSIS
     ${moduleName} [-verbose] [-help]
EXIT STATUS
     0 all assertions passed;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const path = require('path');
const harness = require('../../../test/testLib/harness')(moduleName);
const recipeLib = require('../lib/recipe')();

const errorsOf = (recipe) => {
	const result = recipeLib.validateRecipe(recipe, { contentValidation: true, availableForges: ['ceds', 'edfi'] });
	return [].concat(...Object.values(result.layers || result).filter((oneLayer) => oneLayer && Array.isArray(oneLayer.errors)).map((oneLayer) => oneLayer.errors));
};
const baseRecipe = { schemaVersion: '1.0.0', recipeName: 'layerGate', kind: 'dev', description: 'the recipe layer gate', standards: [{ token: 'ceds', version: 'current' }], hubs: [{ standard: 'ceds' }], bridges: [] };

harness.section('the CEDS layers recipe validates whole');
const loaded = recipeLib.loadRecipe(path.join(__dirname, '..', '..', '..', 'recipes', 'cedsLayersRoundTrip.recipe.jsonc'));
harness.equal('it loads', loaded.error, undefined);
harness.accepts('it validates (schema, referential, resolvability)', errorsOf(loaded.recipe));

harness.section('refusals, by name');
harness.rejects('a layer of a standard the recipe does not forge', errorsOf({ ...baseRecipe, layers: [{ standard: 'edfi', layer: 'des' }] }), /layers\[0\]\.standard 'edfi' is not in standards\[\]/);
harness.rejects('the same layer named twice', errorsOf({ ...baseRecipe, layers: [{ standard: 'ceds', layer: 'des' }, { standard: 'ceds', layer: 'des' }] }), /duplicate layer 'des' of standard 'ceds'/);
harness.rejects('a layer entry with an unknown field', errorsOf({ ...baseRecipe, layers: [{ standard: 'ceds', layer: 'des', version: '13' }] }), /additional/i);
harness.rejects('a layer key that is not lower-camel', errorsOf({ ...baseRecipe, layers: [{ standard: 'ceds', layer: 'Des' }] }), /pattern/i);

harness.section('the roundTrip attestation counts standards apart from their layers (graph-contract §4 standardCount)');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');
const BUILD_JS_PATH = path.join(__dirname, '..', 'lib', 'build.js');
const cleanRoundTripRow = (token, layerKey) => ({ token, ...(layerKey ? { layerKey } : {}), ran: true, roundTripClean: true, lostTotal: 0, inventedTotal: 0, explicitlyOmittedTotal: 0, explicitOmissionDeclarationText: `${token}: nothing omitted (rule: toy)` });
const layeredRowOf = (build) => build.roundTripRowFor({ stageRan: true, summaryFilePath: '/run/roundTrip/roundTripStageSummary.json', standards: [cleanRoundTripRow('ceds'), cleanRoundTripRow('edfi'), cleanRoundTripRow('ceds:des', 'des')] });
const layeredJudge = (build) => {
	const row = layeredRowOf(build);
	return { pass: row.standardCount === 2 && row.explicitOmissionDeclarationList.length === 3 && /^2 standard\(s\) and 1 standard layer\(s\) ran: clean 3\/3/.test(row.detail), detail: `standardCount ${row.standardCount}, lines ${row.explicitOmissionDeclarationList.length}, detail '${row.detail.slice(0, 60)}'` };
};
const plainRow = require(BUILD_JS_PATH).roundTripRowFor({ stageRan: true, summaryFilePath: '/run/roundTrip/roundTripStageSummary.json', standards: [cleanRoundTripRow('ceds'), cleanRoundTripRow('edfi')] });
const layeredVerdict = layeredJudge(require(BUILD_JS_PATH));
harness.ok('a layered round trip: standardCount 2, three omission lines, the detail names the layer apart', layeredVerdict.pass, layeredVerdict.detail);
harness.ok('a build with no layer writes the text it always wrote', plainRow.standardCount === 2 && /^2 standard\(s\) ran: clean 2\/2/.test(plainRow.detail), plainRow.detail.slice(0, 60));
const countTwinVerdict = layeredJudge(loadBuildJsDouble({ buildJsPath: BUILD_JS_PATH, mutationList: [{ find: 'standardCount: ranStandardCount,', replace: 'standardCount: ranRowList.length,' }] }));
harness.ok("RED-OBSERVED twin 'layersCountedAsStandards' (standardCount: ranRowList.length)", !countTwinVerdict.pass, countTwinVerdict.detail);
harness.report();
