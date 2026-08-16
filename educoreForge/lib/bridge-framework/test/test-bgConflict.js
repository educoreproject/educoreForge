#!/usr/bin/env node
'use strict';

// test-bgConflict.js — BG-CONFLICT (BR-063, BR-108; RULINGS A11, BF8, 12:05 #1) + BG-VALUE (BR-080, BR-134) + BG-REMODEL
// (BR-015, BR-035, BR-036; RULING P11) + BG-QUALIFIER-WIDEN (RULING P8): the second plugin, the value tier, the hub-owned
// remodel table and the read-boundary re-widening.
//   BG-CONFLICT (a) two toy plugins on one pairing naming DIFFERENT targets for one subject (Student.FirstName: crosswalk
//   P000001, standard P000006) → the SECOND plugin's materialisation of that subject is REFUSED by name (block recorded,
//   that edge NOT written), the FIRST plugin's edge STANDS, a conflict record in the report + a MappingReview trail,
//   conflictCount in the report and ABSENT from both frozen censuses; (b) the C4 lossy-echo shape (one row, several ids —
//   Course.Title) → judged, NOT conflict; (c) the BR-064(b) all-Yes combination (School.Code) → N specified, NOT conflict;
//   (d) a conflict record carries mappingJustification MappingReview; (e) with ONE plugin the report line names the
//   detector as fixture-exercised.
//   BG-VALUE (a) a value channel's rows are refused by name (never assertions) and a valueKey-bearing assertion is a
//   valueTierRefused record; (b) COUNTED with raw form (refusedValueTierAssertionCount 3); (c) NO edge to a value-tier card
//   (the write seam refuses a value card object).
//   BG-REMODEL (a) the hub-owned table is applied BEFORE direct resolution (School.Name: raw P000009 → the qualified P000005
//   card); (b) an entry resolves to a specific TUPLE (qualifierKeys [OV0001]), never a bare base property; (c) a remodel
//   target absent (School.Ghost: P000011 → P000099) → orphan remodelTargetAbsent; (d) both toy plugins REFERENCE the ONE
//   table (a plugin carrying its own table is refused as an unknown key); (e) a declared class-side row turns the mismatch
//   subject (School.Address C9 → C3) into specified, remodelApplied.side 'class' — a NAMED mover in the census.
//   BG-QUALIFIER-WIDEN (a) a card whose qualifierKeys arrives as a SCALAR string is re-widened at the read boundary to a
//   one-element list; (b) the remodel's qualified target MATCHES that card and the row is specified; (c) [] and a multi-
//   element list pass through unchanged.
//
// Run: node lib/bridge-framework/test/test-bgConflict.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- BG-CONFLICT + BG-VALUE + BG-REMODEL + BG-QUALIFIER-WIDEN

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
const { runConjunct, pureConjunct, succeeded, nameInRefusal, refusalCase, frameworkMutationTwin, scenarioTwin, edgesOf, blockOf, forensicsOf } = require('./testSupport/bridgeTwinFactories');
const { runGateFamily } = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'gateSuiteRunner'));
const { makeTwinRegistry } = require(path.join(__dirname, '..', '..', 'forge-framework', 'roundTripHarness', 'twinRegistry'));
const moduleDouble = require(path.join(__dirname, '..', '..', 'forge-framework', 'test', 'testSupport', 'moduleDouble'));
const graphSeamRulesLib = require('../graphSeamRules');

const twinRegistry = makeTwinRegistry();
const FRAMEWORK_FILE = 'bridge-framework.js';
const CONFLICT_FILE = 'conflictDetector.js';
const RULES_FILE = 'graphSeamRules.js';
const GROUPING_FILE = 'subjectGrouping.js';
const CROSSWALK_PLUGIN_PATH = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyCrosswalkPlugin.js');
const STANDARD_PLUGIN_PATH = path.join(scenarioLib.FIXTURE_FORGES_DIR, 'toy', 'bridges', 'toyStandardPlugin.js');
const cloneJson = scenarioLib.cloneJson;
const recordFor = (outcome, subjectStableId) => blockOf(outcome).decisionRecordList.filter((oneRecord) => oneRecord.subjectStableId === subjectStableId);
const overrideDeclaration = (scenario, pluginName, mutate) => {
	const loaded = require(pluginName === 'toyCrosswalkPlugin' ? CROSSWALK_PLUGIN_PATH : STANDARD_PLUGIN_PATH);
	const bridgeDeclaration = cloneJson(loaded.bridgeDeclaration);
	mutate(bridgeDeclaration);
	scenario.pluginModuleOverrides[pluginName] = { ...(scenario.pluginModuleOverrides[pluginName] || {}), bridgeDeclaration };
};
const withScratchCsv = (scenario, mutateRowList) => {
	const scratchForgesDir = scenarioLib.makeScratchForgesCopy();
	const snapshotDir = path.join(scratchForgesDir, 'toy', 'assets', 'standardSourceData', '01');
	const csvPath = path.join(snapshotDir, 'toyCrosswalk.csv');
	const lineList = fs.readFileSync(csvPath, 'utf8').split('\n');
	const trailingBlank = lineList[lineList.length - 1] === '' ? [''] : [];
	fs.writeFileSync(csvPath, [lineList[0]].concat(mutateRowList(lineList.filter((oneLine, oneIndex) => oneIndex > 0 && oneLine !== ''))).concat(trailingBlank).join('\n'));
	const sumsPath = path.join(snapshotDir, 'SHA256SUMS');
	fs.writeFileSync(sumsPath, fs.readFileSync(sumsPath, 'utf8').replace(/^[0-9a-f]{64}(  toyCrosswalk\.csv)$/m, `${require('crypto').createHash('sha256').update(fs.readFileSync(csvPath)).digest('hex')}$1`));
	scenario.forgesDirOverride = scratchForgesDir;
};

// runBothPlugins — crosswalk plugin first, then the standard plugin on the SAME stores (a fresh graph each) — the pairing's
// second plugin sees the first's block through the store-side sibling lookup
const runBothPlugins = (scenario, callback) => {
	scenario.spec.bridge = 'toyCrosswalkPlugin';
	scenarioLib.runScenario(scenario, (unusedError, first) => {
		if (first.runError || first.constructionError) {
			callback('', { first, second: null });
			return;
		}
		const second = scenarioLib.cloneScenario(scenario);
		second.stores = scenario.stores;
		second.graph = cloneJson(scenario.graph);
		second.spec.bridge = 'toyStandardPlugin';
		scenarioLib.runScenario(second, (unusedSecondError, secondOutcome) => callback('', { first, second: secondOutcome }));
	});
};
const bothConjunct = ({ conjunctId, title, twinNameList, judge }) => ({ conjunctId, title, twinNameList, evaluate: (scenario, callback) => runBothPlugins(scenario, (unusedError, outcome) => callback('', judge(outcome, scenario))) });

// ---------------------------------------------------------------------
// BG-CONFLICT
// ---------------------------------------------------------------------
const conflictConjunctList = [
	bothConjunct({
		conjunctId: 'a_secondPluginConflictRefusedFirstStands',
		title: "two toy plugins on one pairing: the SECOND's materialisation of Student.FirstName (P000006 vs the first's P000001) is REFUSED by name — its block recorded, that edge NOT written, the FIRST's edge STANDS, a conflict record in the report + the MappingReview trail, conflictCount in the report and ABSENT from both frozen censuses",
		twinNameList: ['secondPluginWritesAnyway', 'conflictCountFrozenIntoText'],
		judge: (outcome) => {
			if (!outcome.second || outcome.second.runError) {
				return { pass: false, detail: String(outcome.second ? outcome.second.runError : outcome.first.runError).slice(0, 220) };
			}
			const firstEdge = edgesOf(outcome.first).find((oneEdge) => oneEdge.fromStableId === 'toy:property/Student.FirstName');
			const secondEdge = edgesOf(outcome.second).find((oneEdge) => oneEdge.fromStableId === 'toy:property/Student.FirstName');
			const secondBlock = blockOf(outcome.second);
			const secondBlockHasSubject = secondBlock.decisionRecordList.some((oneRecord) => oneRecord.subjectStableId === 'toy:property/Student.FirstName' && oneRecord.objectStableId === 'toyhub:card/P000006.C1');
			const review = forensicsOf(outcome.second).find((oneRecord) => oneRecord.record.kind === 'MappingReview');
			const censusFree = JSON.stringify(secondBlock.header.cardinalityCensus).indexOf('conflictCount') === -1 && JSON.stringify(blockOf(outcome.first).header.cardinalityCensus).indexOf('conflictCount') === -1;
			return { pass: firstEdge !== undefined && firstEdge.toStableId === 'toyhub:card/P000001.C1' && secondEdge === undefined && secondBlockHasSubject && outcome.second.runReport.counts.conflictCount === 1 && review !== undefined && review.record.conflictList[0].subjectStableId === 'toy:property/Student.FirstName' && censusFree, detail: `first edge ${firstEdge ? firstEdge.toStableId : 'ABSENT'}; second edge ${secondEdge ? 'WRITTEN' : 'refused'}; recorded ${secondBlockHasSubject}; conflictCount ${outcome.second.runReport.counts.conflictCount}; review ${review !== undefined}; census free ${censusFree}` };
		},
	}),
	runConjunct({
		conjunctId: 'b_lossyEchoIsJudgedNotConflict',
		title: 'the C4 lossy-echo shape (Course.Title: one row naming 000001;000006) is judged over the union — NOT a conflict',
		twinNameList: ['echoRaisesConflict'],
		judge: succeeded((runReport, outcome) => { const oneRecord = recordFor(outcome, 'toy:property/Course.Title')[0]; return { pass: oneRecord !== undefined && oneRecord.classification === 'judged' && oneRecord.lossyEcho === true && runReport.counts.conflictCount === 0, detail: oneRecord ? `${oneRecord.classification} lossyEcho ${oneRecord.lossyEcho}; conflicts ${runReport.counts.conflictCount}` : 'no record' }; }),
	}),
	runConjunct({
		conjunctId: 'c_allYesCombinationIsNSpecifiedNotConflict',
		title: 'the BR-064(b) all-Yes combination (School.Code: P000006 Yes + P000010 Yes) → 2 specified records, NOT a conflict',
		twinNameList: ['combinationReadAsAlternatives'],
		judge: succeeded((runReport, outcome) => { const recordList = recordFor(outcome, 'toy:property/School.Code'); return { pass: recordList.length === 2 && recordList.every((oneRecord) => oneRecord.classification === 'specified') && runReport.counts.conflictCount === 0, detail: JSON.stringify(recordList.map((oneRecord) => oneRecord.classification)) }; }),
	}),
	bothConjunct({
		conjunctId: 'd_conflictRecordCarriesMappingReview',
		title: "a conflict record carries mappingJustification 'semapv:MappingReview' and disposition thisPluginMaterialisationRefused",
		twinNameList: ['manualCurationOnConflict'],
		judge: (outcome) => {
			if (!outcome.second || outcome.second.runError) {
				return { pass: false, detail: String(outcome.second ? outcome.second.runError : outcome.first.runError).slice(0, 220) };
			}
			const oneConflict = outcome.second.runReport.counts.conflictCount === 1 ? forensicsOf(outcome.second).find((oneRecord) => oneRecord.record.kind === 'MappingReview').record.conflictList[0] : undefined;
			return { pass: oneConflict !== undefined && oneConflict.mappingJustification === 'semapv:MappingReview' && oneConflict.disposition === 'thisPluginMaterialisationRefused', detail: JSON.stringify(oneConflict) };
		},
	}),
	runConjunct({
		conjunctId: 'e_onePluginReportNamesFixtureExercised',
		title: 'with ONE plugin on the pairing the report line names the detector as fixture-exercised, never a bare "0 conflicts"',
		twinNameList: ['bareZeroConflicts'],
		shape: (scenario) => {
			scenario.reportLineList = [];
			scenario.deps.xLog = { status: (text) => { scenario.reportLineList.push(text); }, error: (text) => { scenario.reportLineList.push(`ERR ${text}`); } };
			// a registry with the crosswalk plugin ALONE: the standard plugin's file removed in a scratch copy
			const scratchForgesDir = scenarioLib.makeScratchForgesCopy();
			fs.unlinkSync(path.join(scratchForgesDir, 'toy', 'bridges', 'toyStandardPlugin.js'));
			scenario.forgesDirOverride = scratchForgesDir;
		},
		judge: succeeded((runReport, outcome, scenario) => { const line = scenario.reportLineList.find((oneLine) => /0 conflicts \(one plugin on this pairing — detector exercised by fixture only\)/.test(oneLine)); const bare = scenario.reportLineList.find((oneLine) => /^\[bridge [^\]]*\] 0 conflicts$/.test(oneLine)); return { pass: line !== undefined && bare === undefined && runReport.counts.conflictCount === 0, detail: line || 'no fixture-exercised line' }; }),
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CONFLICT', conjunctId: 'a_secondPluginConflictRefusedFirstStands', twinName: 'secondPluginWritesAnyway', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\tconst materialisableBlock = { ...block, decisionRecordList: block.decisionRecordList.filter((oneRecord) => !conflictedSubjectSet.has(oneRecord.subjectStableId)) };', replace: '\t\t\t\t\tconst materialisableBlock = { ...block, decisionRecordList: block.decisionRecordList.slice() };' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CONFLICT', conjunctId: 'a_secondPluginConflictRefusedFirstStands', twinName: 'conflictCountFrozenIntoText', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\tcardinalityCensus: provisionalCensus,\n\t\t\t\t\t\tgeneration,', replace: '\t\t\t\t\t\tcardinalityCensus: { ...provisionalCensus, conflictCount: 0 },\n\t\t\t\t\t\tgeneration,' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CONFLICT', conjunctId: 'b_lossyEchoIsJudgedNotConflict', twinName: 'echoRaisesConflict', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\treport.conflictCount = conflicts.conflictList.length;', replace: '\t\t\t\t\treport.conflictCount = conflicts.conflictList.length + block.decisionRecordList.filter((oneRecord) => oneRecord.lossyEcho === true).length;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CONFLICT', conjunctId: 'c_allYesCombinationIsNSpecifiedNotConflict', twinName: 'combinationReadAsAlternatives', fileName: FRAMEWORK_FILE, find: '\t\t\t\t\t\tconst unionAll = nonValueTargetKeyList.length > 1 && (!allPredicate || anyLossyEcho);', replace: '\t\t\t\t\t\tconst unionAll = nonValueTargetKeyList.length > 1;' });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CONFLICT', conjunctId: 'd_conflictRecordCarriesMappingReview', twinName: 'manualCurationOnConflict', fileName: CONFLICT_FILE, find: "\t\t\t\t\t\tmappingJustification: 'semapv:MappingReview',", replace: "\t\t\t\t\t\tmappingJustification: 'semapv:ManualMappingCuration'," });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-CONFLICT', conjunctId: 'e_onePluginReportNamesFixtureExercised', twinName: 'bareZeroConflicts', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\tsay('0 conflicts (one plugin on this pairing — detector exercised by fixture only)');", replace: "\t\t\t\t\t\tsay('0 conflicts');" });

// ---------------------------------------------------------------------
// BG-VALUE
// ---------------------------------------------------------------------
const valueConjunctList = [
	runConjunct({
		conjunctId: 'a_valueTierRefusedByName',
		title: "a value channel's rows are never assertions (the descriptors channel yields 0) and a valueKey-bearing assertion is classified valueTierRefused (raw form retained)",
		twinNameList: ['resolverAdmitsValueAssertion'],
		shape: (scenario) => {
			const loaded = require(CROSSWALK_PLUGIN_PATH);
			scenario.pluginModuleOverrides.toyCrosswalkPlugin = { bridgeHooks: { ...loaded.bridgeHooks, walkSourceAssertions: (hookArgs, callback) => loaded.bridgeHooks.walkSourceAssertions(hookArgs, (walkError, walked) => {
				if (walkError) { callback(walkError); return; }
				// one crosswalk row re-shaped as a value-tier assertion (a valueKey-bearing tuple) — the framework classifies it valueTierRefused
				const shaped = walked.assertionList.map((oneAssertion) => (oneAssertion.subjectIdentity.ToyElementName === 'Gender' ? { ...oneAssertion, tupleFieldValues: { ...oneAssertion.tupleFieldValues, valueKey: 'OV000001' } } : oneAssertion));
				callback('', { ...walked, assertionList: shaped });
			}) } };
		},
		judge: succeeded((runReport, outcome) => { const oneRecord = recordFor(outcome, 'toy:property/Student.Gender')[0]; const perTarget = blockOf(outcome).header.cardinalityCensus.perTarget; return { pass: oneRecord !== undefined && oneRecord.classification === 'valueTierRefused' && Array.isArray(oneRecord.rawForm) && perTarget.valueTierRefusedCount === 1 && !edgesOf(outcome).some((oneEdge) => oneEdge.fromStableId === 'toy:property/Student.Gender'), detail: oneRecord ? `${oneRecord.classification}; count ${perTarget.valueTierRefusedCount}` : 'no record' }; }),
	}),
	runConjunct({
		conjunctId: 'b_countedWithRawForm',
		title: 'value-tier rows are COUNTED (refusedValueTierAssertionCount 3 — the descriptors channel) with the raw form retained in the channel report',
		twinNameList: ['countZeroWithDescriptorsPresent'],
		judge: succeeded((runReport, outcome) => ({ pass: blockOf(outcome).header.cardinalityCensus.perTarget.refusedValueTierAssertionCount === 3, detail: `refusedValueTierAssertionCount ${blockOf(outcome).header.cardinalityCensus.perTarget.refusedValueTierAssertionCount}` })),
	}),
	pureConjunct({
		conjunctId: 'c_noEdgeToValueCard',
		title: 'NO edge to a value-tier card exists: the write seam refuses an object endpoint whose referenceTier is value',
		twinNameList: ['seamAdmitsValueObject'],
		judge: (scenario) => {
			const rules = scenario.frameworkMutationList.some((oneMutation) => oneMutation.modulePath.endsWith(RULES_FILE)) ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RULES_FILE), mutationList: scenario.frameworkMutationList }) : graphSeamRulesLib;
			const edgeProperties = { predicate: 'exactMatch', mappingJustification: 'semapv:ManualMappingCuration', matchBasis: 'crosswalk', resolution: 'specified', mappingProvider: 'https://x', subjectMatchField: 'a:b', objectMatchField: 'c:d', subjectSource: 'Toy', subjectVersion: '1', objectSource: 'ToyHub', objectVersion: '1', predicateAssertedBy: 'labelTable', attestationChannelList: ['x:1'], decisionBlockHash: 'a'.repeat(64), provenanceTier: 'spec-authoritative' };
			const refusal = rules.mappingEdgeRefusal({ subjectStableId: 's', objectStableId: 'o', edgeType: 'EXACT_MATCH', edgeProperties, sourceStandardName: 'Toy', subjectEndpoint: { labels: ['DmeProperty'], sourceStandardName: 'Toy' }, objectEndpoint: { labels: ['HubReference'], referenceTier: 'value' } });
			return { pass: refusal !== null && /is a 'value'-tier card/.test(refusal.message), detail: refusal ? refusal.message.slice(0, 160) : 'the seam ADMITTED a value-card object' };
		},
	}),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-VALUE', conjunctId: 'a_valueTierRefusedByName', twinName: 'resolverAdmitsValueAssertion', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\tpreparedList.push({ ...oneAssertion, suppliedTupleFields, targetKeyList, labelRow, valueTier: channel.tier === 'value' || oneAssertion.tupleFieldValues.valueKey !== undefined, lossyEcho: targetKeyList.length > 1 });", replace: "\t\t\t\t\t\tpreparedList.push({ ...oneAssertion, suppliedTupleFields, targetKeyList, labelRow, valueTier: false, lossyEcho: targetKeyList.length > 1 });" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-VALUE', conjunctId: 'b_countedWithRawForm', twinName: 'countZeroWithDescriptorsPresent', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\tconst refusedValueTierAssertionCount = bridgeDeclaration.sourceChannelList.filter((oneChannel) => oneChannel.tier === 'value').reduce((soFar, oneChannel) => soFar + walked.channelReport[oneChannel.channelKey].valueTierRows, 0);", replace: "\t\t\t\t\t\tconst refusedValueTierAssertionCount = 0;" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-VALUE', conjunctId: 'c_noEdgeToValueCard', twinName: 'seamAdmitsValueObject', fileName: RULES_FILE, find: '\tif (objectEndpoint.referenceTier !== undefined && objectEndpoint.referenceTier !== PROPERTY_TIER) {', replace: '\tif (false && objectEndpoint.referenceTier !== undefined && objectEndpoint.referenceTier !== PROPERTY_TIER) {' });

// ---------------------------------------------------------------------
// BG-REMODEL
// ---------------------------------------------------------------------
const remodelConjunctList = [
	runConjunct({ conjunctId: 'a_appliedBeforeDirectResolution', title: 'the hub-owned table is applied BEFORE direct resolution: School.Name (raw P000009) resolves to the qualified P000005 card, remodelApplied.side property', twinNameList: ['applyAfterResolution'], judge: succeeded((runReport, outcome) => { const oneRecord = recordFor(outcome, 'toy:property/School.Name')[0]; return { pass: oneRecord !== undefined && oneRecord.classification === 'specified' && oneRecord.objectStableId === 'toyhub:card/P000005.C1.OV0001' && oneRecord.remodelApplied !== null && oneRecord.remodelApplied.side === 'property' && oneRecord.remodelApplied.from.canonicalKey === 'P000009', detail: oneRecord ? JSON.stringify([oneRecord.classification, oneRecord.objectStableId, oneRecord.remodelApplied]) : 'no record' }; }) }),
	runConjunct({ conjunctId: 'b_resolvesToSpecificTuple', title: 'an entry resolves to a specific TUPLE (P000005 + qualifierKeys [OV0001]), never a bare base property', twinNameList: ['resolveToBareKey'], judge: succeeded((runReport, outcome) => { const oneRecord = recordFor(outcome, 'toy:property/School.Name')[0]; const tuple = oneRecord.suppliedTupleByTarget.P000005; return { pass: tuple !== undefined && JSON.stringify(tuple.qualifierKeys) === JSON.stringify(['OV0001']) && oneRecord.objectStableId === 'toyhub:card/P000005.C1.OV0001', detail: JSON.stringify(tuple) }; }) }),
	runConjunct({ conjunctId: 'c_absentTargetIsOrphanRemodelTargetAbsent', title: 'a remodel target absent from the hub (School.Ghost: P000011 → P000099) → orphan with reason remodelTargetAbsent', twinNameList: ['silentlyPromote'], judge: succeeded((runReport, outcome) => { const oneRecord = recordFor(outcome, 'toy:property/School.Ghost')[0]; return { pass: oneRecord !== undefined && oneRecord.classification === 'orphan' && oneRecord.reason === 'remodelTargetAbsent', detail: oneRecord ? `${oneRecord.classification}/${oneRecord.reason}` : 'no record' }; }) }),
	refusalCase({ registry: twinRegistry, gateId: 'BG-REMODEL', conjunctId: 'd_pluginsReferenceTheOneTable', title: 'both toy plugins REFERENCE the one hub-owned table by name; a plugin carrying its OWN copy (a remodelTable key) is refused as an unknown key', shape: (scenario) => overrideDeclaration(scenario, 'toyCrosswalkPlugin', (declaration) => { declaration.remodelTable = { 'ToyHub@1.0': {} }; }), regex: /unknown key 'remodelTable'/, twinName: 'admitPluginOwnedTable', fileName: 'bridgePluginContract.js', find: '\tif (unknownName !== undefined) {\n\t\treturn refuseWith(`bridgeDeclaration carries unknown key', replace: '\tif (unknownName !== undefined && false) {\n\t\treturn refuseWith(`bridgeDeclaration carries unknown key' }),
	runConjunct({ conjunctId: 'e_classSideRowTurnsMismatchSpecified', title: "a declared class-side row ({ P000008, C9 → C3 }) turns the mismatch subject School.Address into specified with remodelApplied.side 'class' — a NAMED mover in the census (judged 5 → 4, specified 6 → 7)", twinNameList: ['classSideIgnored'], shape: (scenario) => overrideDeclaration(scenario, 'toyCrosswalkPlugin', (declaration) => { declaration.classSideRemodelTable = [{ canonicalKey: 'P000008', sourceDomainId: 'C9', targetDomainId: 'C3' }]; }), judge: succeeded((runReport, outcome) => { const oneRecord = recordFor(outcome, 'toy:property/School.Address')[0]; const perSubject = blockOf(outcome).header.cardinalityCensus.perSubject; return { pass: oneRecord !== undefined && oneRecord.classification === 'specified' && oneRecord.remodelApplied !== null && oneRecord.remodelApplied.side === 'class' && perSubject.judgedSubjectCount === 4 && perSubject.specifiedSubjectCount === 7, detail: oneRecord ? `${oneRecord.classification} ${JSON.stringify(oneRecord.remodelApplied)}; census ${JSON.stringify(perSubject)}` : 'no record' }; }) }),
];
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-REMODEL', conjunctId: 'a_appliedBeforeDirectResolution', twinName: 'applyAfterResolution', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\t\t\tconst remodelled = subjectGroupingLib.applyRemodel({ target: { canonicalKey: oneCanonicalKey, ...oneAssertion.suppliedTupleFields }, remodelTable, hubName: args.hubName, hubVersion: String(hubVersion), classSideRemodelTable: bridgeDeclaration.classSideRemodelTable });", replace: "\t\t\t\t\t\t\t\tconst remodelled = subjectGroupingLib.applyRemodel({ target: { canonicalKey: oneCanonicalKey, ...oneAssertion.suppliedTupleFields }, remodelTable: null, hubName: args.hubName, hubVersion: String(hubVersion), classSideRemodelTable: bridgeDeclaration.classSideRemodelTable });" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-REMODEL', conjunctId: 'b_resolvesToSpecificTuple', twinName: 'resolveToBareKey', fileName: GROUPING_FILE, find: "\t\t\tObject.keys(entry).forEach((oneField) => {\n\t\t\t\tif (oneField !== 'canonicalKey') {", replace: "\t\t\tObject.keys(entry).forEach((oneField) => {\n\t\t\t\tif (false && oneField !== 'canonicalKey') {" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-REMODEL', conjunctId: 'c_absentTargetIsOrphanRemodelTargetAbsent', twinName: 'silentlyPromote', fileName: FRAMEWORK_FILE, find: "\t\t\t\t\t\t\t\tdecisionRecordList.push({ ...baseRecord, resolution: null, objectStableId: null, predicate: null, reason: baseRecord.remodelApplied ? 'remodelTargetAbsent' : 'noCardUnderKey' });", replace: "\t\t\t\t\t\t\t\tdecisionRecordList.push({ ...baseRecord, resolution: null, objectStableId: null, predicate: null, reason: 'noCardUnderKey' });" });
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-REMODEL', conjunctId: 'e_classSideRowTurnsMismatchSpecified', twinName: 'classSideIgnored', fileName: GROUPING_FILE, find: '\tif (Array.isArray(classSideRemodelTable) && rewritten.domainId !== undefined) {', replace: '\tif (false && Array.isArray(classSideRemodelTable) && rewritten.domainId !== undefined) {' });

// ---------------------------------------------------------------------
// BG-QUALIFIER-WIDEN
// ---------------------------------------------------------------------
const widenConjunctList = [
	pureConjunct({ conjunctId: 'a_scalarReWidenedAtReadBoundary', title: "a card whose qualifierKeys arrives as a SCALAR string ('OV0001') is re-widened at the read boundary to ['OV0001']", twinNameList: ['skipReWiden'], judge: (scenario) => { const rules = scenario.frameworkMutationList.some((oneMutation) => oneMutation.modulePath.endsWith(RULES_FILE)) ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RULES_FILE), mutationList: scenario.frameworkMutationList }) : graphSeamRulesLib; const widened = rules.reWidenListSlots({ qualifierKeys: 'OV0001', qualifierNames: 'School' }); return { pass: JSON.stringify(widened.qualifierKeys) === JSON.stringify(['OV0001']) && JSON.stringify(widened.qualifierNames) === JSON.stringify(['School']), detail: JSON.stringify(widened) }; } }),
	runConjunct({ conjunctId: 'b_remodelToQualifiedCardSpecified', title: "the remodel's qualified target MATCHES the scalar-stored card (School.Name → toyhub:card/P000005.C1.OV0001) and the row is specified/remodel", twinNameList: ['skipReWiden'], judge: succeeded((runReport, outcome) => { const oneRecord = recordFor(outcome, 'toy:property/School.Name')[0]; return { pass: oneRecord !== undefined && oneRecord.classification === 'specified' && oneRecord.objectStableId === 'toyhub:card/P000005.C1.OV0001', detail: oneRecord ? `${oneRecord.classification} → ${oneRecord.objectStableId} (${oneRecord.judgedReason || oneRecord.reason || 'specified'})` : 'no record' }; }) }),
	pureConjunct({ conjunctId: 'c_emptyAndMultiElementPassThrough', title: '[] and a multi-element list pass through the widener unchanged (never wrapped again)', twinNameList: ['wrapListAgain'], judge: (scenario) => { const rules = scenario.frameworkMutationList.some((oneMutation) => oneMutation.modulePath.endsWith(RULES_FILE)) ? moduleDouble.loadWithMutations({ modulePath: path.join(scenarioLib.FRAMEWORK_DIR, RULES_FILE), mutationList: scenario.frameworkMutationList }) : graphSeamRulesLib; const emptyOne = rules.reWidenListSlots({ qualifierKeys: [] }); const multi = rules.reWidenListSlots({ qualifierKeys: ['A', 'B'] }); const blank = rules.reWidenListSlots({ qualifierKeys: '' }); return { pass: JSON.stringify(emptyOne.qualifierKeys) === '[]' && JSON.stringify(multi.qualifierKeys) === '["A","B"]' && JSON.stringify(blank.qualifierKeys) === '[]', detail: JSON.stringify([emptyOne.qualifierKeys, multi.qualifierKeys, blank.qualifierKeys]) }; } }),
];
['a_scalarReWidenedAtReadBoundary', 'b_remodelToQualifiedCardSpecified'].forEach((oneConjunctId) => {
	frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-QUALIFIER-WIDEN', conjunctId: oneConjunctId, twinName: 'skipReWiden', fileName: RULES_FILE, find: "\t\tif (!Array.isArray(widened[oneSlot])) {\n\t\t\twidened[oneSlot] = widened[oneSlot] === '' ? [] : [widened[oneSlot]];\n\t\t}", replace: "\t\tif (false && !Array.isArray(widened[oneSlot])) {\n\t\t\twidened[oneSlot] = widened[oneSlot] === '' ? [] : [widened[oneSlot]];\n\t\t}" });
});
frameworkMutationTwin({ registry: twinRegistry, gateId: 'BG-QUALIFIER-WIDEN', conjunctId: 'c_emptyAndMultiElementPassThrough', twinName: 'wrapListAgain', fileName: RULES_FILE, find: "\t\tif (!Array.isArray(widened[oneSlot])) {\n\t\t\twidened[oneSlot] = widened[oneSlot] === '' ? [] : [widened[oneSlot]];\n\t\t}", replace: "\t\twidened[oneSlot] = widened[oneSlot] === '' ? [] : [widened[oneSlot]];" });

const gateDeclarationList = [
	{ gateId: 'BG-CONFLICT', title: 'cross-plugin conflict — the store-side sibling lookup', conjunctList: conflictConjunctList },
	{ gateId: 'BG-VALUE', title: 'the value tier refused and counted', conjunctList: valueConjunctList },
	{ gateId: 'BG-REMODEL', title: 'the hub-owned remodel table', conjunctList: remodelConjunctList },
	{ gateId: 'BG-QUALIFIER-WIDEN', title: 'list slots re-widened at the read boundary', conjunctList: widenConjunctList },
];

runGateFamily(
	{ harness, familyName: 'BG-CONFLICT+BG-VALUE+BG-REMODEL+BG-QUALIFIER-WIDEN', gateDeclarationList, twinRegistry, makeSubject: scenarioLib.makeScenario, cloneSubject: scenarioLib.cloneScenario, expectedConjunctCount: 5 + 3 + 5 + 3 },
	() => harness.report(),
);
