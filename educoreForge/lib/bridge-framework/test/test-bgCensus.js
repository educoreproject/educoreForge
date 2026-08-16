#!/usr/bin/env node
'use strict';

// test-bgCensus.js — BG-CENSUS (RULINGS P12, BF4, BF17) + BG-P3 (Profile 7.3 cardinality) + BG-TENTATIVE (RULING P3) +
// BG-LABEL-RUN (BR-046; RULINGS P4, BF5) + BG-SUBJECT (BR-136/138; RULING P2) + BG-MISMATCH (BR-061/062) + BG-EMPTY
// (BR-094): the classifier and its census, over the toy fixture.
//   BG-CENSUS (a) the frozen block's census (both tables) EQUALS test/acceptance/expectedCensus.toyBridge.toyGraphDouble.json
//   — every member EQUAL, no band (FROZEN from the first observed digest run, RULING 12:05 #4); (b) the FINDING sanity
//   row is Ed-Fi's — B3's data (acceptance file null-and-honest; this suite has no Ed-Fi literal to reproduce); (c) the
//   per-SUBJECT sum invariant; (d) contention RECOMPUTED per run (equals a recount over the double); (e) every subject in
//   EXACTLY ONE per-subject bucket (a mixed subject counts specified ONCE); (f) sourceSideMismatchCount ≤ judgedCount and
//   every mismatch record judged; (g) labelRefusedCount EQUALS the rows under a refused-disposition label.
//   BG-P3 (a) many → judged; (b) zero → orphan with reason; (c) zero emits NO edge; (d) zero and many counted SEPARATELY.
//   BG-TENTATIVE (a) an all-tentative subject is judged even with ONE card; (b) sourceLabel raw + predicateAssertedBy
//   labelTable; (c) an abstention on a tentative subject emits nothing and is counted abstained; (d) a mixed Yes+Maybe
//   subject is judged over the UNION.
//   BG-LABEL-RUN (a) an unknown label on a non-sentinel row refuses the RUN naming label, count and subjects; (b) a blank
//   label counts as unmapped; (c) a refused-disposition row is refused by name and COUNTED without refusing the run; (d) a
//   sentinelOnly label on a sentinel row is lawful; (e) a sentinelOnly label on a REAL-target row refuses the run; (f) a
//   sentinel row carrying a non-sentinelOnly label is counted sentinelLabelledRowCount and never judged.
//   BG-SUBJECT (a) subjectStableIdFor called ONCE with the DISTINCT list; (b) many-to-one reported with assertingSubjectList;
//   (c) a merged leaf with DIFFERENT target sets refused as subjectCollision, all targets named, no edge, counted; (d)
//   same-target merged subjects yield ONE edge per (leaf, target).
//   BG-MISMATCH a supplied tuple field matching no card under a non-empty key pool → sourceSideMismatch recorded with the
//   field and survivors, judged over the KEY pool, never promoted on the key alone.
//   BG-EMPTY an empty assertion set refused; a hub with zero cards refused; never an empty block frozen green.
//
// Run: node lib/bridge-framework/test/test-bgCensus.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-CENSUS + BG-P3 + BG-TENTATIVE + BG-LABEL-RUN + BG-SUBJECT + BG-MISMATCH + BG-EMPTY

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const fs = require('fs');
const scenarioLib = require('./testSupport/toyBridgeScenario');
const { runConjunct, succeeded, nameInRefusal, refusalCase, frameworkMutationTwin, scenarioTwin, edgesOf, blockOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const censusLib = require('../census');
const classificationLib = require('../classification');

const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'bridge-framework.js';
const CENSUS_FILE = 'census.js';
const CLASSIFICATION_FILE = 'classification.js';
const PREDICATE_FILE = 'predicateSource.js';
const GROUPING_FILE = 'subjectGrouping.js';
const CROSSWALK_PLUGIN_PATH = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyCrosswalkPlugin.js');
const EXPECTED_CENSUS = JSON.parse(fs.readFileSync(path.join(__dirname, 'acceptance', 'expectedCensus.toyBridge.toyGraphDouble.json'), 'utf8'));
const cloneJson = scenarioLib.cloneJson;

// scratchCsvRow — the toy crosswalk in a scratch copy with ONE row edited/added/removed (an inputFault on production input)
const withScratchCsv = (scenario, mutateRowList) => {
	const scratchForgesDir = scenarioLib.makeScratchForgesCopy();
	const snapshotDir = path.join(scratchForgesDir, 'toy', 'assets', 'standardSourceData', '01');
	const csvPath = path.join(snapshotDir, 'toyCrosswalk.csv');
	const lineList = fs.readFileSync(csvPath, 'utf8').split('\n');
	const trailingBlank = lineList[lineList.length - 1] === '' ? [''] : [];
	const rowList = lineList.filter((oneLine, oneIndex) => oneIndex > 0 && oneLine !== '');
	const newRowList = mutateRowList(rowList);
	fs.writeFileSync(csvPath, [lineList[0]].concat(newRowList).concat(trailingBlank).join('\n'));
	const sumsPath = path.join(snapshotDir, 'SHA256SUMS');
	fs.writeFileSync(sumsPath, fs.readFileSync(sumsPath, 'utf8').replace(/^[0-9a-f]{64}(  toyCrosswalk\.csv)$/m, `${require('crypto').createHash('sha256').update(fs.readFileSync(csvPath)).digest('hex')}$1`));
	scenario.forgesDirOverride = scratchForgesDir;
};
const overrideDeclaration = (scenario, mutate) => {
	const loaded = require(CROSSWALK_PLUGIN_PATH);
	const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
	mutate(bridgeDeclaration);
	scenario.pluginModuleOverrides.toyCrosswalkPlugin = { bridgeDeclaration };
};
const wrapWalk = (scenario, mutateWalked) => {
	const loaded = require(CROSSWALK_PLUGIN_PATH);
	scenario.pluginModuleOverrides.toyCrosswalkPlugin = { ...(scenario.pluginModuleOverrides.toyCrosswalkPlugin || {}), bridgeHooks: { ...loaded.bridgeHooks, walkSourceAssertions: (hookArgs, callback) => loaded.bridgeHooks.walkSourceAssertions(hookArgs, (walkError, walked) => (walkError ? callback(walkError) : callback('', mutateWalked(walked)))) } };
};
const recordsOf = (outcome) => blockOf(outcome).decisionRecordList;
const recordFor = (outcome, subjectStableId) => recordsOf(outcome).filter((oneRecord) => oneRecord.subjectStableId === subjectStableId);

// ---------------------------------------------------------------------
// BG-CENSUS
// ---------------------------------------------------------------------
const censusConjunctList = [
	runConjunct({
		conjunctId: 'a_censusEqualsFrozenFixture',
		title: "the frozen block's census (both tables) EQUALS the committed expectedCensus fixture — every member EQUAL, no band (the trap: 'no crash')",
		twinNameList: ['dropOneFixtureRow'],
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const expected = EXPECTED_CENSUS.byBridgeName.toyCrosswalkPlugin;
			const equal = JSON.stringify(block.header.cardinalityCensus) === JSON.stringify(expected.cardinalityCensus) && block.header.labelTableDigest === expected.labelTableDigest;
			return { pass: equal, detail: equal ? `EQUAL (${JSON.stringify(block.header.cardinalityCensus.perSubject)})` : `got ${JSON.stringify(block.header.cardinalityCensus.perSubject)} vs expected ${JSON.stringify(expected.cardinalityCensus.perSubject)}` };
		}),
	}),
	runConjunct({
		conjunctId: 'b_sanityRowIsB3Data',
		title: "the FINDING sanity row (Ed-Fi 1,085/58/3 with the named mover) is B3's data — the acceptance file carries it null-and-honest; this suite asserts the census fixture is keyed by graph id + labelTableDigest and names its freezing rule",
		twinNameList: ['fixtureUnkeyed'],
		judge: succeeded((runReport, outcome) => {
			const fixture = outcome.acceptanceFixtureOverride === undefined ? EXPECTED_CENSUS : outcome.acceptanceFixtureOverride;
			return { pass: typeof fixture.graphId === 'string' && /^toyGraphDouble@sha256:/.test(fixture.graphId) && typeof fixture.byBridgeName.toyCrosswalkPlugin.labelTableDigest === 'string' && /FROZEN from the first observed run/.test(fixture.note), detail: `graphId ${fixture.graphId}` };
		}),
	}),
	runConjunct({
		conjunctId: 'c_perSubjectSumInvariant',
		title: 'the per-SUBJECT sum invariant holds: specified + judged + orphan + subjectCollision + sourceGap === subjectCount',
		twinNameList: ['countCollisionAlsoAsOrphan'],
		judge: succeeded((runReport, outcome) => {
			const perSubject = blockOf(outcome).header.cardinalityCensus.perSubject;
			return { pass: censusLib.sumInvariantHolds(perSubject) && perSubject.subjectCount === 16, detail: JSON.stringify(perSubject) };
		}),
	}),
	runConjunct({
		conjunctId: 'd_contentionRecomputedPerRun',
		title: 'contention is RECOMPUTED per run and EQUALS a recount over the double (never a carried constant)',
		twinNameList: ['contentionFromConstant'],
		judge: succeeded((runReport, outcome) => {
			const cardList = outcome.graphDouble.state.nodeList.filter((oneNode) => oneNode.labels.indexOf('HubReference') !== -1 && oneNode.properties.referenceTier === 'property');
			const recount = censusLib.contentionCensus({ cardListByCanonicalKey: classificationLib.makeCardListByCanonicalKey({ cardList: cardList.map((oneNode) => ({ ...oneNode.properties, stableId: oneNode.stableId })) }) });
			const canonical = (value) => JSON.stringify(Object.keys(value).sort().reduce((soFar, oneName) => ({ ...soFar, [oneName]: value[oneName] }), {}));
			return { pass: canonical(recount) === canonical(blockOf(outcome).header.contentionCensus), detail: `${JSON.stringify(blockOf(outcome).header.contentionCensus)} vs recount ${JSON.stringify(recount)}` };
		}),
	}),
	runConjunct({
		conjunctId: 'e_everySubjectInExactlyOneBucket',
		title: 'every subject is in EXACTLY ONE per-subject bucket under precedence — the mixed subject (School.Code: 2 specified targets) counts specified ONCE',
		twinNameList: ['countMixedSubjectTwice'],
		judge: succeeded((runReport, outcome) => {
			const codeRecordList = recordFor(outcome, 'toy:property/School.Code');
			const perSubject = blockOf(outcome).header.cardinalityCensus.perSubject;
			return { pass: codeRecordList.length === 2 && codeRecordList.every((oneRecord) => oneRecord.classification === 'specified') && perSubject.specifiedSubjectCount === 6 && censusLib.sumInvariantHolds(perSubject), detail: `School.Code records ${codeRecordList.length}; specifiedSubjectCount ${perSubject.specifiedSubjectCount}` };
		}),
	}),
	runConjunct({
		conjunctId: 'f_mismatchSubCountReconciles',
		title: 'sourceSideMismatchCount ≤ judgedCount and every mismatch record carries resolution judged',
		twinNameList: ['mismatchStampedSpecified'],
		judge: succeeded((runReport, outcome) => {
			const perTarget = blockOf(outcome).header.cardinalityCensus.perTarget;
			const mismatchRecordList = recordsOf(outcome).filter((oneRecord) => oneRecord.judgedReason === 'sourceSideMismatch');
			return { pass: perTarget.sourceSideMismatchCount === 1 && perTarget.sourceSideMismatchCount <= perTarget.judgedCount && mismatchRecordList.length === 1 && mismatchRecordList.every((oneRecord) => oneRecord.resolution === 'judged' && oneRecord.classification === 'judged'), detail: `mismatch ${perTarget.sourceSideMismatchCount} of judged ${perTarget.judgedCount}; records ${mismatchRecordList.map((oneRecord) => oneRecord.resolution).join(',')}` };
		}),
	}),
	runConjunct({
		conjunctId: 'g_labelRefusedCountEqualsRefusedRows',
		title: 'labelRefusedCount EQUALS the number of rows under a refused-disposition label (the Skip row), and the block\'s refusalList names it',
		twinNameList: ['refusedRowSilentlyDropped'],
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const refusedList = block.refusalList.filter((oneRefusal) => oneRefusal.kind === 'labelRefused');
			return { pass: block.header.cardinalityCensus.perTarget.labelRefusedCount === 1 && refusedList.length === 1 && refusedList[0].sourceLabel === 'Skip', detail: `count ${block.header.cardinalityCensus.perTarget.labelRefusedCount}; refusals ${refusedList.length}` };
		}),
	}),
];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-CENSUS', conjunctId: 'a_censusEqualsFrozenFixture', twinName: 'dropOneFixtureRow', leverKind: 'inputFault', mutate: (scenario) => withScratchCsv(scenario, (rowList) => rowList.filter((oneRow) => !/^Student,Student,Missing,/.test(oneRow))) });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-CENSUS', conjunctId: 'b_sanityRowIsB3Data', twinName: 'fixtureUnkeyed', leverKind: 'productionMutation', mutate: (scenario) => { scenario.acceptanceFixtureOverrideForRun = { ...EXPECTED_CENSUS, graphId: 'unkeyed', byBridgeName: { toyCrosswalkPlugin: { ...EXPECTED_CENSUS.byBridgeName.toyCrosswalkPlugin, labelTableDigest: null } } }; } });
// (b)'s twin hands the fixture override through the outcome: patch the conjunct's evaluate to thread it
censusConjunctList[1].evaluate = ((innerEvaluate) => (scenario, callback) => innerEvaluate(scenario, (unusedError, verdict) => {
	if (scenario.acceptanceFixtureOverrideForRun) {
		const fixture = scenario.acceptanceFixtureOverrideForRun;
		callback('', { pass: typeof fixture.graphId === 'string' && /^toyGraphDouble@sha256:/.test(fixture.graphId) && typeof fixture.byBridgeName.toyCrosswalkPlugin.labelTableDigest === 'string', detail: `graphId ${fixture.graphId}; digest ${fixture.byBridgeName.toyCrosswalkPlugin.labelTableDigest}` });
		return;
	}
	callback('', verdict);
}))(censusConjunctList[1].evaluate);
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CENSUS', conjunctId: 'c_perSubjectSumInvariant', twinName: 'countCollisionAlsoAsOrphan', fileName: CENSUS_FILE, find: '\tperSubject.subjectCount = perSubject.specifiedSubjectCount + perSubject.judgedSubjectCount + perSubject.orphanSubjectCount + perSubject.subjectCollisionCount + perSubject.sourceGapCount;', replace: '\tperSubject.orphanSubjectCount += perSubject.subjectCollisionCount;\n\tperSubject.subjectCount = perSubject.specifiedSubjectCount + perSubject.judgedSubjectCount + perSubject.orphanSubjectCount + perSubject.sourceGapCount;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CENSUS', conjunctId: 'd_contentionRecomputedPerRun', twinName: 'contentionFromConstant', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\tconst contention = censusLib.contentionCensus({ cardListByCanonicalKey, tier: PROPERTY_TIER });', replace: "\t\t\t\t\t\tconst contention = { cardCount: 2777, distinctKeyCount: 2324, contendedKeyCount: 260, worstContention: 13, tier: PROPERTY_TIER };" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CENSUS', conjunctId: 'e_everySubjectInExactlyOneBucket', twinName: 'countMixedSubjectTwice', fileName: CENSUS_FILE, find: '\t\tif (soFar === undefined || thisRank > soFar.rank) {\n\t\t\tbucketBySubjectStableId[oneRecord.subjectStableId] = { rank: thisRank, subjectWeight };\n\t\t}', replace: "\t\tif (soFar === undefined || thisRank > soFar.rank) {\n\t\t\tbucketBySubjectStableId[oneRecord.subjectStableId] = { rank: thisRank, subjectWeight };\n\t\t} else if (thisRank === soFar.rank) {\n\t\t\tbucketBySubjectStableId[oneRecord.subjectStableId] = { rank: thisRank, subjectWeight: soFar.subjectWeight + subjectWeight };\n\t\t}" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CENSUS', conjunctId: 'f_mismatchSubCountReconciles', twinName: 'mismatchStampedSpecified', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\t\t\t\tresolution: 'judged',\n\t\t\t\t\t\t\t\t\tmappingJustification: 'semapv:CompositeMatching',\n\t\t\t\t\t\t\t\t\tsourceSideMismatch:", replace: "\t\t\t\t\t\t\t\t\tresolution: classified.reason === 'sourceSideMismatch' ? 'specified' : 'judged',\n\t\t\t\t\t\t\t\t\tmappingJustification: 'semapv:CompositeMatching',\n\t\t\t\t\t\t\t\t\tsourceSideMismatch:" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CENSUS', conjunctId: 'g_labelRefusedCountEqualsRefusedRows', twinName: 'refusedRowSilentlyDropped', fileName: PREDICATE_FILE, find: "\t\tif (labelRow.disposition === 'refused') {\n\t\t\tlabelRefusedCount += 1;\n\t\t\trefusedRowIndexSet.add(assertionIndex);\n\t\t}", replace: "\t\tif (labelRow.disposition === 'refused') {\n\t\t\trefusedRowIndexSet.add(assertionIndex);\n\t\t}" });

// ---------------------------------------------------------------------
// BG-P3
// ---------------------------------------------------------------------
const p3ConjunctList = [
	runConjunct({
		conjunctId: 'a_manyIsJudged',
		title: "many (Student.Gender: P000002 under two domains, no domain supplied) → judged, never the first card",
		twinNameList: ['firstCardOnMany'],
		judge: succeeded((runReport, outcome) => {
			const recordList = recordFor(outcome, 'toy:property/Student.Gender');
			return { pass: recordList.length === 1 && recordList[0].classification === 'judged' && recordList[0].judgedReason === 'many' && recordList[0].filteredPoolStableIdList.length === 2, detail: JSON.stringify(recordList.map((oneRecord) => [oneRecord.classification, oneRecord.judgedReason])) };
		}),
	}),
	runConjunct({
		conjunctId: 'b_zeroIsOrphanWithReason',
		title: "zero (Student.Missing: no card under P000004) → an ORPHAN record with reason noCardUnderKey",
		twinNameList: ['noOrphanRecordOnZero'],
		judge: succeeded((runReport, outcome) => {
			const recordList = recordFor(outcome, 'toy:property/Student.Missing');
			return { pass: recordList.length === 1 && recordList[0].classification === 'orphan' && recordList[0].reason === 'noCardUnderKey', detail: JSON.stringify(recordList.map((oneRecord) => [oneRecord.classification, oneRecord.reason])) };
		}),
	}),
	runConjunct({
		conjunctId: 'c_zeroEmitsNoEdge',
		title: 'zero emits NO edge (no best guess)',
		twinNameList: ['bestGuessOnZero'],
		judge: succeeded((runReport, outcome) => ({ pass: !edgesOf(outcome).some((oneEdge) => oneEdge.fromStableId === 'toy:property/Student.Missing'), detail: `${edgesOf(outcome).filter((oneEdge) => oneEdge.fromStableId === 'toy:property/Student.Missing').length} edge(s) from the orphan subject` })),
	}),
	runConjunct({
		conjunctId: 'd_zeroAndManyCountedSeparately',
		title: 'zero and many are never one bucket: orphanCount and judgedCount are counted SEPARATELY and EQUAL the frozen fixture',
		twinNameList: ['collapseZeroIntoJudged'],
		judge: succeeded((runReport, outcome) => {
			const perTarget = blockOf(outcome).header.cardinalityCensus.perTarget;
			const expected = EXPECTED_CENSUS.byBridgeName.toyCrosswalkPlugin.cardinalityCensus.perTarget;
			return { pass: perTarget.orphanCount === expected.orphanCount && perTarget.judgedCount === expected.judgedCount && perTarget.orphanCount === 2 && perTarget.judgedCount === 5, detail: `orphan ${perTarget.orphanCount}, judged ${perTarget.judgedCount}` };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-P3', conjunctId: 'a_manyIsJudged', twinName: 'firstCardOnMany', fileName: CLASSIFICATION_FILE, find: "\tObject.freeze({ row: 7, classification: 'judged', scope: 'target', reason: 'many', condition: (context) => context.filteredPoolSize > 1 }),", replace: "\tObject.freeze({ row: 7, classification: 'specified', scope: 'target', reason: 'many', condition: (context) => context.filteredPoolSize > 1 })," });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-P3', conjunctId: 'b_zeroIsOrphanWithReason', twinName: 'noOrphanRecordOnZero', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\t\tif (classified.classification === 'orphan') {\n\t\t\t\t\t\t\t\tdecisionRecordList.push(", replace: "\t\t\t\t\t\t\tif (classified.classification === 'orphan') {\n\t\t\t\t\t\t\t\treturn;\n\t\t\t\t\t\t\t\tdecisionRecordList.push(" });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-P3', conjunctId: 'c_zeroEmitsNoEdge', twinName: 'bestGuessOnZero', leverKind: 'productionMutation', mutate: (scenario) => {
	// a materialiser double writing a "best guess" for an orphan: the orphan record is given the first card in the graph
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: "\t\t\t\t\t\t\t\tdecisionRecordList.push({ ...baseRecord, resolution: null, objectStableId: null, predicate: null, reason: baseRecord.remodelApplied ? 'remodelTargetAbsent' : 'noCardUnderKey' });", replace: "\t\t\t\t\t\t\t\tdecisionRecordList.push({ ...baseRecord, resolution: 'specified', objectStableId: args.cardList[0].stableId, predicate: 'exactMatch', predicateAssertedBy: 'labelTable', sourceLabel: 'Yes', mappingJustification: 'semapv:ManualMappingCuration', reason: baseRecord.remodelApplied ? 'remodelTargetAbsent' : 'noCardUnderKey' });" });
} });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-P3', conjunctId: 'd_zeroAndManyCountedSeparately', twinName: 'collapseZeroIntoJudged', fileName: CENSUS_FILE, find: "\t\t} else if (oneRecord.classification === 'orphan') {\n\t\t\tperTarget.orphanCount += 1;", replace: "\t\t} else if (oneRecord.classification === 'orphan') {\n\t\t\tperTarget.judgedCount += 1;" });

// ---------------------------------------------------------------------
// BG-TENTATIVE
// ---------------------------------------------------------------------
const tentativeConjunctList = [
	runConjunct({
		conjunctId: 'a_loneMaybeIsJudgedWithOneCard',
		title: "an all-tentative subject (Student.Ethnicity, 'Maybe', ONE card under P000003) is judged, never specified",
		twinNameList: ['specifyLoneMaybe'],
		judge: succeeded((runReport, outcome) => {
			const recordList = recordFor(outcome, 'toy:property/Student.Ethnicity');
			return { pass: recordList.length === 1 && recordList[0].classification === 'judged' && recordList[0].judgedReason === 'tentative' && recordList[0].filteredPoolStableIdList.length === 1, detail: JSON.stringify(recordList.map((oneRecord) => [oneRecord.classification, oneRecord.judgedReason, oneRecord.filteredPoolStableIdList.length])) };
		}),
	}),
	runConjunct({
		conjunctId: 'b_sourceLabelRawAndAssertedByLabelTable',
		title: "a picked tentative record carries sourceLabel 'Maybe' raw, predicate = predicateIfPicked (closeMatch) and predicateAssertedBy labelTable",
		twinNameList: ['dropSourceLabel'],
		shape: (scenario) => { scenario.judgeClientOverride = scenarioLib.makeFakeRealClient({}); },
		judge: succeeded((runReport, outcome) => {
			const recordList = recordFor(outcome, 'toy:property/Student.Ethnicity');
			const oneRecord = recordList[0];
			return { pass: recordList.length === 1 && oneRecord.objectStableId !== null && oneRecord.sourceLabel === 'Maybe' && oneRecord.predicate === 'closeMatch' && oneRecord.predicateAssertedBy === 'labelTable', detail: JSON.stringify([oneRecord.sourceLabel, oneRecord.predicate, oneRecord.predicateAssertedBy]) };
		}),
	}),
	runConjunct({
		conjunctId: 'c_abstentionOnTentativeEmitsNothing',
		title: 'an abstention on a tentative subject emits NOTHING and is counted abstained',
		twinNameList: ['abstainYieldsEdge'],
		shape: (scenario) => { scenario.judgeRule = 'abstain'; },
		judge: succeeded((runReport, outcome) => {
			const oneRecord = recordFor(outcome, 'toy:property/Student.Ethnicity')[0];
			return { pass: oneRecord.abstained === true && oneRecord.objectStableId === null && !edgesOf(outcome).some((oneEdge) => oneEdge.fromStableId === 'toy:property/Student.Ethnicity') && blockOf(outcome).header.cardinalityCensus.perTarget.abstainedCount > 0, detail: `abstained ${oneRecord.abstained}; edges ${edgesOf(outcome).filter((oneEdge) => oneEdge.fromStableId === 'toy:property/Student.Ethnicity').length}` };
		}),
	}),
	runConjunct({
		conjunctId: 'd_mixedYesMaybeJudgedOverUnion',
		title: 'a mixed Yes + Maybe subject (Student.Weight: P000010 Yes, P000006 Maybe) is judged over the UNION of both targets\' pools',
		twinNameList: ['mixedReadAsNSpecified'],
		judge: succeeded((runReport, outcome) => {
			const recordList = recordFor(outcome, 'toy:property/Student.Weight');
			return { pass: recordList.length === 1 && recordList[0].classification === 'judged' && /^union:/.test(recordList[0].targetKey) && JSON.stringify(recordList[0].targetCanonicalKeyList) === JSON.stringify(['P000006', 'P000010']) && recordList[0].filteredPoolStableIdList.length === 2, detail: JSON.stringify(recordList.map((oneRecord) => [oneRecord.classification, oneRecord.targetKey, oneRecord.filteredPoolStableIdList.length])) };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-TENTATIVE', conjunctId: 'a_loneMaybeIsJudgedWithOneCard', twinName: 'specifyLoneMaybe', fileName: CLASSIFICATION_FILE, find: "\tObject.freeze({ row: 4, classification: 'judged', scope: 'target', reason: 'tentative', condition: (context) => context.allLabelsTentative === true && context.filteredPoolSize >= 1 }),", replace: "\tObject.freeze({ row: 4, classification: 'judged', scope: 'target', reason: 'tentative', condition: (context) => context.allLabelsTentative === true && context.filteredPoolSize > 1 })," });
// under that twin a lone Maybe with ONE card falls to row 8 (allLabelsPredicate false → no match) → registry hole refusal → red either way; make row 8 admit it too:
scenarioTwin({ registry: twinRegistry, gateId: 'BG-TENTATIVE', conjunctId: 'a_loneMaybeIsJudgedWithOneCard', twinName: 'specifyLoneMaybeRow8', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CLASSIFICATION_FILE), find: "\tObject.freeze({ row: 4, classification: 'judged', scope: 'target', reason: 'tentative', condition: (context) => context.allLabelsTentative === true && context.filteredPoolSize >= 1 }),", replace: "\tObject.freeze({ row: 4, classification: 'judged', scope: 'target', reason: 'tentative', condition: (context) => context.allLabelsTentative === true && context.filteredPoolSize > 1 })," });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, CLASSIFICATION_FILE), find: "\tObject.freeze({ row: 8, classification: 'specified', scope: 'target', condition: (context) => context.filteredPoolSize === 1 && context.allLabelsPredicate === true }),", replace: "\tObject.freeze({ row: 8, classification: 'specified', scope: 'target', condition: (context) => context.filteredPoolSize === 1 })," });
	// and the specified branch must tolerate a tentative row's missing predicate: give it predicateIfPicked
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: "\t\t\t\tdecisionRecordList.push({ ...baseRecord, resolution: 'specified', objectStableId: filteredCardList[0].stableId, predicate: oneRow.predicate,", replace: "\t\t\t\tdecisionRecordList.push({ ...baseRecord, resolution: 'specified', objectStableId: filteredCardList[0].stableId, predicate: oneRow.predicate === undefined ? oneRow.predicateIfPicked : oneRow.predicate," });
} });
tentativeConjunctList[0].twinNameList = ['specifyLoneMaybe', 'specifyLoneMaybeRow8'];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-TENTATIVE', conjunctId: 'b_sourceLabelRawAndAssertedByLabelTable', twinName: 'dropSourceLabel', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\t\t\ttaskDone('', { ...oneTask.baseRecord, objectStableId: judged.chosenCardStableId, predicate, predicateAssertedBy: labelRow.predicateAssertedBy, sourceLabel: labelRow.sourceLabel,", replace: "\t\t\t\t\t\t\t\ttaskDone('', { ...oneTask.baseRecord, objectStableId: judged.chosenCardStableId, predicate, predicateAssertedBy: labelRow.predicateAssertedBy, sourceLabel: null," });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-TENTATIVE', conjunctId: 'c_abstentionOnTentativeEmitsNothing', twinName: 'abstainYieldsEdge', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'judgeComponent.js'), find: "\tif (choice === ABSTAIN_TOKEN) {\n\t\treturn { chosenCardStableId: null };\n\t}", replace: "\tif (choice === ABSTAIN_TOKEN) {\n\t\treturn { chosenCardStableId: renderedPoolStableIdList[0] };\n\t}" });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'judgeComponent.js'), find: "\tif (clientReturn.category === ABSTAIN_CATEGORY) {\n\t\treturn { error: refuse.byName({ moduleName, what: `the judge picked ordinal", replace: "\tif (false && clientReturn.category === ABSTAIN_CATEGORY) {\n\t\treturn { error: refuse.byName({ moduleName, what: `the judge picked ordinal" });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, 'judgeComponent.js'), find: '\tconst band = confidenceForCategory(clientReturn.category);\n\tif (band.error) {', replace: "\tconst band = clientReturn.category === ABSTAIN_CATEGORY ? { confidence: 0.5 } : confidenceForCategory(clientReturn.category);\n\tif (band.error) {" });
} });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-TENTATIVE', conjunctId: 'd_mixedYesMaybeJudgedOverUnion', twinName: 'mixedReadAsNSpecified', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\tconst unionAll = nonValueTargetKeyList.length > 1 && (!allPredicate || anyLossyEcho);', replace: '\t\t\t\t\t\tconst unionAll = nonValueTargetKeyList.length > 1 && anyLossyEcho;' });

// ---------------------------------------------------------------------
// BG-LABEL-RUN
// ---------------------------------------------------------------------
const labelRunConjunctList = [
	refusalCase({
		registry: twinRegistry, gateId: 'BG-LABEL-RUN', conjunctId: 'a_unknownLabelRefusesRunNamingIt',
		title: "an unknown label ('Perhaps') on a non-sentinel row refuses the RUN BEFORE resolution, naming the label, its count and sample subjects",
		shape: (scenario) => withScratchCsv(scenario, (rowList) => rowList.map((oneRow) => (/^Student,Student,BirthDate,/.test(oneRow) ? oneRow.replace(',Yes,', ',Perhaps,') : oneRow))),
		regex: /label "Perhaps" in column 'MappingConfidence' \(1 row; sample subjects: Student.Student.BirthDate\) has no entry in the table/,
		twinName: 'disableUnmappedLabelRefusal', fileName: PREDICATE_FILE,
		find: '\tconst firstUnmapped = Object.keys(unmappedSubjectsByLabel)[0];\n\tif (firstUnmapped !== undefined) {', replace: '\tconst firstUnmapped = Object.keys(unmappedSubjectsByLabel)[0];\n\tif (false && firstUnmapped !== undefined) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-LABEL-RUN', conjunctId: 'b_blankLabelCountsAsUnmapped',
		title: 'a BLANK label on a non-sentinel row counts as unmapped and refuses the run',
		shape: (scenario) => withScratchCsv(scenario, (rowList) => rowList.map((oneRow) => (/^Student,Student,BirthDate,/.test(oneRow) ? oneRow.replace(',Yes,', ',,') : oneRow))),
		regex: /label "" in column 'MappingConfidence' \(1 row/,
		twinName: 'disableUnmappedLabelRefusal', fileName: PREDICATE_FILE,
		find: '\tconst firstUnmapped = Object.keys(unmappedSubjectsByLabel)[0];\n\tif (firstUnmapped !== undefined) {', replace: '\tconst firstUnmapped = Object.keys(unmappedSubjectsByLabel)[0];\n\tif (false && firstUnmapped !== undefined) {',
	}),
	runConjunct({
		conjunctId: 'c_refusedRowCountedRunNotRefused',
		title: "a refused-disposition row ('Skip') is refused by name and COUNTED without refusing the run",
		twinNameList: ['refusedRowSilentlyDropped'],
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			return { pass: block.header.cardinalityCensus.perTarget.labelRefusedCount === 1 && block.refusalList.some((oneRefusal) => oneRefusal.kind === 'labelRefused' && oneRefusal.sourceLabel === 'Skip' && /toy author decided/.test(oneRefusal.reason)) && recordFor(outcome, 'toy:property/Course.Level').length === 0, detail: `labelRefusedCount ${block.header.cardinalityCensus.perTarget.labelRefusedCount}` };
		}),
	}),
	runConjunct({
		conjunctId: 'd_sentinelOnlyOnSentinelRowLawful',
		title: "a sentinelOnly label ('Not in Hub') on a sentinel row is lawful and NOT counted as unmapped (the census is scoped to non-sentinel rows)",
		twinNameList: ['censusScansSentinelRows'],
		judge: succeeded((runReport, outcome) => ({ pass: blockOf(outcome).header.cardinalityCensus.perTarget.sentinelDroppedCount === 2, detail: `sentinelDropped ${blockOf(outcome).header.cardinalityCensus.perTarget.sentinelDroppedCount}` })),
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-LABEL-RUN', conjunctId: 'e_sentinelOnlyOnRealTargetRefusesRun',
		title: "a sentinelOnly label ('Not in Hub') on a REAL-target row refuses the run by name",
		shape: (scenario) => withScratchCsv(scenario, (rowList) => rowList.map((oneRow) => (/^Student,Student,BirthDate,/.test(oneRow) ? oneRow.replace(',Yes,', ',Not in Hub,') : oneRow))),
		regex: /sentinelOnly label "Not in Hub" appears on 1 REAL-target row/,
		twinName: 'disableSentinelOnlyRefusal', fileName: PREDICATE_FILE,
		find: '\tconst firstSentinelOnly = Object.keys(sentinelOnlyOnRealTargetSubjectsByLabel)[0];\n\tif (firstSentinelOnly !== undefined) {', replace: '\tconst firstSentinelOnly = Object.keys(sentinelOnlyOnRealTargetSubjectsByLabel)[0];\n\tif (false && firstSentinelOnly !== undefined) {',
	}),
	runConjunct({
		conjunctId: 'f_sentinelRowWithMaybeCountedNeverJudged',
		title: "a sentinel row carrying 'Maybe' (Student.Nothing2) is counted sentinelLabelledRowCount and NEVER judged",
		twinNameList: ['sentinelMaybeJudged'],
		judge: succeeded((runReport, outcome) => ({ pass: blockOf(outcome).header.cardinalityCensus.perTarget.sentinelLabelledRowCount === 1 && recordFor(outcome, 'toy:property/Student.Nothing2').length === 0, detail: `sentinelLabelledRowCount ${blockOf(outcome).header.cardinalityCensus.perTarget.sentinelLabelledRowCount}; Nothing2 records ${recordFor(outcome, 'toy:property/Student.Nothing2').length}` })),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-LABEL-RUN', conjunctId: 'c_refusedRowCountedRunNotRefused', twinName: 'refusedRowSilentlyDropped', fileName: PREDICATE_FILE, find: "\t\tif (labelRow.disposition === 'refused') {\n\t\t\tlabelRefusedCount += 1;\n\t\t\trefusedRowIndexSet.add(assertionIndex);\n\t\t}", replace: "\t\tif (labelRow.disposition === 'refused') {\n\t\t\trefusedRowIndexSet.add(assertionIndex);\n\t\t}" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-LABEL-RUN', conjunctId: 'd_sentinelOnlyOnSentinelRowLawful', twinName: 'censusScansSentinelRows', fileName: PREDICATE_FILE, find: "\t\tif (isSentinelAssertion(oneAssertion)) {\n\t\t\tif (labelRow.disposition !== 'sentinelOnly') {\n\t\t\t\tsentinelLabelledRowCount += 1;\n\t\t\t}\n\t\t\treturn;\n\t\t}", replace: "\t\tif (isSentinelAssertion(oneAssertion)) {\n\t\t\tif (labelRow.disposition !== 'sentinelOnly') {\n\t\t\t\tsentinelLabelledRowCount += 1;\n\t\t\t}\n\t\t}" });
scenarioTwin({ registry: twinRegistry, gateId: 'BG-LABEL-RUN', conjunctId: 'f_sentinelRowWithMaybeCountedNeverJudged', twinName: 'sentinelMaybeJudged', leverKind: 'productionMutation', mutate: (scenario) => {
	// a framework double that keeps sentinel rows for classification (drops nothing) — Nothing2 then becomes a subject
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\t\t\t\tif (isSentinelAssertion(oneAssertion)) {\n\t\t\t\t\t\t\tsentinelDroppedCount += 1;\n\t\t\t\t\t\t\tcontinue;\n\t\t\t\t\t\t}', replace: '\t\t\t\t\t\tif (isSentinelAssertion(oneAssertion)) {\n\t\t\t\t\t\t\tsentinelDroppedCount += 1;\n\t\t\t\t\t\t}' });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: "\t\t\t\t\t\t\tif (isSentinelRawValue({ channel, rawValue: oneTarget.rawValue })) {\n\t\t\t\t\t\t\t\treturn;\n\t\t\t\t\t\t\t}", replace: "\t\t\t\t\t\t\tif (false && isSentinelRawValue({ channel, rawValue: oneTarget.rawValue })) {\n\t\t\t\t\t\t\t\treturn;\n\t\t\t\t\t\t\t}" });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, PREDICATE_FILE), find: "\t\tif (labelRow.disposition === 'sentinelOnly') {\n\t\t\t(sentinelOnlyOnRealTargetSubjectsByLabel[sourceLabel]", replace: "\t\tif (false && labelRow.disposition === 'sentinelOnly') {\n\t\t\t(sentinelOnlyOnRealTargetSubjectsByLabel[sourceLabel]" });
} });

// ---------------------------------------------------------------------
// BG-SUBJECT
// ---------------------------------------------------------------------
const subjectConjunctList = [
	runConjunct({
		conjunctId: 'a_hookCalledOnceWithDistinctList',
		title: 'subjectStableIdFor is called ONCE per run with the DISTINCT subject list',
		twinNameList: ['hookCalledPerSubject'],
		shape: (scenario) => {
			const loaded = require(CROSSWALK_PLUGIN_PATH);
			scenario.hookCallLog = [];
			scenario.pluginModuleOverrides.toyCrosswalkPlugin = { bridgeHooks: { ...loaded.bridgeHooks, subjectStableIdFor: (hookArgs, callback) => { scenario.hookCallLog.push(hookArgs.subjectIdentityList.length); loaded.bridgeHooks.subjectStableIdFor(hookArgs, callback); } } };
		},
		judge: succeeded((runReport, outcome, scenario) => ({ pass: scenario.hookCallLog.length === 1 && scenario.hookCallLog[0] === 16, detail: `calls ${scenario.hookCallLog.length}, sizes ${scenario.hookCallLog.join(',')}` })),
	}),
	runConjunct({
		conjunctId: 'b_manyToOneReportedWithAssertingSubjectList',
		title: 'many-to-one (Student.Extra ← two subjects) is REPORTED per subject with assertingSubjectList on the record and manyToOneSubjectCount in the census',
		twinNameList: ['dropAssertingSubjectList'],
		judge: succeeded((runReport, outcome) => {
			const recordList = recordFor(outcome, 'toy:property/Student.Extra');
			return { pass: recordList.length === 1 && recordList[0].assertingSubjectList.length === 2 && blockOf(outcome).header.cardinalityCensus.perTarget.manyToOneSubjectCount === 4, detail: `Extra records ${recordList.length}; asserting ${recordList.length ? recordList[0].assertingSubjectList.length : 0}; manyToOne ${blockOf(outcome).header.cardinalityCensus.perTarget.manyToOneSubjectCount}` };
		}),
	}),
	runConjunct({
		conjunctId: 'c_collisionRefusedNoEdgeCounted',
		title: 'a merged leaf with DIFFERENT target sets (Course.Credits ← Course|Course|Credits→P000001, Course|CourseOffering|Credits→P000006) is refused as subjectCollision — all targets named, NO edge, counted',
		twinNameList: ['mergerEmitsFirstTarget'],
		judge: succeeded((runReport, outcome) => {
			const block = blockOf(outcome);
			const collision = block.refusalList.find((oneRefusal) => oneRefusal.kind === 'subjectCollision' && oneRefusal.subjectStableId === 'toy:property/Course.Credits');
			return { pass: collision !== undefined && Object.keys(collision.targetSetBySubjectKey).length === 2 && recordFor(outcome, 'toy:property/Course.Credits').length === 0 && !edgesOf(outcome).some((oneEdge) => oneEdge.fromStableId === 'toy:property/Course.Credits') && block.header.cardinalityCensus.perSubject.subjectCollisionCount === 2, detail: collision ? `targets ${JSON.stringify(collision.targetSetBySubjectKey)}; edges ${edgesOf(outcome).filter((oneEdge) => oneEdge.fromStableId === 'toy:property/Course.Credits').length}` : 'no collision refusal' };
		}),
	}),
	runConjunct({
		conjunctId: 'd_sameTargetMergedYieldsOneEdge',
		title: 'same-target merged subjects (Student.Extra) yield ONE edge per (leaf, target) with attestationChannelList of length 3',
		twinNameList: ['twoEdgesForOneLeafTarget'],
		judge: succeeded((runReport, outcome) => {
			const edgeList = edgesOf(outcome).filter((oneEdge) => oneEdge.fromStableId === 'toy:property/Student.Extra');
			return { pass: edgeList.length === 1 && edgeList[0].properties.attestationChannelList.length === 3, detail: `${edgeList.length} edge(s); attestations ${edgeList.length ? edgeList[0].properties.attestationChannelList.length : 0}` };
		}),
	}),
];
subjectConjunctList[0].twinNameList = ['hookCalledPerSubjectViaHookDouble'];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-SUBJECT', conjunctId: 'a_hookCalledOnceWithDistinctList', twinName: 'hookCalledPerSubjectViaHookDouble', leverKind: 'productionMutation', mutate: (scenario) => {
	// a framework double calling the hook PER SUBJECT (the D-S6 violation): the call is wrapped in a per-subject loop
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\t\t\tconst subjectIdentityList = subjectGroupList.map((oneGroup) => ({ subjectKey: oneGroup.subjectKey, subjectIdentity: { ...oneGroup.subjectIdentity } }));\n\t\t\t\t\thookCallCount += 1;', replace: '\t\t\t\t\tconst subjectIdentityList = subjectGroupList.map((oneGroup) => ({ subjectKey: oneGroup.subjectKey, subjectIdentity: { ...oneGroup.subjectIdentity } }));\n\t\t\t\t\tsubjectIdentityList.slice(1).forEach((oneIdentity) => bridgeHooks.subjectStableIdFor(graphSeamRulesLib.closedHookArgs({ subjectIdentityList: [oneIdentity], sourceReader: walkView, xLog }), () => {}));\n\t\t\t\t\thookCallCount += 1;' });
} });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-SUBJECT', conjunctId: 'b_manyToOneReportedWithAssertingSubjectList', twinName: 'dropAssertingSubjectList', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\t\t\tassertingSubjectList: oneLeaf.assertingSubjectList,\n\t\t\t\t\t\t\t\ttargetKey,', replace: '\t\t\t\t\t\t\t\tassertingSubjectList: [oneLeaf.assertingSubjectList[0]],\n\t\t\t\t\t\t\t\ttargetKey,' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-SUBJECT', conjunctId: 'c_collisionRefusedNoEdgeCounted', twinName: 'mergerEmitsFirstTarget', fileName: GROUPING_FILE, find: '\t\t\tif (new Set(targetSetTextList).size > 1) {', replace: '\t\t\tif (false && new Set(targetSetTextList).size > 1) {' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-SUBJECT', conjunctId: 'd_sameTargetMergedYieldsOneEdge', twinName: 'twoEdgesForOneLeafTarget', fileName: GROUPING_FILE, find: '\t\tconst leaf = leafBySubjectStableId[resolution.subjectStableId];\n\t\tif (leaf === undefined) {', replace: '\t\tconst leaf = undefined;\n\t\tif (leaf === undefined) {' });
// under twoEdgesForOneLeafTarget the two Extra subjects become two leaves with the same subjectStableId → two records → the
// materialiser MERGEs the edge on (from,type,to) so the double sees ONE edge... but attestations become 2 and 1 — the
// conjunct asserts attestations 3 → red. (edgeCount vs distinctTripleCount reddens BG-EDGE-UNIQUE too.)

// ---------------------------------------------------------------------
// BG-MISMATCH + BG-EMPTY
// ---------------------------------------------------------------------
const mismatchConjunctList = [
	runConjunct({
		conjunctId: 'mismatchRecordedJudgedOverKeyPool',
		title: 'a supplied domainId (C9) matching no card under a NON-empty key pool (P000008: C3) → sourceSideMismatch with the field and survivor count, judged over the KEY pool, never promoted on the key alone',
		twinNameList: ['dropDomainFilterAndSpecify'],
		judge: succeeded((runReport, outcome) => {
			const oneRecord = recordFor(outcome, 'toy:property/School.Address')[0];
			return { pass: oneRecord !== undefined && oneRecord.classification === 'judged' && oneRecord.judgedReason === 'sourceSideMismatch' && oneRecord.sourceSideMismatch !== null && oneRecord.sourceSideMismatch.mismatchByField.domainId.suppliedValue === 'C9' && oneRecord.sourceSideMismatch.survivingCandidateCount === 1 && oneRecord.keyPoolStableIdList.length === 1 && oneRecord.filteredPoolStableIdList.length === 0, detail: oneRecord ? JSON.stringify([oneRecord.classification, oneRecord.judgedReason, oneRecord.sourceSideMismatch]) : 'no record' };
		}),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-MISMATCH', conjunctId: 'mismatchRecordedJudgedOverKeyPool', twinName: 'dropDomainFilterAndSpecify', fileName: CLASSIFICATION_FILE, find: "\tconst filterFieldList = Object.keys(suppliedTupleFields).filter((oneField) => oneField !== 'canonicalKey').sort();", replace: "\tconst filterFieldList = [];" });
const emptyConjunctList = [
	refusalCase({
		registry: twinRegistry, gateId: 'BG-EMPTY', conjunctId: 'emptyAssertionSetRefused',
		title: 'a zero-row crosswalk (scratch copy, header only) → the walk yields an EMPTY assertion set → refused by name, never frozen green',
		shape: (scenario) => withScratchCsv(scenario, () => []),
		regex: /the walk yielded an EMPTY assertion set/,
		twinName: 'freezeEmptyBlock', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\t\tif (walked.assertionList.length === 0) {', replace: '\t\t\t\t\t\tif (false && walked.assertionList.length === 0) {',
	}),
	refusalCase({
		registry: twinRegistry, gateId: 'BG-EMPTY', conjunctId: 'zeroCardsRefused',
		title: 'a hub double with ZERO property-tier cards → refused by name',
		shape: (scenario) => { scenario.graph.nodeList = scenario.graph.nodeList.filter((oneNode) => oneNode.labels.indexOf('HubReference') === -1); },
		regex: /carries ZERO property-tier cards/,
		twinName: 'admitZeroCards', fileName: FRAMEWORK_FILE,
		find: '\t\t\t\t\t\tif (cardList.length === 0) {', replace: '\t\t\t\t\t\tif (false && cardList.length === 0) {',
	}),
];
// under freezeEmptyBlock the "after sentinel drop … NO assertion remains" guard fires next — that is ANOTHER guard for the
// same rule; the twin must disable it too to show the empty block would freeze
emptyConjunctList[0].twinNameList = ['freezeEmptyBlock', 'freezeEmptyBlockBothGuards'];
scenarioTwin({ registry: twinRegistry, gateId: 'BG-EMPTY', conjunctId: 'emptyAssertionSetRefused', twinName: 'freezeEmptyBlockBothGuards', leverKind: 'productionMutation', mutate: (scenario) => {
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\t\t\t\tif (walked.assertionList.length === 0) {', replace: '\t\t\t\t\t\tif (false && walked.assertionList.length === 0) {' });
	scenario.frameworkMutationList.push({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, FRAMEWORK_FILE), find: '\t\t\t\t\tif (preparedList.length === 0) {', replace: '\t\t\t\t\tif (false && preparedList.length === 0) {' });
} });

const gateDeclarationList = [
	{ gateId: 'BG-CENSUS', title: 'the census EQUALS the frozen fixture', conjunctList: censusConjunctList },
	{ gateId: 'BG-P3', title: 'cardinality (Profile 7.3)', conjunctList: p3ConjunctList },
	{ gateId: 'BG-TENTATIVE', title: 'tentative labels are judged', conjunctList: tentativeConjunctList },
	{ gateId: 'BG-LABEL-RUN', title: 'the label census refuses the run', conjunctList: labelRunConjunctList },
	{ gateId: 'BG-SUBJECT', title: 'subject resolution once; collisions refused', conjunctList: subjectConjunctList },
	{ gateId: 'BG-MISMATCH', title: 'source-side mismatch', conjunctList: mismatchConjunctList },
	{ gateId: 'BG-EMPTY', title: 'never an empty block frozen green', conjunctList: emptyConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-CENSUS+BG-P3+BG-TENTATIVE+BG-LABEL-RUN+BG-SUBJECT+BG-MISMATCH+BG-EMPTY', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 7 + 4 + 4 + 6 + 4 + 1 + 2 },
	() => harness.report(),
);
