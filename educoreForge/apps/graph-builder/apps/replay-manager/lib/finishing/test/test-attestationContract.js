#!/usr/bin/env node
'use strict';

// test-attestationContract.js — gate for W-A-4 (V1-C17, V1-C18; campaign P2): every :BuildAttestation row has the shape
// graph-contract §4 declares, on each of its three channels, and the roundTrip row carries its totals so 'fail' is
// reachable. Pure: the finisher and the build's row composer are driven directly; Channel B through a runCypher double.
//
// PROVES:
//   (a) the channel-A finisher copies every declared roundTrip field (roundTripClean, inventedTotal, lostTotal,
//       explicitlyOmittedTotal, standardCount) from the supplied row, and only the fields declared for a gate
//   (b) every channel-A row carries the declared label set, writtenOnChannel 'channelA' and a note; the expected gates
//       are ATTESTATION_GATE_LIST_BY_CHANNEL.channelA, an unsupplied one reading notRun with verdictSupplied false
//   (c) build.js roundTripRowFor: ten clean standards -> pass with the summed totals; one standard roundTripClean false
//       -> fail naming that standard
//   (d) Channel B (usagePatternVerification) MERGEs on (:BuildAttestation {gate}) with writtenOnChannel 'channelB'
// RED TWINS (in memory): detailFieldsNotCopied (finisher) -> (a); channelTokenDropped (finisher) -> (b);
// failBranchRemoved (build.js) -> (c); channelBLabelLess (passport-writer) -> (d).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: every BuildAttestation row has graph-contract §4's shape
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;
require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });
const harness = require('../../../../../../../test/testLib/harness')(moduleName);

const path = require('path');
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
const { loadBuildJsDouble } = require('../../../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const FINISHER_PATH = path.join(__dirname, '..', 'lib', 'build-attestation-finisher.js');
const WRITER_PATH = path.join(__dirname, '..', 'passport-writer.js');
const BUILD_JS_PATH = path.join(__dirname, '..', '..', '..', '..', '..', 'lib', 'build.js');
const doubleOrReal = (modulePath, mutationList) => (mutationList.length === 0 ? require(modulePath) : loadBuildJsDouble({ buildJsPath: modulePath, mutationList }));

const ROUND_TRIP_FIELD_LIST = ['roundTripClean', 'inventedTotal', 'lostTotal', 'explicitlyOmittedTotal', 'standardCount'];
const stageReportWith = (standardRowList) => ({ stageRan: true, disposition: 'ran', summaryFilePath: '/tmp/roundTripStageSummary.json', standards: standardRowList });
const cleanRow = (token, explicitlyOmittedTotal) => ({ token, ran: true, roundTripClean: true, inventedTotal: 0, lostTotal: 0, explicitlyOmittedTotal });
const emitRows = (mutationList, gateResults, done) => doubleOrReal(FINISHER_PATH, mutationList)({ vocabulary }).emit({ gateResults }, (err, result) => done(err, result));

const conjunctJudgeByRefId = {
	a_declaredRoundTripFieldsCopied: (mutationList, done) => {
		const roundTripRow = require(BUILD_JS_PATH).roundTripRowFor(stageReportWith([cleanRow('ceds', 0), cleanRow('sif260928', 6586)]));
		emitRows(mutationList, [{ gate: 'fidelity', verdict: 'pass', detail: 'x', inventedTotal: 0, lostTotal: 99 }, roundTripRow], (err, result) => {
			const byGate = ((result || {}).nodes || []).reduce((soFar, oneNode) => ({ ...soFar, [oneNode.properties.gate]: oneNode.properties }), {});
			const roundTripProperties = byGate.roundTrip || {};
			const missingList = ROUND_TRIP_FIELD_LIST.filter((oneName) => roundTripProperties[oneName] === undefined);
			const fidelityLeak = (byGate.fidelity || {}).lostTotal !== undefined;
			done({ pass: !err && missingList.length === 0 && roundTripProperties.explicitlyOmittedTotal === 6586 && !fidelityLeak, detail: err || `missing [${missingList.join(', ')}]; fidelity carries lostTotal ${fidelityLeak}` });
		});
	},
	b_channelAShapeAndExpectedGates: (mutationList, done) =>
		emitRows(mutationList, [], (err, result) => {
			const nodeList = (result || {}).nodes || [];
			const declaredLabelText = vocabulary.ATTESTATION_LABEL_SET_BY_CHANNEL.channelA.slice().sort().join(',');
			const gateText = nodeList.map((oneNode) => oneNode.properties.gate).join(',');
			const pass = !err && gateText === vocabulary.ATTESTATION_GATE_LIST_BY_CHANNEL.channelA.slice().sort().join(',') &&
				nodeList.every((oneNode) => oneNode.labels.slice().sort().join(',') === declaredLabelText && oneNode.properties.writtenOnChannel === 'channelA' && typeof oneNode.properties.writtenOnChannelNote === 'string' && oneNode.properties.verdict === 'notRun' && oneNode.properties.verdictSupplied === false);
			done({ pass, detail: err || `gates ${gateText}; first ${JSON.stringify(nodeList[0] && { labels: nodeList[0].labels, writtenOnChannel: nodeList[0].properties.writtenOnChannel })}` });
		}),
	c_roundTripFailIsReachable: (mutationList, done) => {
		const { roundTripRowFor } = doubleOrReal(BUILD_JS_PATH, mutationList);
		const tenClean = roundTripRowFor(stageReportWith(['ceds', 'edfi', 'sif260928', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((oneToken) => cleanRow(oneToken, 1))));
		const oneDirty = roundTripRowFor(stageReportWith([cleanRow('ceds', 0), { ...cleanRow('edfi', 0), roundTripClean: false, lostTotal: 3 }]));
		const pass = tenClean.verdict === 'pass' && tenClean.standardCount === 10 && tenClean.explicitlyOmittedTotal === 10 && tenClean.roundTripClean === true &&
			oneDirty.verdict === 'fail' && /FAILED: edfi/.test(oneDirty.detail) && oneDirty.lostTotal === 3 && oneDirty.roundTripClean === false;
		done({ pass, detail: `ten: ${tenClean.verdict} | dirty: ${oneDirty.verdict} — ${oneDirty.detail.slice(0, 120)}` });
	},
	d_channelBMergesOnGate: (mutationList, done) => {
		const statementList = [];
		const runCypher = ({ cypher }, callback) => {
			statementList.push(cypher);
			callback('', { records: [{ get: (fieldName) => ({ attestationElementId: '4:x:9', edgeCount: 1, rowCount: 1, updatedCount: 1 })[fieldName] }] });
		};
		doubleOrReal(WRITER_PATH, mutationList)({ vocabulary, debugMappingSource: 'bridge-debug' }).writeVerificationAttestation({ runCypher, verdict: 'pass', detail: 'd', exemplarCount: 5, verifiedCount: 5, rowCountByPatternName: { whereDoIStart: 95 } }, (err) => {
			const mergeText = statementList.find((oneStatement) => /writtenOnChannel/.test(oneStatement)) || '';
			const pass = !err && /MERGE \(a:`BuildAttestation` \{gate: 'usagePatternVerification'\}\)/.test(mergeText) && /a\.writtenOnChannel = 'channelB'/.test(mergeText);
			done({ pass, detail: err || mergeText.replace(/\s+/g, ' ').slice(0, 200) });
		});
	},
};
const TWIN_LIST = [
	{ conjunctRefId: 'a_declaredRoundTripFieldsCopied', modulePath: FINISHER_PATH, twinName: 'detailFieldsNotCopied', find: '.filter((oneRow) => oneRow.gateList.indexOf(oneGateName) !== -1)', replace: '.filter(() => false)' },
	{ conjunctRefId: 'b_channelAShapeAndExpectedGates', modulePath: FINISHER_PATH, twinName: 'channelTokenDropped', find: '						writtenOnChannel: CHANNEL_NAME,', replace: '' },
	{ conjunctRefId: 'c_roundTripFailIsReachable', modulePath: BUILD_JS_PATH, twinName: 'failBranchRemoved', find: 'verdict: ranRowList.length > 0 && failedTokenList.length === 0 ? vocabulary.BUILD_ATTESTATION_VERDICT.PASS : vocabulary.BUILD_ATTESTATION_VERDICT.FAIL,', replace: 'verdict: vocabulary.BUILD_ATTESTATION_VERDICT.PASS,' },
	{ conjunctRefId: 'd_channelBMergesOnGate', modulePath: WRITER_PATH, twinName: 'channelBLabelLess', find: '					MERGE (a:\\`${attestationLabel}\\` {gate: ${cypherString(VERIFICATION_GATE_NAME)}})\n					ON CREATE SET', replace: '					MERGE (a {stableId: ${cypherString(stableId)}})\n					ON CREATE SET' },
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
		harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a module double (in memory)');
		harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), refIdList.slice().sort().join(','));
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
