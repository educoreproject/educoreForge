#!/usr/bin/env node
'use strict';

// test-recipeSchemaContract.js — gate for W-C-10 (V1-C41, V1-S50/S52-S55; campaign P2; G2): the recipe schema requires
// kind and description and refuses the vestigial keys by name; kind MEANS something (RECIPE_KIND_RULE gates a GOLD_EVAL
// stamp); and the recipe that put a block into a manifest is recorded on the membership row and stamped on RecipeBlock.
//
// PROVES:
//   (a) a recipe without kind, without description, carrying output, or carrying hubs[].candidateFinder is refused
//   (b) every recipe under recipes/ validates structurally (the census), the G2 acceptance recipe goldJevAcceptance2 among
//       them, kind golden
//   (c) promotionKindRefusal: GOLD_EVAL + a dev recipe (goldJevFresh) refused naming the kind; GOLD_EVAL + goldJevAcceptance2
//       allowed; a DEV_ name is not gated
//   (d) the membership row records producedByRecipeName and the recipe finisher stamps it on RecipeBlock
// RED TWINS (in memory): descriptionNotRequired (recipe.js) -> (a); devMayPromote (recipe.js) -> (c);
// producerNotRecorded (standards-database.js) -> (d).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: recipe kind and description required, kind gates promotion, producer per membership
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');
const vocabulary = require('../../../lib/vocabulary/vocabulary');
const contentAddress = require('../../../lib/content-address/content-address')();

const RECIPE_PATH = path.join(__dirname, '..', 'lib', 'recipe.js');
const STORE_PATH = path.join(__dirname, '..', '..', '..', 'lib', 'standards-database', 'standards-database.js');
const RECIPES_DIR = path.join(__dirname, '..', '..', '..', 'recipes');
const recipeLibFor = (mutationList) => (mutationList.length === 0 ? require(RECIPE_PATH) : loadBuildJsDouble({ buildJsPath: RECIPE_PATH, mutationList }))();
const actionsLib = require('../lib/actions');
const actions = typeof actionsLib === 'function' ? actionsLib() : actionsLib;

const BASE_RECIPE = { schemaVersion: '1.0.0', recipeName: 'gateRecipe', kind: 'dev', description: 'a gate recipe', standards: [{ token: 'ceds', version: '14.0.0.0' }] };
const structuralErrorTextOf = (recipeLib, recipe) => (recipeLib.validateRecipe(recipe, {}).errors || []).join(' | ');

const conjunctJudgeByRefId = {
	a_kindDescriptionRequiredDeadKeysRefused: (mutationList, done) => {
		const recipeLib = recipeLibFor(mutationList);
		const { kind, ...noKind } = BASE_RECIPE;
		const { description, ...noDescription } = BASE_RECIPE;
		const textList = [structuralErrorTextOf(recipeLib, noKind), structuralErrorTextOf(recipeLib, noDescription), structuralErrorTextOf(recipeLib, { ...BASE_RECIPE, output: { graphName: 'x' } }), structuralErrorTextOf(recipeLib, { ...BASE_RECIPE, hubs: [{ standard: 'ceds', candidateFinder: 'x' }] })];
		const pass = /required property 'kind'/.test(textList[0]) && /required property 'description'/.test(textList[1]) && /additional propert/.test(textList[2]) && /additional propert/.test(textList[3]) && structuralErrorTextOf(recipeLib, BASE_RECIPE) === '';
		done({ pass, detail: textList.map((oneText) => oneText.slice(0, 60) || 'ACCEPTED').join(' || ') });
	},
	b_everyTreeRecipeValidates: (mutationList, done) => {
		const recipeLib = recipeLibFor(mutationList);
		const recipeFileList = fs.readdirSync(RECIPES_DIR).filter((oneName) => /\.recipe\.jsonc$/.test(oneName));
		const failingList = recipeFileList.filter((oneName) => {
			const loaded = recipeLib.loadRecipe(path.join(RECIPES_DIR, oneName));
			return loaded.error || loaded.loadError || !recipeLib.validateRecipe(loaded.recipe, {}).layers.structural.ok;
		});
		const acceptance = recipeLib.loadRecipe(path.join(RECIPES_DIR, 'goldJevAcceptance2.recipe.jsonc')).recipe || {};
		done({ pass: recipeFileList.length >= 43 && failingList.length === 0 && acceptance.kind === 'golden' && acceptance.recipeName === 'goldJevAcceptance2', detail: `${recipeFileList.length} recipes; failing [${failingList.join(', ')}]; acceptance kind ${acceptance.kind}` });
	},
	c_kindGatesGoldEvalStamp: (mutationList, done) => {
		const recipeLib = recipeLibFor(mutationList);
		const devRefusal = actions.promotionKindRefusal({ containerName: 'GOLD_EVAL_TEST', recipeName: 'goldJevFresh' });
		const goldenRefusal = actions.promotionKindRefusal({ containerName: 'GOLD_EVAL_TEST', recipeName: 'goldJevAcceptance2' });
		const devName = actions.promotionKindRefusal({ containerName: 'DEV_P2R1', recipeName: 'goldJevFresh' });
		const ruleAllowsDev = recipeLib.RECIPE_KIND_RULE.dev.promotionRenameAllowed;
		done({ pass: /recipe 'goldJevFresh' is kind "dev", which does not permit a GOLD_EVAL name/.test(devRefusal) && goldenRefusal === '' && devName === '' && ruleAllowsDev === false, detail: `dev: ${devRefusal.slice(0, 70) || 'allowed'} | golden: ${goldenRefusal || 'allowed'} | DEV_: ${devName || 'not gated'} | rule.dev ${ruleAllowsDev}` });
	},
	d_producerRecordedPerMembership: (mutationList, done) => {
		const storeModule = (mutationList.length === 0 ? require(STORE_PATH) : loadBuildJsDouble({ buildJsPath: STORE_PATH, mutationList }))();
		const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2RecipeProducer-'));
		storeModule.open({ databaseFilePath: path.join(scratchDir, 'producer.sqlite3') }, (openError, standardsDatabase) => {
			const blockText = '{"kind":"header","blockType":"standardBase","standardKey":"TOY","version":"1.0"}\n{"kind":"node","stableId":"urn:toy:1","labels":["StandardBase"]}\n';
			const schemaBlockRefId = contentAddress.blockIdForText(blockText);
			standardsDatabase.saveBlock({ refId: schemaBlockRefId, text: blockText, kind: 'standardBase', subject: 'toy@1.0_base', version: '1.0', producedBy: 'gate' }, (saveBlockError) => {
				standardsDatabase.saveManifest({ name: 'm', description: 'd', recipeName: 'goldJevAcceptance2', recipeHash: 'h', recipeFileName: 'f', members: [{ schemaBlockRefId, position: 0, description: 'gate block' }] }, (saveError, saveReport) => {
					if (openError || saveBlockError || saveError) {
						done({ pass: false, detail: openError || saveBlockError || saveError });
						return;
					}
					const finisher = require('../apps/replay-manager/lib/finishing/lib/manifest-recipe-finisher')({ vocabulary });
					finisher.emit({ storeReader: standardsDatabase, manifestRefId: saveReport.refId }, (emitError, emitted) => {
						const blockNode = ((emitted || {}).nodes || []).find((oneNode) => oneNode.labels.indexOf('RecipeBlock') !== -1);
						fs.rmSync(scratchDir, { recursive: true, force: true });
						done({ pass: !emitError && blockNode && blockNode.properties.producedByRecipeName === 'goldJevAcceptance2', detail: emitError || `RecipeBlock.producedByRecipeName ${blockNode && blockNode.properties.producedByRecipeName}` });
					});
				});
			});
		});
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'a_kindDescriptionRequiredDeadKeysRefused', twinName: 'descriptionNotRequired', find: "	required: ['schemaVersion', 'recipeName', 'kind', 'description', 'standards'],", replace: "	required: ['schemaVersion', 'recipeName', 'kind', 'standards']," },
	{ conjunctRefId: 'c_kindGatesGoldEvalStamp', twinName: 'devMayPromote', find: '	dev: Object.freeze({ promotionRenameAllowed: false }),', replace: '	dev: Object.freeze({ promotionRenameAllowed: true }),' },
	{ conjunctRefId: 'd_producerRecordedPerMembership', twinName: 'producerNotRecorded', find: "${esc(oneMember.description)}, ${recipeName ? esc(recipeName) : 'NULL'});`,", replace: "${esc(oneMember.description)}, NULL);`," },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};
harness.section('BASELINE — the real modules pass every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — each twin OBSERVED RED under a module double (in memory)');
		runSequence(
			TWIN_LIST.map((oneTwin) => (stepDone) =>
				conjunctJudgeByRefId[oneTwin.conjunctRefId]([{ find: oneTwin.find, replace: oneTwin.replace }], (verdict) => {
					harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
					harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
					stepDone();
				})),
			() => harness.report(),
		);
	},
);
