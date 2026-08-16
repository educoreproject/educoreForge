#!/usr/bin/env node
'use strict';

// test-bgProducer.js — BG-PRODUCER (RULING A1, BF18) + BG-GEN (BR-071) + BG-DEBUG (RULING R5): what the run REPORTS
// about itself and what the block header carries.
//   BG-PRODUCER (a) runReport.producer === 'authored' on EVERY run — materialise with and without a block, re-judge;
//   (b) vocabulary.relationshipSubject composed by build.js's own inference logic ends in _exact for a crosswalk
//   block carrying a NON-NULL decisionBlock (the trap defused by naming); (c) producerKind in the frozen header
//   EQUALS runReport.producer; (d) every PRODUCER_KIND_LIST entry has a NON-EMPTY suffix in RELATIONSHIP_PRODUCER_SUFFIX,
//   asserted at framework construction (a vocabulary double with authored: '' → construction refused).
//   BG-GEN: the frozen text contains EACH header member (one conjunct each; strip → refused at freeze); a debug
//   block's mark appears on EVERY edge it produces, and materialise reads it back on plain replay.
//   BG-DEBUG (a) generation ends -INVALID_DEBUG and judgeKind is debug:<rule>; (b) EVERY edge of a debug block carries
//   provenanceTier invalid-debug (specified included) and every judged edge mappingTool = the debug model id — on
//   the plain replay too; (c) the goldEvalCheck bridge sibling's rule (certificationCheck) REFUSES a harvested block
//   with an invalid-debug edge naming it; (d) --useDebugJudge without --rebridge refused, two judges refused —
//   RE-OBSERVED red in THIS suite through build.js's resolveInferenceConfig under an in-memory build.js double;
//   (e) forensic record usage null, decisionAlgorithm INVALID_DEBUG; (f) the suite's default rule is digest and
//   abstain runs once (here).
//
// Run: node lib/bridge-framework/test/test-bgProducer.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-PRODUCER + BG-GEN + BG-DEBUG: the explicit producer, the header, the debug marks

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, twiceConjunct, pureConjunct, succeeded, frameworkMutationTwin, scenarioTwin, edgesOf, blockOf, forensicsOf, loadBuildJsDouble } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const vocabularyLib = require(path.join(__dirname, '..', '..', 'vocabulary', 'vocabulary'));
const { HEADER_KEY_ORDER } = require('../decisionBlock');
const { debugEdgeRefusal } = require('../certificationCheck');

const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'bridge-framework.js';
const MATERIALISER_FILE = 'materialiser.js';
const DECISION_BLOCK_FILE = 'decisionBlock.js';
const CERTIFICATION_FILE = 'certificationCheck.js';
const VOCABULARY_PATH = path.join(scenarioLib.FRAMEWORK_DIR, '..', 'vocabulary', 'vocabulary.js');
const BUILD_JS_PATH = path.join(scenarioLib.FRAMEWORK_DIR, '..', '..', 'apps', 'graph-builder', 'lib', 'build.js');
const DEBUG_MODEL_ID = 'debugJudge-digest-v1-INVALID_DEBUG';

// build.js's OWN producer inference, reproduced verbatim (build.js bridgeOnePairing) — the consumer of the runReport
const buildJsProducerFor = (oneBlock) => (oneBlock && vocabularyLib.suffixForRelationshipProducer(oneBlock.producer) ? oneBlock.producer : oneBlock && oneBlock.decisionBlock != null ? 'inferred' : 'authored');
const composedSubjectFor = (runReport) => {
	const oneBlock = runReport.blocks[0];
	return vocabularyLib.relationshipSubject({ hubStandard: oneBlock.firstStandard, hubVersion: '1.0', sourceStandard: oneBlock.secondStandard, sourceVersion: '1.2.3', producer: buildJsProducerFor(oneBlock) });
};

// ---------------------------------------------------------------------
// BG-PRODUCER
// ---------------------------------------------------------------------
const producerConjunctList = [
	twiceConjunct({
		conjunctId: 'a_producerAlwaysAuthored',
		title: "runReport.producer === 'authored' on the re-judge AND on the plain materialise (never absent, never inferred)",
		twinNameList: ['omitProducerFromReport'],
		judge: (outcome) => {
			const both = [outcome.first, outcome.second].filter(Boolean);
			const bad = both.find((oneOutcome) => oneOutcome.runError || !oneOutcome.runReport || oneOutcome.runReport.producer !== 'authored' || oneOutcome.runReport.blocks[0].producer !== 'authored');
			return { pass: both.length === 2 && bad === undefined, detail: both.map((oneOutcome) => (oneOutcome.runReport ? `${oneOutcome.runReport.mode}:${oneOutcome.runReport.producer}/${oneOutcome.runReport.blocks[0].producer}` : String(oneOutcome.runError).slice(0, 80))).join('; ') };
		},
	}),
	runConjunct({
		conjunctId: 'a_producerAuthoredWithNoBlock',
		title: "materialise with NO block still reports producer 'authored' (never inferred from decisionBlock null)",
		twinNameList: ['omitProducerFromReport'],
		shape: (scenario) => { scenario.spec.rebridge = false; },
		judge: succeeded((runReport) => ({ pass: runReport.producer === 'authored' && runReport.decisionBlock === null && runReport.blocks[0].producer === 'authored', detail: `${runReport.producer} / ${JSON.stringify(runReport.decisionBlock)}` })),
	}),
	runConjunct({
		conjunctId: 'b_buildJsComposesExactForCrosswalkBlock',
		title: "build.js's own inference over the runReport composes a subject ending in _exact for a crosswalk block carrying a NON-NULL decisionBlock (the trap defused by naming)",
		twinNameList: ['omitProducerFromReport'],
		judge: succeeded((runReport) => {
			const composed = composedSubjectFor(runReport);
			return { pass: !composed.error && /_exact$/.test(composed.subject) && runReport.blocks[0].decisionBlock !== null, detail: composed.error || composed.subject };
		}),
	}),
	runConjunct({
		conjunctId: 'c_headerProducerKindEqualsReport',
		title: 'producerKind in the frozen header EQUALS runReport.producer',
		twinNameList: ['headerProducerKindInferred'],
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			return { pass: block !== null && block.header.producerKind === runReport.producer, detail: `header ${block && block.header.producerKind} vs report ${runReport.producer}` };
		}),
	}),
	pureConjunct({
		conjunctId: 'd_everyProducerKindHasNonEmptySuffix',
		title: "every PRODUCER_KIND_LIST entry has a NON-EMPTY suffix in RELATIONSHIP_PRODUCER_SUFFIX — asserted at framework construction (build.js guards on the suffix's TRUTHINESS)",
		twinNameList: ['vocabularyDoubleWithEmptyAuthoredSuffix'],
		judge: (scenario) => {
			// construct the framework (through the double if the scenario mutates the vocabulary) and see it refuse
			let constructionRefusal = '';
			try {
				scenarioLib.loadFrameworkFactory(scenario)({ graphReaderFactory: () => ({}), graphWriterFactory: () => ({}), pluginRegistry: { entryByBridgeName: {} } });
			} catch (constructionThrow) {
				constructionRefusal = constructionThrow.message;
			}
			return { pass: constructionRefusal === '' && vocabularyLib.RELATIONSHIP_PRODUCER_SUFFIX.authored.length > 0, detail: constructionRefusal || `authored → '${vocabularyLib.RELATIONSHIP_PRODUCER_SUFFIX.authored}'` };
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PRODUCER', conjunctId: 'a_producerAlwaysAuthored', twinName: 'omitProducerFromReport', fileName: FRAMEWORK_FILE, find: "\t\t\t\tproducer: bridgeDeclaration.producerKind, // ALWAYS explicit (RULING A1)\n\t\t\t\tdecisionBlock: decisionBlockHash === null ? null : { decisionBlockHash, pairKey },\n\t\t\t\tblocks: [{ applyLabel: pairScopedLabel, firstStandard: hubToken, secondStandard: sourceToken, producer: bridgeDeclaration.producerKind, decisionBlock: blocksDecisionBlock }],", replace: "\t\t\t\tproducer: undefined,\n\t\t\t\tdecisionBlock: decisionBlockHash === null ? null : { decisionBlockHash, pairKey },\n\t\t\t\tblocks: [{ applyLabel: pairScopedLabel, firstStandard: hubToken, secondStandard: sourceToken, producer: undefined, decisionBlock: blocksDecisionBlock }]," });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PRODUCER', conjunctId: 'a_producerAuthoredWithNoBlock', twinName: 'omitProducerFromReport', fileName: FRAMEWORK_FILE, find: "\t\t\t\tproducer: bridgeDeclaration.producerKind, // ALWAYS explicit (RULING A1)\n\t\t\t\tdecisionBlock: decisionBlockHash === null ? null : { decisionBlockHash, pairKey },\n\t\t\t\tblocks: [{ applyLabel: pairScopedLabel, firstStandard: hubToken, secondStandard: sourceToken, producer: bridgeDeclaration.producerKind, decisionBlock: blocksDecisionBlock }],", replace: "\t\t\t\tproducer: undefined,\n\t\t\t\tdecisionBlock: decisionBlockHash === null ? null : { decisionBlockHash, pairKey },\n\t\t\t\tblocks: [{ applyLabel: pairScopedLabel, firstStandard: hubToken, secondStandard: sourceToken, producer: undefined, decisionBlock: blocksDecisionBlock }]," });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PRODUCER', conjunctId: 'b_buildJsComposesExactForCrosswalkBlock', twinName: 'omitProducerFromReport', fileName: FRAMEWORK_FILE, find: "\t\t\t\tproducer: bridgeDeclaration.producerKind, // ALWAYS explicit (RULING A1)\n\t\t\t\tdecisionBlock: decisionBlockHash === null ? null : { decisionBlockHash, pairKey },\n\t\t\t\tblocks: [{ applyLabel: pairScopedLabel, firstStandard: hubToken, secondStandard: sourceToken, producer: bridgeDeclaration.producerKind, decisionBlock: blocksDecisionBlock }],", replace: "\t\t\t\tproducer: undefined,\n\t\t\t\tdecisionBlock: decisionBlockHash === null ? null : { decisionBlockHash, pairKey },\n\t\t\t\tblocks: [{ applyLabel: pairScopedLabel, firstStandard: hubToken, secondStandard: sourceToken, producer: undefined, decisionBlock: blocksDecisionBlock }]," });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PRODUCER', conjunctId: 'c_headerProducerKindEqualsReport', twinName: 'headerProducerKindInferred', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\tproducerKind: bridgeDeclaration.producerKind,\n\t\t\t\t\t\tjudgeKind: args.judgeKind,', replace: "\t\t\t\t\t\tproducerKind: 'inferred',\n\t\t\t\t\t\tjudgeKind: args.judgeKind," });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-PRODUCER', conjunctId: 'd_everyProducerKindHasNonEmptySuffix', twinName: 'vocabularyDoubleWithEmptyAuthoredSuffix', leverKind: 'productionMutation', mutate: (scenario) => {
	// a vocabulary registry double with '' for authored: the framework MUST refuse construction; the mutated
	// framework double under test is compiled with the vocabulary double in its require graph
	moduleDouble.assertMutationApplies({ modulePath: VOCABULARY_PATH, find: "\tauthored: '_exact',\n\tinferred: '_close',", });
	scenario.frameworkMutationList.push({ modulePath: VOCABULARY_PATH, find: "\tauthored: '_exact',\n\tinferred: '_close',", replace: "\tauthored: '',\n\tinferred: '_close'," });
	// AND the framework's own guard removed, so the empty suffix passes construction → the conjunct (which asserts a
	// non-empty suffix through the constructed framework's vocabulary) goes red
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\tconst suffixRefusal = producerSuffixRefusal();\n\t\tif (suffixRefusal) {\n\t\t\tthrow suffixRefusal;\n\t\t}', replace: '' });
} });
// (d) needs its judge to read the suffix THROUGH the constructed framework's own vocabulary; adjust the judge:
producerConjunctList[4].evaluate = (scenario, callback) => {
	let constructionRefusal = '';
	let constructed = null;
	try {
		constructed = scenarioLib.loadFrameworkFactory(scenario)({ graphReaderFactory: () => ({}), graphWriterFactory: () => ({}), pluginRegistry: { entryByBridgeName: {} } });
	} catch (constructionThrow) {
		constructionRefusal = constructionThrow.message;
	}
	// under the twin the vocabulary double says authored: '' and the guard is gone → construction SUCCEEDS with an
	// empty suffix; the conjunct asserts (construction ok) AND (the suffix build.js would read is non-empty)
	const suffixSeen = constructed === null ? null : vocabularyLib.RELATIONSHIP_PRODUCER_SUFFIX.authored;
	if (scenario.frameworkMutationList.some((oneMutation) => oneMutation.modulePath === VOCABULARY_PATH)) {
		// read the suffix from the SAME double the framework was compiled with
		const doubledVocabulary = moduleDouble.loadWithMutations({ modulePath: VOCABULARY_PATH, mutationList: scenario.frameworkMutationList.filter((oneMutation) => oneMutation.modulePath === VOCABULARY_PATH) });
		callback('', { pass: constructionRefusal === '' && doubledVocabulary.RELATIONSHIP_PRODUCER_SUFFIX.authored.length > 0, detail: constructionRefusal || `authored → '${doubledVocabulary.RELATIONSHIP_PRODUCER_SUFFIX.authored}' (construction succeeded with an EMPTY suffix — build.js would fall through)` });
		return;
	}
	callback('', { pass: constructionRefusal === '' && suffixSeen !== null && suffixSeen.length > 0, detail: constructionRefusal || `authored → '${suffixSeen}'` });
};
// and the framework's OWN guard is proven separately: with only the vocabulary double (guard intact) construction REFUSES by name
producerConjunctList.push(
	pureConjunct({
		conjunctId: 'd_constructionRefusesEmptySuffix',
		title: "with a vocabulary double carrying authored: '' the framework REFUSES construction by name",
		twinNameList: ['removeSuffixGuard'],
		judge: (scenario) => {
			const mutationList = [{ modulePath: VOCABULARY_PATH, find: "\tauthored: '_exact',\n\tinferred: '_close',", replace: "\tauthored: '',\n\tinferred: '_close'," }].concat(scenario.frameworkMutationList);
			let constructionRefusal = '';
			try {
				moduleDouble.loadWithMutations({ modulePath: scenarioLib.FRAMEWORK_MODULE_PATH, mutationList })({ graphReaderFactory: () => ({}), graphWriterFactory: () => ({}), pluginRegistry: { entryByBridgeName: {} } });
			} catch (constructionThrow) {
				constructionRefusal = constructionThrow.message;
			}
			return { pass: /has no NON-EMPTY suffix in vocabulary\.RELATIONSHIP_PRODUCER_SUFFIX/.test(constructionRefusal), detail: constructionRefusal || 'construction SUCCEEDED with an empty suffix' };
		},
	}),
);
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-PRODUCER', conjunctId: 'd_constructionRefusesEmptySuffix', twinName: 'removeSuffixGuard', fileName: FRAMEWORK_FILE, find: '\t\tconst suffixRefusal = producerSuffixRefusal();\n\t\tif (suffixRefusal) {\n\t\t\tthrow suffixRefusal;\n\t\t}', replace: '' });

// ---------------------------------------------------------------------
// BG-GEN — one conjunct per header member (strip → refused at freeze) + the debug mark on every edge on replay
// ---------------------------------------------------------------------
const genConjunctList = HEADER_KEY_ORDER.map((oneMember) =>
	runConjunct({
		conjunctId: `header_${oneMember}`,
		title: `the frozen text carries header member '${oneMember}'`,
		twinNameList: [`strip_${oneMember}`],
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			return { pass: block !== null && Object.prototype.hasOwnProperty.call(block.header, oneMember) && block.header[oneMember] !== undefined, detail: block === null ? 'no block' : `${oneMember}: ${JSON.stringify(block.header[oneMember]).slice(0, 80)}` };
		}),
	}),
);
HEADER_KEY_ORDER.forEach((oneMember) => {
	// the twin: a framework double that OMITS the member from the header → frozenTextFor refuses (the run fails) → red
	scenarioTwin({ registry: twinRegistry, gateId: 'BG-GEN', conjunctId: `header_${oneMember}`, twinName: `strip_${oneMember}`, leverKind: 'productionMutation', mutate: (scenario) => {
		scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\t\t\tconst refusalList = report.refusalList.map((oneRefusal) => ({ ...oneRefusal }));\n\t\t\t\t\tconst frozen = decisionBlockLib.frozenTextFor({ header, decisionRecordList, refusalList });', replace: `\t\t\t\t\tconst refusalList = report.refusalList.map((oneRefusal) => ({ ...oneRefusal }));\n\t\t\t\t\tdelete header['${oneMember}'];\n\t\t\t\t\tconst frozen = decisionBlockLib.frozenTextFor({ header, decisionRecordList, refusalList });` });
	} });
});
genConjunctList.push(
	twiceConjunct({
		conjunctId: 'debugMarkOnEveryEdgeOnReplay',
		title: 'a debug block\'s mark (invalid-debug) is on EVERY edge on freeze AND on plain replay (materialise reads it back from the generation)',
		twinNameList: ['skipDebugMarkFromGeneration'],
		judge: (outcome) => {
			const second = outcome.second;
			if (!second || second.runError) {
				return { pass: false, detail: String(second ? second.runError : 'no second run').slice(0, 200) };
			}
			const edgeList = edgesOf(second);
			const unmarked = edgeList.filter((oneEdge) => oneEdge.properties.provenanceTier !== 'invalid-debug');
			return { pass: edgeList.length > 0 && unmarked.length === 0, detail: `${edgeList.length} edges, ${unmarked.length} unmarked on the plain replay` };
		},
	}),
);
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-GEN', conjunctId: 'debugMarkOnEveryEdgeOnReplay', twinName: 'skipDebugMarkFromGeneration', fileName: FRAMEWORK_FILE, find: '\t\t\t\tconst blockDebugMark = debugJudgeLib.debugMarkFromGeneration(block.header.generation);', replace: '\t\t\t\tconst blockDebugMark = undefined;' });

// ---------------------------------------------------------------------
// BG-DEBUG
// ---------------------------------------------------------------------
const debugConjunctList = [
	runConjunct({
		conjunctId: 'a_generationEndsInDebugMarkAndJudgeKind',
		title: "with the debug judge the block's generation ends in -INVALID_DEBUG and judgeKind is 'debug:digest'",
		twinNameList: ['dropGenerationSuffix'],
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			return { pass: /-INVALID_DEBUG$/.test(runReport.generation) && block.header.judgeKind === 'debug:digest' && block.header.generation === runReport.generation, detail: `${runReport.generation} / ${block.header.judgeKind}` };
		}),
	}),
	twiceConjunct({
		conjunctId: 'b_everyEdgeInvalidDebugAndJudgedToolIsDebugModel',
		title: 'EVERY edge of a debug block carries provenanceTier invalid-debug (specified included) and every judged edge mappingTool = the debug model id — on the re-judge AND the plain replay',
		twinNameList: ['specifiedEdgesKeepAuthoredTier'],
		judge: (outcome) => {
			const both = [outcome.first, outcome.second].filter(Boolean);
			if (both.length !== 2 || both.some((oneOutcome) => oneOutcome.runError)) {
				return { pass: false, detail: both.map((oneOutcome) => String(oneOutcome.runError || 'ok').slice(0, 100)).join('; ') };
			}
			const bad = both.reduce((soFar, oneOutcome) => soFar.concat(edgesOf(oneOutcome).filter((oneEdge) => oneEdge.properties.provenanceTier !== 'invalid-debug' || (oneEdge.properties.resolution === 'judged' && oneEdge.properties.mappingTool !== DEBUG_MODEL_ID))), []);
			const specifiedSeen = both.some((oneOutcome) => edgesOf(oneOutcome).some((oneEdge) => oneEdge.properties.resolution === 'specified'));
			return { pass: bad.length === 0 && specifiedSeen, detail: `${bad.length} bad edge(s); specified edges seen ${specifiedSeen}` };
		},
	}),
	runConjunct({
		conjunctId: 'c_certificationCheckRefusesInvalidDebugEdge',
		title: 'the goldEvalCheck bridge sibling rule (certificationCheck.debugEdgeRefusal) REFUSES a harvested block carrying an invalid-debug edge, naming the block',
		twinNameList: ['certificationCheckPassesDebug'],
		judge: succeeded((runReport, outcome, scenario) => {
			const harvest = outcome.graphDouble.harvestByLabel({ applyLabel: 'BridgedRelation_TOY_TOYHUB' });
			const checker = scenario.frameworkMutationList.some((oneMutation) => oneMutation.modulePath.endsWith(CERTIFICATION_FILE)) ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CERTIFICATION_FILE), mutationList: scenario.frameworkMutationList.filter((oneMutation) => oneMutation.modulePath.endsWith(CERTIFICATION_FILE)) }).debugEdgeRefusal : debugEdgeRefusal;
			const refusal = checker({ harvestedEdgeList: harvest.edgeList, blockLabel: 'BridgedRelation_TOY_TOYHUB' });
			return { pass: refusal !== null && /invalid-debug/.test(refusal.message) && /BridgedRelation_TOY_TOYHUB/.test(refusal.message), detail: refusal === null ? 'the checker PASSED a debug block' : refusal.message.slice(0, 200) };
		}),
	}),
	pureConjunct({
		conjunctId: 'd_useDebugJudgeWithoutRebridgeRefused',
		title: "build.js resolveInferenceConfig REFUSES --useDebugJudge without an active --rebridge scope, and two judges — RE-OBSERVED here under an in-memory build.js double",
		twinNameList: ['buildDoubleAdmitsDebugWithoutScope'],
		judge: (scenario) => {
			const buildMutationList = scenario.frameworkMutationList.filter((oneMutation) => oneMutation.modulePath === BUILD_JS_PATH);
			const buildStatics = buildMutationList.length ? loadBuildJsDouble({ buildJsPath: BUILD_JS_PATH, mutationList: buildMutationList }) : require(BUILD_JS_PATH);
			const idle = buildStatics.resolveInferenceConfig({}, [], 'digest');
			const twoJudges = buildStatics.resolveInferenceConfig({ inferenceConfig: { llmClient: { rerank: () => {} } } }, ['toy'], 'digest');
			return { pass: Boolean(idle.error) && /no --rebridge scope is active/.test(idle.error) && Boolean(twoJudges.error) && /Two judges/.test(twoJudges.error), detail: `idle: ${idle.error ? idle.error.slice(0, 80) : 'ADMITTED'}; two judges: ${twoJudges.error ? twoJudges.error.slice(0, 60) : 'ADMITTED'}` };
		},
	}),
	runConjunct({
		conjunctId: 'e_forensicRecordUsageNullDecisionAlgorithm',
		title: 'every debug forensic record carries usage null and decisionAlgorithm INVALID_DEBUG',
		twinNameList: ['forensicUsageZero'],
		judge: succeeded((runReport, outcome) => {
			const recordList = forensicsOf(outcome).filter((oneRecord) => oneRecord.record.promptHash !== undefined);
			const bad = recordList.filter((oneRecord) => oneRecord.record.usage !== null || oneRecord.record.decisionAlgorithm !== 'INVALID_DEBUG');
			return { pass: recordList.length > 0 && bad.length === 0, detail: `${recordList.length} records, ${bad.length} bad` };
		}),
	}),
	runConjunct({
		conjunctId: 'f_defaultRuleDigestAbstainRunsOnce',
		title: "the suite's default rule is 'digest' (varied) and 'abstain' runs once — here: an abstain run yields ZERO judged edges and every judged record abstained",
		twinNameList: ['suiteConfigFirst'],
		shape: (scenario) => { if (scenario.judgeRule === 'digest') { scenario.judgeRule = 'abstain'; } }, // a twin's rule survives the shape
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const judgedRecordList = block.decisionRecordList.filter((oneRecord) => oneRecord.classification === 'judged');
			const picked = judgedRecordList.filter((oneRecord) => oneRecord.objectStableId !== null);
			return { pass: scenarioLib.makeScenario().judgeRule === 'digest' && judgedRecordList.length > 0 && picked.length === 0 && block.header.judgeKind === 'debug:abstain', detail: `default rule ${scenarioLib.makeScenario().judgeRule}; ${judgedRecordList.length} judged, ${picked.length} picked under abstain` };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-DEBUG', conjunctId: 'a_generationEndsInDebugMarkAndJudgeKind', twinName: 'dropGenerationSuffix', fileName: FRAMEWORK_FILE, find: '\t\t\tconst generation = debugJudgeLib.generationWithDebugMark(sourceWindowLib.generationWithWindowMark(baseGeneration, windowMark), debugMark);', replace: '\t\t\tconst generation = sourceWindowLib.generationWithWindowMark(baseGeneration, windowMark);' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-DEBUG', conjunctId: 'b_everyEdgeInvalidDebugAndJudgedToolIsDebugModel', twinName: 'specifiedEdgesKeepAuthoredTier', fileName: MATERIALISER_FILE, find: '\tif (debugMark) {\n\t\treturn PROVENANCE_TIER.INVALID_DEBUG;\n\t}', replace: "\tif (debugMark && producerKind !== 'authored') {\n\t\treturn PROVENANCE_TIER.INVALID_DEBUG;\n\t}" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-DEBUG', conjunctId: 'c_certificationCheckRefusesInvalidDebugEdge', twinName: 'certificationCheckPassesDebug', fileName: CERTIFICATION_FILE, find: '\tif (offenderList.length === 0) {\n\t\treturn null;\n\t}', replace: '\tif (offenderList.length >= 0) {\n\t\treturn null;\n\t}' });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-DEBUG', conjunctId: 'd_useDebugJudgeWithoutRebridgeRefused', twinName: 'buildDoubleAdmitsDebugWithoutScope', leverKind: 'productionMutation', mutate: (scenario) => {
	moduleDouble.assertMutationApplies({ modulePath: BUILD_JS_PATH, find: '\tif (debugJudgeRule && !scopeIsActive) {' });
	scenario.frameworkMutationList.push({ modulePath: BUILD_JS_PATH, find: '\tif (debugJudgeRule && !scopeIsActive) {', replace: '\tif (false && debugJudgeRule && !scopeIsActive) {' });
} });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-DEBUG', conjunctId: 'e_forensicRecordUsageNullDecisionAlgorithm', twinName: 'forensicUsageZero', fileName: 'judgeComponent.js', find: '\t\t\t\t\tusage: usage === undefined ? null : usage,', replace: '\t\t\t\t\tusage: usage === undefined || usage === null ? 0 : usage,' });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-DEBUG', conjunctId: 'f_defaultRuleDigestAbstainRunsOnce', twinName: 'suiteConfigFirst', leverKind: 'productionMutation', mutate: (scenario) => { scenario.judgeRule = 'first'; } });

const gateDeclarationList = [
	{ gateId: 'BG-PRODUCER', title: 'the producer, ALWAYS explicit', conjunctList: producerConjunctList },
	{ gateId: 'BG-GEN', title: 'the block header members and the debug mark on replay', conjunctList: genConjunctList },
	{ gateId: 'BG-DEBUG', title: 'the debug double, flagged everywhere', conjunctList: debugConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-PRODUCER+BG-GEN+BG-DEBUG', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 6 + HEADER_KEY_ORDER.length + 1 + 6, expectedTwinCount: 6 + HEADER_KEY_ORDER.length + 1 + 6 },
	() => harness.report(),
);
