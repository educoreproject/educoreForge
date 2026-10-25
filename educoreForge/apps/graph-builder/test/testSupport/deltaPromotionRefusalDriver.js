#!/usr/bin/env node
'use strict';

// deltaPromotionRefusalDriver.js — ONE graphBuilder action for test-deltaPromotionRefusal.js, run as its own process so the action reads
// its own command line exactly as graphBuilder does. --actionName names the action (goldEvalCheck | stampPromotion); --twinName, when
// given, loads actions.js with that twin's ONE named mutation (TWIN_MUTATION_BY_NAME, the gate's red twins). Prints one JSON line
// { actionError }.
//
// Run (by the gate only): node deltaPromotionRefusalDriver.js --actionName=<name> [--twinName=<name>] <the action's own flags>

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: `${moduleName} --actionName=goldEvalCheck|stampPromotion [--twinName=<name>]` });
const { commandLineParameters } = process.global;
const path = require('path');
const { loadBuildJsDouble } = require('../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const ACTIONS_PATH = path.join(__dirname, '..', '..', 'lib', 'actions.js');
const TWIN_MUTATION_BY_NAME = {
	goldEvalCheckUnguarded: { find: "const deltaRefusal = unfoldedDeltaRefusal({ databaseFilePath: firstValue(process.global.commandLineParameters, 'standardsDatabaseFilePath'), actionName: '-goldEvalCheck' });", replace: "const deltaRefusal = '';" },
	stampPromotionUnguarded: { find: "const promotionDeltaRefusal = certifiedStoreFilePathList.map((databaseFilePath) => unfoldedDeltaRefusal({ databaseFilePath, actionName: '-stampPromotion' })).find(Boolean);", replace: 'const promotionDeltaRefusal = undefined;' },
};
const valueOf = (valueName) => {
	const rawValue = commandLineParameters.values[valueName];
	return Array.isArray(rawValue) ? rawValue[0] : rawValue;
};
const twinName = valueOf('twinName');
// actions.js exports its factory, as graphBuilder.js invokes it
const actions = (twinName === undefined ? require(ACTIONS_PATH) : loadBuildJsDouble({ buildJsPath: ACTIONS_PATH, mutationList: [TWIN_MUTATION_BY_NAME[twinName]] }))();
actions[valueOf('actionName')]((actionError) => {
	process.stdout.write(`${JSON.stringify({ actionError: actionError || '' })}\n`);
	process.exit(0);
});
