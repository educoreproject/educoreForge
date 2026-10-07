#!/usr/bin/env node
'use strict';

// test-embeddingCoverageAttestation.js — gate for W-A-11 (V1-C44, PLAN B1/G4; campaign P2): embedding coverage is a
// channel-A BuildAttestation row, counted over the materialised graph against the manifest blocks' own embedder identity.
//
// PROVES:
//   (a) four zero counts -> pass, missingVectorTotal 0, the detail naming the model and width
//   (b) searchTextWithoutVector 1 -> fail, missingVectorTotal 1, the count in the detail
//   (c) blocks carrying no embedder identity (a --vectorize=false manifest, embeddingDims null) -> notRun with the reason
//   (d) blocks declaring two identities are REFUSED by name; a header line that is not JSON is REFUSED by name
//   (e) the materialize tail hands the runner's row to finish as a gateResults member, beside fidelity and roundTrip
//   (f) the census Cypher reads all four counts (and the twin integration-forge assertion it replaces is NOT here)
// RED TWINS (in memory): failBranchRemoved (gate) -> (b); tailDropsCoverageRow (build.js) -> (e); identityCheckRemoved
// (gate: two identities admitted) -> (d).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: the embeddingCoverage BuildAttestation row
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../test/testLib/harness')(moduleName);

const path = require('path');
const { loadBuildJsDouble } = require('../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const GATE_PATH = path.join(__dirname, '..', 'lib', 'embedding-coverage-gate.js');
const BUILD_JS_PATH = path.join(__dirname, '..', 'lib', 'build.js');
const doubleOrReal = (modulePath, mutationList) => (mutationList.length === 0 ? require(modulePath) : loadBuildJsDouble({ buildJsPath: modulePath, mutationList }));
const silentXLog = { status() {}, error() {}, verbose() {}, result() {} };

const IDENTITY = { embeddingModelVersion: 'voyage-4-large', embeddingDims: 1024 };
const blockWith = (header) => `${JSON.stringify({ kind: 'header', blockType: 'standardBase', ...header })}\n{"kind":"node"}`;
const ZERO_ROW = { searchTextWithoutVector: 0, cardWithoutVector: 0, textWithoutVector: 0, vectorWithoutSearchText: 0 };

const runMaterialize = (mutationList, embeddingCoverageGateRunner, done) => {
	const finishCallList = [];
	const replayDouble = {
		create: (spec, callback) => callback('', { graphName: 'DEV_embeddingCoverageDouble', boltUrl: 'bolt://double:1' }),
		init: (spec, callback) => callback('', { legacyStringIntegerTotal: 0, legacyStringIntegerCountBySource: {} }), // ⟪P3, ruling B⟫ the replay report's legacy count
		delete: (graphHandle, callback) => callback(''),
		finish: (spec, callback) => {
			finishCallList.push(spec);
			callback('', { passportElementId: 'double:passport', writeCount: 1, xorVerified: true, applied: [] });
		},
	};
	doubleOrReal(BUILD_JS_PATH, mutationList).materializeSchemaBlocks(
		{
			xLog: silentXLog, replay: replayDouble, resolvedSchemaBlocks: [blockWith(IDENTITY)], manifestId: 'double-manifest', memberCount: 1, standardTokens: [],
			commandLineParameters: { switches: {}, values: {} },
			fidelityGateRunner: (spec, callback) => callback('', { gate: 'fidelity', verdict: 'notRun', detail: 'double' }),
			storeResolver: () => {}, storeReader: { getManifest: () => {} },
			roundTripStageRunner: (spec, callback) => callback('', { stageRan: false, disposition: 'double: stage not run' }),
			roundTripStageSpec: { mode: 'double' }, frameworkFingerprintList: [], embeddingCoverageGateRunner, finishReportFilePath: null, forgeCensusGateRunner: (spec, callback) => callback('', { gate: 'forgeCensus', verdict: 'notRun', detail: 'double' }), forgeCensusSpec: null,
		},
		(materializeError) => done({ materializeError, gateResults: finishCallList.length ? finishCallList[0].gateResults : null }),
	);
};

const conjunctJudgeByRefId = {
	a_allZeroIsPass: (mutationList, done) => {
		const row = doubleOrReal(GATE_PATH, mutationList).embeddingCoverageRowFor({ censusRow: ZERO_ROW, embeddingIdentity: IDENTITY });
		done({ pass: row.verdict === 'pass' && row.missingVectorTotal === 0 && /voyage-4-large x 1024/.test(row.detail), detail: `${row.verdict}: ${row.detail}` });
	},
	b_oneMissingVectorIsFail: (mutationList, done) => {
		const row = doubleOrReal(GATE_PATH, mutationList).embeddingCoverageRowFor({ censusRow: { ...ZERO_ROW, searchTextWithoutVector: 1 }, embeddingIdentity: IDENTITY });
		done({ pass: row.verdict === 'fail' && row.missingVectorTotal === 1 && /searchTextWithoutVector 1/.test(row.detail), detail: `${row.verdict}: ${row.detail}` });
	},
	c_vectorlessIsNotRun: (mutationList, done) =>
		doubleOrReal(GATE_PATH, mutationList).runEmbeddingCoverageGate({ containerHandle: null, schemaBlockTextList: [blockWith({ embeddingDims: null }), { text: blockWith({}) }] }, (err, row) =>
			done({ pass: !err && row.verdict === 'notRun' && /vectorize=false/.test(row.detail), detail: err || `${row.verdict}: ${row.detail}` })),
	d_mixedOrUnreadableRefused: (mutationList, done) => {
		const gateLib = doubleOrReal(GATE_PATH, mutationList);
		const mixed = gateLib.embeddingIdentityFor([blockWith(IDENTITY), blockWith({ embeddingModelVersion: 'voyage-3', embeddingDims: 1024 })]);
		const unreadable = gateLib.embeddingIdentityFor(['not a header\n{}']);
		done({ pass: /declare 2 embedder identities/.test(mixed.error || '') && /carry no JSON header line/.test(unreadable.error || ''), detail: `mixed: ${mixed.error || JSON.stringify(mixed)} | unreadable: ${unreadable.error || JSON.stringify(unreadable)}` });
	},
	e_tailHandsTheRowToFinish: (mutationList, done) =>
		runMaterialize(mutationList, (spec, callback) => callback('', { gate: 'embeddingCoverage', verdict: 'pass', detail: 'double', missingVectorTotal: 0 }), ({ materializeError, gateResults }) =>
			done({ pass: !materializeError && Array.isArray(gateResults) && gateResults.map((oneRow) => oneRow.gate).join(',') === 'fidelity,roundTrip,embeddingCoverage,forgeCensus', detail: materializeError || JSON.stringify((gateResults || []).map((oneRow) => oneRow.gate)) })),
	f_censusReadsTheFourCounts: (mutationList, done) => {
		const gateLib = doubleOrReal(GATE_PATH, mutationList);
		const missingList = gateLib.COUNT_NAME_LIST.filter((oneName) => gateLib.EMBEDDING_COVERAGE_CENSUS_CYPHER.indexOf(`AS ${oneName}`) === -1);
		done({ pass: missingList.length === 0 && gateLib.COUNT_NAME_LIST.length === 4, detail: missingList.length ? `census lacks ${missingList.join(', ')}` : 'four counts' });
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'b_oneMissingVectorIsFail', modulePath: GATE_PATH, twinName: 'failBranchRemoved', find: 'verdict: missingVectorTotal === 0 ? vocabulary.BUILD_ATTESTATION_VERDICT.PASS : vocabulary.BUILD_ATTESTATION_VERDICT.FAIL,', replace: 'verdict: vocabulary.BUILD_ATTESTATION_VERDICT.PASS,' },
	{ conjunctRefId: 'e_tailHandsTheRowToFinish', modulePath: BUILD_JS_PATH, twinName: 'tailDropsCoverageRow', find: 'gateResults: [fidelityAttestation, roundTripRow, embeddingCoverageRow, forgeCensusRow],', replace: 'gateResults: [fidelityAttestation, roundTripRow, forgeCensusRow],' },
	{ conjunctRefId: 'd_mixedOrUnreadableRefused', modulePath: GATE_PATH, twinName: 'identityCheckRemoved', find: '	if (identityTextSet.size > 1) {', replace: '	if (false) {' },
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
