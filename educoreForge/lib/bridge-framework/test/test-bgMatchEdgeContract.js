#!/usr/bin/env node
'use strict';

// test-bgMatchEdgeContract.js — BG-MATCHEDGE (campaign P3, 2026-10-06): the mapping-edge contract after W-B-1 (renames),
// W-B-2 STEP B (the duplicate confidence retired), W-B-3 (G7: the judge's own numbers on the edge) and W-B-4 (V1-C06:
// the judge's recorded text on the edge). The names are written here as LITERALS on purpose: the gate states the contract
// independently of the vocabulary it checks, so it was observable red on the code before the change.
//
//   BG-MATCHEDGE  (a) every written edge (toy crosswalk + toy derived) carries mappingMethod and none of the four retired
//                 names; each judged edge carries judgeIdentity (grammar <provider>:<tail>, resolving to a registered
//                 provider) and rendererVersion; (b) the write seam refuses a retired name BY ITS REPLACEMENT
//                 (mappingJustification → mappingMethod); (c) likewise confidence → mappingConfidence; (d) under a
//                 judge that reports numbers, every judged edge carries judgePickConfidence / judgeTopProbability /
//                 judgeRunnerUpMargin equal to its frozen record's judgeSummary, and under the debug judge none does;
//                 (e) the seam refuses an edge carrying some of the three but not all; (f) opted in
//                 (blockRecordsJudgeConfig), every judged edge carries mappingRationale = its record's judge.rationale,
//                 and opted out none does; (g) the seam refuses mappingRationale on a SPECIFIED edge; (h) every
//                 vocabulary SSSOM column is one the exporter writes.
//
// Run: node lib/bridge-framework/test/test-bgMatchEdgeContract.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-MATCHEDGE: the mapping-edge property contract after the campaign P3 renames

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const { runConjunct, pureConjunct, succeeded, frameworkMutationTwin, edgesOf, blockOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const judgeProviderRegistryLib = require(path.join(__dirname, '..', '..', '..', 'apps', 'graph-builder', 'apps', 'bridge-maker', 'lib', 'judgeProviderRegistry'));

const twinRegistry = makeTwinRegistry();
const MATERIALISER_FILE = 'materialiser.js';
const RULES_FILE = 'graphSeamRules.js';
const EXPORTER_FILE = 'sssomExporter.js';
const DERIVED_PLUGIN_NAME = 'toyDerivedPlugin';
const TOY_EMBED_MODEL = 'toy-embed-v1';
const RETIRED_NAME_LIST = Object.freeze(['mappingJustification', 'mappingTool', 'mappingToolVersion', 'confidence']);
const JUDGE_NUMBER_NAME_LIST = Object.freeze(['judgePickConfidence', 'judgeTopProbability', 'judgeRunnerUpMargin']);
const JUDGE_IDENTITY_GRAMMAR = /^[a-z][A-Za-z0-9]*:[^\s]+$/;

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
	scenario.pluginModuleOverrides[DERIVED_PLUGIN_NAME] = { bridgeDeclaration };
};
// a real-client double that reports numbers the way Jev does: a probability for every offered option, chosen one highest
const numberReportingClient = () => {
	const inner = scenarioLib.makeFakeRealClient({});
	return {
		...inner,
		rerank: (rerankOptions, callback) =>
			inner.rerank(rerankOptions, (rerankError, clientReturn) => {
				if (rerankError) {
					callback(rerankError);
					return;
				}
				const otherOptionList = rerankOptions.choiceEnum.filter((oneOption) => oneOption !== clientReturn.choice);
				const judgeProbabilityByChoice = rerankOptions.choiceEnum.reduce((soFar, oneOption) => ({ ...soFar, [oneOption]: oneOption === clientReturn.choice ? 0.7 : 0.3 / otherOptionList.length }), {});
				const runnerUp = otherOptionList.length ? Math.max(...otherOptionList.map((oneOption) => judgeProbabilityByChoice[oneOption])) : 0;
				callback('', { ...clientReturn, judgeSummary: { judgePickConfidence: 0.75, judgeTopProbability: 0.7, judgeRunnerUpMargin: 0.7 - runnerUp, judgeProbabilityByChoice, judgeRelationConfidence: null, judgeRelationProbabilityByPredicate: null } });
			}),
	};
};
const rulesFor = (scenario) => (scenario.frameworkMutationList.some((oneMutation) => oneMutation.modulePath.endsWith(RULES_FILE)) ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RULES_FILE), mutationList: scenario.frameworkMutationList }) : require('../graphSeamRules'));
// a written judged edge, as the seam would see it, from a real run (the fixture endpoints satisfy every later check)
const seamCallFor = (outcome, mutateProperties) => {
	const judgedEdge = edgesOf(outcome).find((oneEdge) => oneEdge.properties.resolution === 'judged');
	return judgedEdge === undefined ? null : { subjectStableId: judgedEdge.fromStableId, objectStableId: judgedEdge.toStableId, edgeType: judgedEdge.type, edgeProperties: mutateProperties({ ...judgedEdge.properties }), sourceStandardName: 'TOY', subjectEndpoint: { sourceStandardName: 'TOY' }, objectEndpoint: { labels: ['HubReference'], referenceTier: 'property' } };
};
const refusalTextOf = (scenario, seamCall) => {
	const refusal = seamCall === null ? null : rulesFor(scenario).mappingEdgeRefusal(seamCall);
	return refusal ? refusal.message : '';
};

const conjunctList = [
	runConjunct({
		conjunctId: 'a_writtenEdgesCarryTheRenamedSet',
		title: 'every written edge carries mappingMethod and none of the four retired names; judged edges carry judgeIdentity (grammar, registered) and rendererVersion',
		twinNameList: ['materialiserWritesOldToolName'],
		shape: (scenario) => { scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({}); },
		judge: succeeded((runReport, outcome) => {
			const faultList = [];
			edgesOf(outcome).forEach((oneEdge) => {
				const retiredPresent = RETIRED_NAME_LIST.filter((oneName) => Object.prototype.hasOwnProperty.call(oneEdge.properties, oneName));
				if (retiredPresent.length || typeof oneEdge.properties.mappingMethod !== 'string') {
					faultList.push(`${oneEdge.fromStableId}: retired [${retiredPresent.join(', ')}], mappingMethod ${JSON.stringify(oneEdge.properties.mappingMethod)}`);
				}
				if (oneEdge.properties.resolution === 'judged') {
					const owner = judgeProviderRegistryLib.providerNameForJudgeModel(oneEdge.properties.judgeIdentity);
					if (!JUDGE_IDENTITY_GRAMMAR.test(String(oneEdge.properties.judgeIdentity)) || owner.error || typeof oneEdge.properties.rendererVersion !== 'string') {
						faultList.push(`${oneEdge.fromStableId}: judgeIdentity ${JSON.stringify(oneEdge.properties.judgeIdentity)}, rendererVersion ${JSON.stringify(oneEdge.properties.rendererVersion)}`);
					}
				}
			});
			return { pass: edgesOf(outcome).length > 0 && faultList.length === 0, detail: `${edgesOf(outcome).length} edge(s); ${faultList.length} fault(s)${faultList.length ? `: ${faultList[0]}` : ''}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_retiredJustificationRefusedNamingMethod',
		title: "the write seam refuses an edge carrying mappingJustification, naming its replacement mappingMethod",
		twinNameList: ['retiredRowsNotDerived'],
		shape: (scenario) => { scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({}); },
		judge: succeeded((runReport, outcome, scenario) => {
			const refusalText = refusalTextOf(scenario, seamCallFor(outcome, (properties) => ({ ...properties, mappingJustification: 'semapv:CompositeMatching' })));
			return { pass: /mappingJustification is RETIRED[\s\S]*the property is mappingMethod/.test(refusalText), detail: refusalText ? refusalText.slice(0, 220) : 'NOT refused' };
		}),
	}),
	runConjunct({
		conjunctId: 'c_retiredConfidenceRefusedNamingMappingConfidence',
		title: 'the write seam refuses an edge carrying confidence, naming its replacement mappingConfidence',
		twinNameList: ['confidenceRowDropped'],
		shape: (scenario) => { scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({}); },
		judge: succeeded((runReport, outcome, scenario) => {
			const refusalText = refusalTextOf(scenario, seamCallFor(outcome, (properties) => ({ ...properties, confidence: 0.7 })));
			return { pass: /confidence is RETIRED[\s\S]*the property is mappingConfidence/.test(refusalText), detail: refusalText ? refusalText.slice(0, 220) : 'NOT refused' };
		}),
	}),
	runConjunct({
		conjunctId: 'd_judgeNumbersOnEdgesFromTheFrozenSummary',
		title: "under a judge that reports numbers, every judged edge carries the three judge numbers equal to its frozen record's judgeSummary",
		twinNameList: ['marginNotWritten'],
		shape: (scenario) => { derivedShape(scenario); scenario.judgeClientOverride = numberReportingClient(); },
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const summaryBySubject = block.decisionRecordList.filter((oneRecord) => oneRecord.judge && oneRecord.judge.judgeSummary && oneRecord.objectStableId).reduce((soFar, oneRecord) => ({ ...soFar, [oneRecord.subjectStableId]: oneRecord.judge.judgeSummary }), {});
			const judgedEdgeList = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.resolution === 'judged');
			const badList = judgedEdgeList.filter((oneEdge) => {
				const summary = summaryBySubject[oneEdge.properties.judgedSubjectStableId || oneEdge.fromStableId];
				return summary === undefined || JUDGE_NUMBER_NAME_LIST.some((oneName) => oneEdge.properties[oneName] !== summary[oneName]);
			});
			return { pass: judgedEdgeList.length > 0 && badList.length === 0, detail: `${judgedEdgeList.length} judged edge(s), ${badList.length} not carrying their record's numbers` };
		}),
	}),
	runConjunct({
		conjunctId: 'dPrime_noJudgeNumbersUnderTheDebugJudge',
		title: 'under the debug judge (which reports no numbers) no edge carries any of the three',
		twinNameList: ['numbersAlwaysWritten'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const carrying = edgesOf(outcome).filter((oneEdge) => JUDGE_NUMBER_NAME_LIST.some((oneName) => Object.prototype.hasOwnProperty.call(oneEdge.properties, oneName))).length;
			return { pass: edgesOf(outcome).length > 0 && carrying === 0, detail: `${edgesOf(outcome).length} edge(s), ${carrying} carrying a judge number` };
		}),
	}),
	runConjunct({
		conjunctId: 'e_partialJudgeNumbersRefused',
		title: 'the write seam refuses a judged edge carrying judgeTopProbability but not the other two',
		twinNameList: ['togetherCheckRemoved'],
		shape: (scenario) => { scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({}); },
		judge: succeeded((runReport, outcome, scenario) => {
			const refusalText = refusalTextOf(scenario, seamCallFor(outcome, (properties) => ({ ...properties, judgeTopProbability: 0.7 })));
			return { pass: /carries judgeTopProbability but not judgePickConfidence, judgeRunnerUpMargin/.test(refusalText), detail: refusalText ? refusalText.slice(0, 220) : 'NOT refused' };
		}),
	}),
	runConjunct({
		conjunctId: 'f_rationaleOnEdgesWhenOptedIn',
		title: "opted in (blockRecordsJudgeConfig), every judged edge carries mappingRationale = its record's judge.rationale",
		twinNameList: ['rationaleNotWritten'],
		shape: optInShape,
		judge: succeeded((runReport, outcome) => {
			const rationaleBySubject = blockOf(outcome).decisionRecordList.filter((oneRecord) => oneRecord.judge && oneRecord.objectStableId).reduce((soFar, oneRecord) => ({ ...soFar, [oneRecord.subjectStableId]: oneRecord.judge.rationale }), {});
			const judgedEdgeList = edgesOf(outcome).filter((oneEdge) => oneEdge.properties.resolution === 'judged');
			const badList = judgedEdgeList.filter((oneEdge) => typeof oneEdge.properties.mappingRationale !== 'string' || oneEdge.properties.mappingRationale !== rationaleBySubject[oneEdge.fromStableId]);
			return { pass: judgedEdgeList.length > 0 && badList.length === 0, detail: `${judgedEdgeList.length} judged edge(s), ${badList.length} without their record's rationale` };
		}),
	}),
	runConjunct({
		conjunctId: 'fPrime_noRationaleWhenOptedOut',
		title: 'opted out, no edge carries mappingRationale',
		twinNameList: ['rationaleAlwaysWritten'],
		shape: derivedShape,
		judge: succeeded((runReport, outcome) => {
			const carrying = edgesOf(outcome).filter((oneEdge) => Object.prototype.hasOwnProperty.call(oneEdge.properties, 'mappingRationale')).length;
			return { pass: edgesOf(outcome).length > 0 && carrying === 0, detail: `${edgesOf(outcome).length} edge(s), ${carrying} carrying mappingRationale` };
		}),
	}),
	runConjunct({
		conjunctId: 'g_rationaleOnSpecifiedRefused',
		title: 'the write seam refuses mappingRationale on a SPECIFIED edge',
		twinNameList: ['specifiedCheckSkipsOptionals'],
		judge: succeeded((runReport, outcome, scenario) => {
			const specifiedEdge = edgesOf(outcome).find((oneEdge) => oneEdge.properties.resolution === 'specified');
			const refusalText = specifiedEdge === undefined ? '' : (rulesFor(scenario).mappingEdgeRefusal({ subjectStableId: specifiedEdge.fromStableId, objectStableId: specifiedEdge.toStableId, edgeType: specifiedEdge.type, edgeProperties: { ...specifiedEdge.properties, mappingRationale: 'a reason' }, sourceStandardName: 'TOY', subjectEndpoint: { sourceStandardName: 'TOY' }, objectEndpoint: { labels: ['HubReference'], referenceTier: 'property' } }) || {}).message || '';
			return { pass: /a specified edge carries 'mappingRationale'/.test(refusalText), detail: refusalText ? refusalText.slice(0, 220) : `NOT refused (specified edge found: ${specifiedEdge !== undefined})` };
		}),
	}),
	pureConjunct({
		conjunctId: 'h_everyVocabularyColumnIsWritten',
		title: 'the SSSOM exporter loads, so every column vocabulary.SSSOM_COLUMN_BY_EDGE_PROPERTY names is one it writes (asserted at its load)',
		twinNameList: ['exporterDropsMappingTool'],
		judge: (scenario) => {
			const exporterPath = path.join(scenarioLib.FRAMEWORK_DIR, EXPORTER_FILE);
			let loadRefusal = '';
			try {
				if (scenario.frameworkMutationList.some((oneMutation) => oneMutation.modulePath === exporterPath)) {
					moduleDouble.loadWithMutations({ modulePath: exporterPath, mutationList: scenario.frameworkMutationList });
				} else {
					require('../sssomExporter');
				}
			} catch (loadError) {
				loadRefusal = loadError.message;
			}
			return { pass: loadRefusal === '', detail: loadRefusal ? loadRefusal.slice(0, 220) : 'loads; every vocabulary column is written' };
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATCHEDGE', conjunctId: 'a_writtenEdgesCarryTheRenamedSet', twinName: 'materialiserWritesOldToolName', fileName: MATERIALISER_FILE, find: '		edgeProperties[MAPPING_PROPERTIES.JUDGE_IDENTITY] = record.judge.judgeModel;', replace: '		edgeProperties.mappingTool = record.judge.judgeModel;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATCHEDGE', conjunctId: 'b_retiredJustificationRefusedNamingMethod', twinName: 'retiredRowsNotDerived', fileName: RULES_FILE, find: '	...Object.keys(MAPPING_PROPERTY_REPLACEMENT_BY_RETIRED_NAME).reduce(', replace: '	...[].reduce(' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATCHEDGE', conjunctId: 'c_retiredConfidenceRefusedNamingMappingConfidence', twinName: 'confidenceRowDropped', fileName: RULES_FILE, find: '	...Object.keys(MAPPING_PROPERTY_REPLACEMENT_BY_RETIRED_NAME).reduce(', replace: "	...Object.keys(MAPPING_PROPERTY_REPLACEMENT_BY_RETIRED_NAME).filter((oneName) => oneName !== 'confidence').reduce(" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATCHEDGE', conjunctId: 'd_judgeNumbersOnEdgesFromTheFrozenSummary', twinName: 'marginNotWritten', fileName: MATERIALISER_FILE, find: '				edgeProperties[oneName] = record.judge.judgeSummary[oneName];', replace: '				edgeProperties[oneName] = oneName === MAPPING_PROPERTIES.JUDGE_RUNNER_UP_MARGIN ? 0 : record.judge.judgeSummary[oneName];' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATCHEDGE', conjunctId: 'dPrime_noJudgeNumbersUnderTheDebugJudge', twinName: 'numbersAlwaysWritten', fileName: MATERIALISER_FILE, find: '		if (record.judge.judgeSummary !== undefined) {', replace: '		if (true) { record.judge.judgeSummary = record.judge.judgeSummary || { judgePickConfidence: 0.5, judgeTopProbability: 0.5, judgeRunnerUpMargin: 0 };' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATCHEDGE', conjunctId: 'e_partialJudgeNumbersRefused', twinName: 'togetherCheckRemoved', fileName: RULES_FILE, find: '		if (summaryPresentList.length !== 0 && summaryPresentList.length !== JUDGE_SUMMARY_EDGE_PROPERTY_LIST.length) {', replace: '		if (false) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATCHEDGE', conjunctId: 'f_rationaleOnEdgesWhenOptedIn', twinName: 'rationaleNotWritten', fileName: MATERIALISER_FILE, find: '			edgeProperties[MAPPING_PROPERTIES.MAPPING_RATIONALE] = record.judge.rationale;', replace: '			edgeProperties[MAPPING_PROPERTIES.MAPPING_RATIONALE] = `${record.judge.rationale} (restated)`;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATCHEDGE', conjunctId: 'fPrime_noRationaleWhenOptedOut', twinName: 'rationaleAlwaysWritten', fileName: MATERIALISER_FILE, find: '		if (record.judge.rationale !== undefined) {', replace: "		if (true) { record.judge.rationale = record.judge.rationale || 'a reason';" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATCHEDGE', conjunctId: 'g_rationaleOnSpecifiedRefused', twinName: 'specifiedCheckSkipsOptionals', fileName: RULES_FILE, find: '		const present = JUDGED_ONLY_PROPERTY_LIST.concat(JUDGED_OPTIONAL_PROPERTY_LIST).find(', replace: '		const present = JUDGED_ONLY_PROPERTY_LIST.find(' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MATCHEDGE', conjunctId: 'h_everyVocabularyColumnIsWritten', twinName: 'exporterDropsMappingTool', fileName: EXPORTER_FILE, find: "	'mapping_tool',\n", replace: '' });

const gateDeclarationList = [{ gateId: 'BG-MATCHEDGE', title: 'the mapping-edge property contract after the campaign P3 renames', conjunctList }];

runGateFamily(
	{ harness, familyName: 'BG-MATCHEDGE', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 10 },
	() => harness.report(),
);
