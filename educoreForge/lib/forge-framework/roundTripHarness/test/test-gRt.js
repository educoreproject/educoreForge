#!/usr/bin/env node
'use strict';

// test-gRt.js — G-RT (SPEC-forgeFramework-v1.md §10.1; §3.3 harness table; §6.6; Profile §8): the harness
// refuses no/blank semanticValidationLimit, refuses an absent outputPath, requires the five normative
// fields with finite counts and ASSERTS roundTripClean === (contentGapTotal === 0 && inventedTotal === 0);
// every LOST item carries lostCategory ∈ {explicitlyOmitted, contentGap} and lostTotal === the contentGap
// count; the verdict carries wall-clock, peak memory and the statement census (A8); the hermetic double
// (toy forge → graphDoubleFrom → emit → diff) is CLEAN (invented 0, contentGap 0); a synchronous emitter
// is refused. Twins: delete one fact from the double → lostTotal moves (the cheating detector); inject one
// invented statement → inventedTotal 1; delete the limit → refused; a hand-built verdict claiming clean
// with contentGap 1 → refused; a lost item without lostCategory → refused; a sync emitter → refused.
//
// Run: node lib/forge-framework/roundTripHarness/test/test-gRt.js [-verbose]

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- G-RT: the round-trip harness CONTRACT — refusals, the A13 identity, lostCategory, the A8 census, the hermetic double

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

EXIT STATUS
     0 all conjuncts PASS and every conjunct was observed RED under its twin;  1 otherwise.
`;
require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../test/testLib/harness')(moduleName);

const fs = require('fs');
const os = require('os');
const path = require('path');
const toyScenario = require('../../test/testSupport/toyScenario');
const moduleDouble = require('../../test/testSupport/moduleDouble');
const { runGateFamily } = require('../../test/testSupport/gateSuiteRunner');
const { makeTwinRegistry } = require('../twinRegistry');
const verdictAssemblerLib = require('../verdictAssembler');

const GATE_ID = 'G-RT';
const twinRegistry = makeTwinRegistry();
const HARNESS_PATH = path.join(__dirname, '..', 'roundTripHarness.js');
const ASSEMBLER_PATH = path.join(__dirname, '..', 'verdictAssembler.js');
const toyRoundTripPair = require(path.join(toyScenario.TOY_DIR, 'lib', 'toyRoundTripPair'))();
const scratchOutputPath = () => fs.mkdtempSync(path.join(os.tmpdir(), 'toyVerdict-'));

// the SUBJECT: one real toy forge result (built once), the pair, and the harness (real or double)
let cachedForgeResult = null;
const withForgeResult = (callback) => {
	if (cachedForgeResult) {
		callback(cachedForgeResult);
		return;
	}
	toyScenario.runScenario(toyScenario.makeScenario(), (runError, outcome) => {
		cachedForgeResult = outcome.result;
		callback(cachedForgeResult);
	});
};
const makeSubject = () => ({ harnessMutationList: [], validatorArgOverrides: {}, adjustForgeResult: null, outputPathOverride: undefined });
const cloneSubject = (subject) => ({ harnessMutationList: subject.harnessMutationList.slice(), validatorArgOverrides: { ...subject.validatorArgOverrides }, adjustForgeResult: subject.adjustForgeResult, outputPathOverride: subject.outputPathOverride });
const harnessFor = (subject) => (subject.harnessMutationList.length ? moduleDouble.loadWithMutations({ modulePath: HARNESS_PATH, mutationList: subject.harnessMutationList }) : require(HARNESS_PATH))();
const assemblerFor = (subject) => (subject.harnessMutationList.length ? moduleDouble.loadWithMutations({ modulePath: ASSEMBLER_PATH, mutationList: subject.harnessMutationList }) : verdictAssemblerLib);

// runValidator — construct (may refuse) → validateWithReader over the double (may refuse) → verdict
const runValidator = (subject, callback) => {
	withForgeResult((forgeResult) => {
		let harnessApi;
		let validator;
		try {
			harnessApi = harnessFor(subject);
			validator = harnessApi.validatorFrom({ forgeDeclaration: toyScenario.toyForgeDeclaration, ...toyRoundTripPair, verdictVersion: 'toyRoundTripVerdict-1', ...subject.validatorArgOverrides });
		} catch (constructError) {
			callback({ constructError: constructError.message });
			return;
		}
		const adjusted = subject.adjustForgeResult ? subject.adjustForgeResult({ nodes: forgeResult.nodes.slice(), edges: forgeResult.edges.slice() }) : forgeResult;
		const reader = harnessApi.graphDoubleFrom({ forgeResult: adjusted });
		validator.validateWithReader({ reader, snapshotPath: toyScenario.TOY_SNAPSHOT_DIR, outputPath: subject.outputPathOverride === undefined ? scratchOutputPath() : subject.outputPathOverride }, (validateError, verdict) => {
			callback({ validateError, verdict });
		});
	});
};

const refusalConjunct = ({ conjunctId, title, twinName, shape, regex }) => ({
	conjunctId,
	title,
	twinNameList: [twinName],
	evaluate: (subject, callback) => {
		shape(subject);
		runValidator(subject, (outcome) => {
			const refusalText = outcome.constructError || outcome.validateError || '';
			if (!refusalText) { callback('', { pass: false, detail: 'expected a refusal but the round trip SUCCEEDED' }); return; }
			callback('', { pass: regex.test(refusalText), detail: regex.test(refusalText) ? refusalText.slice(0, 160) : `refused for the WRONG reason: ${refusalText.slice(0, 200)}` });
		});
	},
});
const verdictConjunct = ({ conjunctId, title, twinName, judge }) => ({
	conjunctId,
	title,
	twinNameList: [twinName],
	evaluate: (subject, callback) => runValidator(subject, (outcome) => {
		if (outcome.constructError || outcome.validateError) { callback('', { pass: false, detail: outcome.constructError || outcome.validateError }); return; }
		callback('', judge(outcome.verdict));
	}),
});
const mutationTwin = ({ conjunctId, twinName, modulePath, find, replace }) => twinRegistry.register({ gateId: GATE_ID, conjunctId, twinName, leverKind: 'productionMutation', shippedConfig: true, run: (subject) => { subject.harnessMutationList.push({ modulePath, find, replace }); return subject; } });
const subjectTwin = ({ conjunctId, twinName, leverKind, mutate }) => twinRegistry.register({ gateId: GATE_ID, conjunctId, twinName, leverKind, shippedConfig: true, run: (subject) => { mutate(subject); return subject; } });

const conjunctList = [
	verdictConjunct({ conjunctId: 'hermeticDoubleClean', title: 'hermetic double: toy forge → graphDoubleFrom → emit → diff is CLEAN (inventedTotal 0, contentGapTotal 0, roundTripClean true; explicitlyOmitted 1 — the declared unmodelled note text)', twinName: 'deleteOneFactFromDouble', judge: (verdict) => ({ pass: verdict.inventedTotal === 0 && verdict.contentGapTotal === 0 && verdict.roundTripClean === true && verdict.explicitlyOmittedTotal === 1, detail: `invented ${verdict.inventedTotal}, contentGap ${verdict.contentGapTotal}, explicitlyOmitted ${verdict.explicitlyOmittedTotal}, clean ${verdict.roundTripClean}` }) }),
	verdictConjunct({ conjunctId: 'inventedIsZero', title: 'inventedTotal EQUALS 0 (an invented statement is a lie the graph tells)', twinName: 'injectOneInventedStatement', judge: (verdict) => ({ pass: verdict.inventedTotal === 0, detail: `inventedTotal ${verdict.inventedTotal}${verdict.inventedList.length ? ` (${verdict.inventedList[0].statementKey})` : ''}` }) }),
	verdictConjunct({ conjunctId: 'a13IdentityAsserted', title: 'roundTripClean === (contentGapTotal === 0 && inventedTotal === 0) — the A13 identity, ASSERTED', twinName: 'assemblerBreaksIdentity', judge: (verdict) => ({ pass: verdict.roundTripClean === (verdict.contentGapTotal === 0 && verdict.inventedTotal === 0), detail: `clean ${verdict.roundTripClean}, contentGap ${verdict.contentGapTotal}, invented ${verdict.inventedTotal}` }) }),
	verdictConjunct({ conjunctId: 'lostCategoryAndLostTotal', title: 'every LOST item carries lostCategory ∈ {explicitlyOmitted, contentGap} and lostTotal EQUALS the contentGap count', twinName: 'lostTotalCountsEverything', judge: (verdict) => { const offender = verdict.lostList.find((oneLost) => ['explicitlyOmitted', 'contentGap'].indexOf(oneLost.lostCategory) === -1); const contentGapCount = verdict.lostList.filter((oneLost) => oneLost.lostCategory === 'contentGap').length; return { pass: offender === undefined && verdict.lostTotal === contentGapCount, detail: offender ? `lost item without category: ${offender.statementKey}` : `lostTotal ${verdict.lostTotal} = contentGap count ${contentGapCount}; explicitlyOmitted ${verdict.explicitlyOmittedTotal}` }; } }),
	verdictConjunct({ conjunctId: 'a8CensusPresent', title: 'the verdict carries wall-clock, peak memory and the statement census (A8), every count naming the two quantities compared', twinName: 'dropCensus', judge: (verdict) => ({ pass: typeof verdict.census.wallClockMs === 'number' && typeof verdict.census.peakMemoryBytes === 'number' && verdict.census.statementCensus.sourceStatementCount === 20 && verdict.census.statementCensus.graphStatementCount === 19 && typeof verdict.census.statementCensus.comparisonBasis === 'string', detail: JSON.stringify(verdict.census.statementCensus) }) }),
	verdictConjunct({ conjunctId: 'fiveNormativeFieldsFinite', title: 'the five normative fields are present with finite counts and semanticValidationLimit is carried non-blank', twinName: 'nanCount', judge: (verdict) => { const shape = verdictAssemblerLib.verifyVerdictShape(verdict); return { pass: shape.error === '' && ['inventedTotal', 'lostTotal', 'contentGapTotal', 'explicitlyOmittedTotal'].every((oneName) => Number.isFinite(verdict[oneName])), detail: shape.error || 'shape verified' }; } }),
	refusalConjunct({ conjunctId: 'blankLimitRefused', title: 'a validator declaring a blank semanticValidationLimit is refused at construction', twinName: 'disableLimitCheck', shape: (subject) => { subject.validatorArgOverrides.semanticValidationLimit = '   '; }, regex: /declares no semanticValidationLimit/ }),
	refusalConjunct({ conjunctId: 'absentOutputPathRefused', title: 'an absent outputPath is refused (a verdict MUST NOT be producible with nothing on disk)', twinName: 'disableOutputPathCheck', shape: (subject) => { subject.outputPathOverride = null; }, regex: /outputPath is absent/ }),
	refusalConjunct({ conjunctId: 'syncEmitterRefused', title: 'a synchronous emitter (arity 1, returns statements) is refused (E3)', twinName: 'disableEmitterArityCheck', shape: (subject) => { subject.validatorArgOverrides.emitFromGraph = ({ reader }) => ({ statements: new Map() }); }, regex: /emitFromGraph must be emitFromGraph\(\{ reader \}, callback\) — arity 2/ }),
	{
		conjunctId: 'handBuiltVerdictRefusals',
		title: 'verifyVerdictShape refuses a verdict claiming roundTripClean true with contentGapTotal 1, and a lost item without lostCategory',
		twinNameList: ['disableShapeChecks'],
		evaluate: (subject, callback) => {
			const assembler = assemblerFor(subject);
			const baseVerdict = { roundTripClean: true, inventedTotal: 0, lostTotal: 1, contentGapTotal: 1, explicitlyOmittedTotal: 0, semanticValidationLimit: 'x', lostList: [{ statementKey: 'k', lostCategory: 'contentGap' }], census: { wallClockMs: 1, peakMemoryBytes: 1, statementCensus: {} } };
			const identityBroken = assembler.verifyVerdictShape(baseVerdict);
			const noCategory = assembler.verifyVerdictShape({ ...baseVerdict, roundTripClean: false, lostList: [{ statementKey: 'k' }] });
			const pass = /A13 identity broken/.test(identityBroken.error || '') && /carries lostCategory undefined/.test(noCategory.error || '');
			callback('', { pass, detail: `identity: ${identityBroken.error || 'ACCEPTED'}; category: ${noCategory.error || 'ACCEPTED'}` });
		},
	},
];

subjectTwin({ conjunctId: 'hermeticDoubleClean', twinName: 'deleteOneFactFromDouble', leverKind: 'productionMutation', mutate: (subject) => { subject.adjustForgeResult = ({ nodes, edges }) => ({ nodes: nodes.filter((oneNode) => oneNode.stableId !== 'toy:value/GenderCode.X'), edges }); } });
subjectTwin({ conjunctId: 'inventedIsZero', twinName: 'injectOneInventedStatement', leverKind: 'productionMutation', mutate: (subject) => { subject.adjustForgeResult = ({ nodes, edges }) => ({ nodes: nodes.concat([{ ...nodes[nodes.length - 1], stableId: 'toy:support/Invented', properties: { ...nodes[nodes.length - 1].properties, name: 'Invented' } }]), edges }); } });
// the identity twin needs a NON-clean round trip to bite (on a clean one `true` IS the identity): delete a
// fact from the double AND make the assembler claim clean regardless → the identity breaks → refused/red
twinRegistry.register({ gateId: GATE_ID, conjunctId: 'a13IdentityAsserted', twinName: 'assemblerBreaksIdentity', leverKind: 'productionMutation', shippedConfig: true, run: (subject) => { subject.adjustForgeResult = ({ nodes, edges }) => ({ nodes: nodes.filter((oneNode) => oneNode.stableId !== 'toy:value/GenderCode.X'), edges }); subject.harnessMutationList.push({ modulePath: ASSEMBLER_PATH, find: '\t\troundTripClean: contentGapTotal === 0 && inventedTotal === 0,', replace: '\t\troundTripClean: true,' }); return subject; } });
mutationTwin({ conjunctId: 'lostCategoryAndLostTotal', twinName: 'lostTotalCountsEverything', modulePath: ASSEMBLER_PATH, find: '\t\tlostTotal: contentGapTotal,', replace: '\t\tlostTotal: diff.lostList.length,' });
mutationTwin({ conjunctId: 'a8CensusPresent', twinName: 'dropCensus', modulePath: ASSEMBLER_PATH, find: '\t\t\t\tsourceStatementCount: sourceStatements.size,', replace: '\t\t\t\tsourceStatementCount: -1,' });
mutationTwin({ conjunctId: 'fiveNormativeFieldsFinite', twinName: 'nanCount', modulePath: ASSEMBLER_PATH, find: '\t\tinventedTotal,\n\t\tlostTotal: contentGapTotal,', replace: '\t\tinventedTotal: NaN,\n\t\tlostTotal: contentGapTotal,' });
mutationTwin({ conjunctId: 'blankLimitRefused', twinName: 'disableLimitCheck', modulePath: HARNESS_PATH, find: "\t\t\tif (typeof semanticValidationLimit !== 'string' || semanticValidationLimit.trim().length === 0) {", replace: "\t\t\tif (false && (typeof semanticValidationLimit !== 'string' || semanticValidationLimit.trim().length === 0)) {" });
mutationTwin({ conjunctId: 'absentOutputPathRefused', twinName: 'disableOutputPathCheck', modulePath: HARNESS_PATH, find: "\t\t\t\tif (typeof outputPath !== 'string' || outputPath.length === 0) {", replace: "\t\t\t\tif (false && (typeof outputPath !== 'string' || outputPath.length === 0)) {\n\t\t\t\t\t// (twin)\n\t\t\t\t}\n\t\t\t\tif (typeof outputPath !== 'string' || outputPath.length === 0) {\n\t\t\t\t\toutputPath = require('os').tmpdir();\n\t\t\t\t}\n\t\t\t\tif (false) {" });
mutationTwin({ conjunctId: 'syncEmitterRefused', twinName: 'disableEmitterArityCheck', modulePath: HARNESS_PATH, find: "\t\t\tif (typeof emitFromGraph !== 'function' || emitFromGraph.length !== 2) {", replace: "\t\t\tif (typeof emitFromGraph !== 'function') {" });
mutationTwin({ conjunctId: 'handBuiltVerdictRefusals', twinName: 'disableShapeChecks', modulePath: ASSEMBLER_PATH, find: '\tif (verdict.roundTripClean !== (verdict.contentGapTotal === 0 && verdict.inventedTotal === 0)) {', replace: '\tif (false && verdict.roundTripClean !== (verdict.contentGapTotal === 0 && verdict.inventedTotal === 0)) {' });

const gateDeclarationList = [{ gateId: GATE_ID, title: 'the round-trip harness contract', conjunctList }];
runGateFamily({ harness, familyName: GATE_ID, gateDeclarationList, twinRegistry, makeSubject, cloneSubject, expectedConjunctCount: 10, expectedTwinCount: 10 }, () => harness.report());
