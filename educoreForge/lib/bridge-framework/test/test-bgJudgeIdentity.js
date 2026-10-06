#!/usr/bin/env node
'use strict';

// test-bgJudgeIdentity.js — BG-JUDGEIDENTITY (W-B-6, V1-C11 / V1-S81; campaign P3 2026-10-06): the framework half of "the
// cache key covers everything that changes an answer". The provider half (the Jev identity hashes its category floors and
// every relation description) is test-jevJudgeClient.js; this file holds what the RENDERER and the BLOCK owe.
//
//   BG-JUDGEIDENTITY  (a) rewording CHOICE_QUESTION_ABSTAIN_TEXT moves every promptHash of a variant that builds the split
//                     question (the toy derived plugin); (b) it moves NO promptHash of a text-only variant (the toy
//                     crosswalk plugin), whose hash must stay what it was; (c) opted in under a client that derives its
//                     category from a number, the header carries judgeCategoryFloorByCategory equal to the client's floors;
//                     (d) opted in under a client whose category is the model's own word, the key is ABSENT (never null).
//
// Run: node lib/bridge-framework/test/test-bgJudgeIdentity.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-JUDGEIDENTITY: promptHash preimage and the category floors in the block header

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, succeeded, frameworkMutationTwin, blockOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));

const twinRegistry = makeTwinRegistry();
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const RENDERER_FILE = 'evidenceRenderer.js';
const JUDGE_CONFIG_FILE = 'judgeConfigRecord.js';
const TOY_EMBED_MODEL = 'toy-embed-v1';
const ABSTAIN_TEXT_FIND = "const CHOICE_QUESTION_ABSTAIN_TEXT = 'None of the candidate elements has the same meaning as the source element.';";
const ABSTAIN_TEXT_REWORDED = "const CHOICE_QUESTION_ABSTAIN_TEXT = 'No candidate element means what the source element means.';";
const PREIMAGE_FIND = '[variantRow.rendererVersion, systemPrompt, userPrompt].concat(variantRow.subjectData && variantRow.candidateData ? [CHOICE_QUESTION_INSTRUCTION_TEXT, CHOICE_QUESTION_ABSTAIN_TEXT] : []);';
const FLOOR_BY_CATEGORY = Object.freeze({ strong: 0.8, moderate: 0.5 });

const derivedShape = (scenario) => {
	scenario.spec.bridge = DERIVED_PLUGIN_NAME;
	scenario.graph.nodeList = scenario.graph.nodeList.map((oneNode) =>
		oneNode.properties.embedding === undefined ? oneNode : { ...oneNode, properties: { ...oneNode.properties, embeddingModelVersion: TOY_EMBED_MODEL } },
	);
};
const optInShape = (scenario) => {
	derivedShape(scenario);
	const bridgeDeclaration = scenarioLib.cloneJson(require(path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', `${DERIVED_PLUGIN_NAME}.js`)).bridgeDeclaration);
	bridgeDeclaration.blockRecordsJudgeConfig = true;
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = { ...(scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] || {}), bridgeDeclaration };
};
// a real-client double whose judgeConfig carries floors, as Jev's does (the category is derived from a number)
const flooredClient = () => {
	const client = scenarioLib.makeFakeRealClient({});
	client.judgeConfig = Object.freeze({ temperaturePolicy: 'fakeNoWire', maxTokens: null, categoryFloorByCategory: FLOOR_BY_CATEGORY });
	return client;
};
const promptHashListOf = (outcome) => (blockOf(outcome) || { decisionRecordList: [] }).decisionRecordList.filter((oneRecord) => oneRecord.judge !== undefined).map((oneRecord) => oneRecord.judge.promptHash);
const refusalOf = (outcome) => outcome.constructionError || outcome.runError || outcome.thrownFromRun || '';

// runPair — the scenario as handed (with any twin's mutations), once as is and once with the abstain text reworded
const runPair = (scenario, shape, callback) => {
	const baseScenario = scenarioLib.cloneScenario(scenario);
	shape(baseScenario);
	scenarioLib.runScenario(baseScenario, (unusedBaseError, baseOutcome) => {
		const rewordedScenario = scenarioLib.cloneScenario(scenario);
		shape(rewordedScenario);
		rewordedScenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RENDERER_FILE), find: ABSTAIN_TEXT_FIND, replace: ABSTAIN_TEXT_REWORDED });
		scenarioLib.runScenario(rewordedScenario, (unusedRewordedError, rewordedOutcome) => callback(baseOutcome, rewordedOutcome));
	});
};
const pairConjunct = ({ conjunctId, title, twinNameList, shape, expectMoved }) => ({
	conjunctId,
	title,
	twinNameList,
	evaluate: (scenario, callback) => {
		runPair(scenario, shape, (baseOutcome, rewordedOutcome) => {
			const refusalText = refusalOf(baseOutcome) || refusalOf(rewordedOutcome);
			if (refusalText) {
				callback('', { pass: false, detail: `expected success but got: ${refusalText.slice(0, 300)}` });
				return;
			}
			const baseList = promptHashListOf(baseOutcome);
			const rewordedList = promptHashListOf(rewordedOutcome);
			const movedCount = baseList.filter((oneHash, oneIndex) => oneHash !== rewordedList[oneIndex]).length;
			const pass = baseList.length > 0 && baseList.length === rewordedList.length && (expectMoved ? movedCount === baseList.length : movedCount === 0);
			callback('', { pass, detail: `${baseList.length} judged record(s); ${movedCount} promptHash(es) moved when the abstain text was reworded (expected ${expectMoved ? 'all' : 'none'})` });
		});
	},
});

const conjunctList = [
	pairConjunct({
		conjunctId: 'a_abstainTextMovesSplitQuestionPromptHash',
		title: 'rewording CHOICE_QUESTION_ABSTAIN_TEXT moves every promptHash of a variant that builds the split question',
		twinNameList: ['preimageWithoutChoiceTexts'],
		shape: derivedShape,
		expectMoved: true,
	}),
	pairConjunct({
		conjunctId: 'b_abstainTextLeavesTextOnlyPromptHash',
		title: 'rewording it moves NO promptHash of a text-only variant (the crosswalk plugin), whose hash stays what it was',
		twinNameList: ['preimageAlwaysCarriesChoiceTexts'],
		shape: () => {},
		expectMoved: false,
	}),
	runConjunct({
		conjunctId: 'c_floorsInHeaderUnderAFlooredClient',
		title: 'opted in under a client that derives its category from a number, the header carries judgeCategoryFloorByCategory = its floors',
		twinNameList: ['floorsNotCarriedToHeader'],
		shape: (scenario) => { optInShape(scenario); scenario.judgeClientOverride = flooredClient(); },
		judge: succeeded((runReport, outcome) => {
			const header = blockOf(outcome).header;
			return { pass: scenarioLib.cloneJson(header.judgeCategoryFloorByCategory || {}).strong === FLOOR_BY_CATEGORY.strong && (header.judgeCategoryFloorByCategory || {}).moderate === FLOOR_BY_CATEGORY.moderate && Object.keys(header.judgeCategoryFloorByCategory || {}).length === 2, detail: `header.judgeCategoryFloorByCategory = ${JSON.stringify(header.judgeCategoryFloorByCategory)}` };
		}),
	}),
	runConjunct({
		conjunctId: 'd_floorsAbsentUnderAWordCategoryClient',
		title: 'opted in under a client whose category is the model\'s own word (no floors), the key is ABSENT, never frozen as null',
		twinNameList: ['floorsFrozenAsNull'],
		shape: optInShape,
		judge: succeeded((runReport, outcome) => {
			const header = blockOf(outcome).header;
			const present = Object.prototype.hasOwnProperty.call(header, 'judgeCategoryFloorByCategory');
			return { pass: !present && header.judgeTemperaturePolicy === 'noWire', detail: `judgeCategoryFloorByCategory ${present ? `PRESENT (${JSON.stringify(header.judgeCategoryFloorByCategory)})` : 'absent'}; judgeTemperaturePolicy ${header.judgeTemperaturePolicy}` };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEIDENTITY', conjunctId: 'a_abstainTextMovesSplitQuestionPromptHash', twinName: 'preimageWithoutChoiceTexts', fileName: RENDERER_FILE, find: PREIMAGE_FIND, replace: '[variantRow.rendererVersion, systemPrompt, userPrompt];' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEIDENTITY', conjunctId: 'b_abstainTextLeavesTextOnlyPromptHash', twinName: 'preimageAlwaysCarriesChoiceTexts', fileName: RENDERER_FILE, find: PREIMAGE_FIND, replace: '[variantRow.rendererVersion, systemPrompt, userPrompt].concat([CHOICE_QUESTION_INSTRUCTION_TEXT, CHOICE_QUESTION_ABSTAIN_TEXT]);' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEIDENTITY', conjunctId: 'c_floorsInHeaderUnderAFlooredClient', twinName: 'floorsNotCarriedToHeader', fileName: JUDGE_CONFIG_FILE, find: '	...(judgeClient.judgeConfig.categoryFloorByCategory === undefined ? {} : { judgeCategoryFloorByCategory: judgeClient.judgeConfig.categoryFloorByCategory }),\n', replace: '' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-JUDGEIDENTITY', conjunctId: 'd_floorsAbsentUnderAWordCategoryClient', twinName: 'floorsFrozenAsNull', fileName: JUDGE_CONFIG_FILE, find: '	...(judgeClient.judgeConfig.categoryFloorByCategory === undefined ? {} : { judgeCategoryFloorByCategory: judgeClient.judgeConfig.categoryFloorByCategory }),\n', replace: '	judgeCategoryFloorByCategory: judgeClient.judgeConfig.categoryFloorByCategory === undefined ? null : judgeClient.judgeConfig.categoryFloorByCategory,\n' });

const gateDeclarationList = [{ gateId: 'BG-JUDGEIDENTITY', title: 'the promptHash preimage carries the choice-question texts; the block names the floors its bands came from', conjunctList }];

runGateFamily(
	{ harness, familyName: 'BG-JUDGEIDENTITY', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 4 },
	() => harness.report(),
);
