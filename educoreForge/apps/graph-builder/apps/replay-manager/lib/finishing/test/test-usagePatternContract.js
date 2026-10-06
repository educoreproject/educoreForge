#!/usr/bin/env node
'use strict';

// test-usagePatternContract.js — gate for W-A-7 (V1-C21; campaign P2): UsagePattern carries graph-contract §5
// USAGE_PATTERN_FIELD_LIST, one exemplar starts at the passport (the gates and their verdicts), and the finish-time row
// count — the count that carries weight — is WRITTEN onto each pattern rather than folded into prose.
//
// PROVES:
//   (a) the emitted nodes carry every declared USAGE_PATTERN_FIELD_LIST name except finishTimeRowCount (a finish-time field)
//   (b) EXEMPLAR_LIST holds 'howWasThisGraphChecked', entered from GraphProvenance, reading ATTESTS -> BuildAttestation
//   (c) writeVerificationAttestation issues one `SET u.finishTimeRowCount = <n>` per pattern, before the attestation row
//   (d) it refuses when a pattern's update touches no node, and when the count map is absent, by name
// RED TWINS (in memory): passportExemplarRemoved (finisher) -> (b); finishTimeCountNotWritten (writer) -> (c);
// updateCountUnchecked (writer) -> (d).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');
const helpText = () => `
NAME
     ${moduleName} -- gate: UsagePattern's declared fields and its finish-time row count
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

const FINISHER_PATH = path.join(__dirname, '..', 'lib', 'usage-pattern-finisher.js');
const WRITER_PATH = path.join(__dirname, '..', 'passport-writer.js');
const doubleOrReal = (modulePath, mutationList) => (mutationList.length === 0 ? require(modulePath) : loadBuildJsDouble({ buildJsPath: modulePath, mutationList }));

const readQueryDouble = ({ cypher }, callback) => callback('', { records: /ATTESTS/.test(cypher) ? [] : [{ get: () => 'x' }] });
const writerRun = ({ mutationList, rowCountByPatternName, updatedCount = 1 }, done) => {
	const statementList = [];
	const runCypher = ({ cypher }, callback) => {
		statementList.push(cypher);
		callback('', { records: [{ get: (fieldName) => ({ attestationElementId: '4:x:9', edgeCount: 1, rowCount: 1, updatedCount })[fieldName] }] });
	};
	doubleOrReal(WRITER_PATH, mutationList)({ vocabulary, debugMappingSource: 'bridge-debug' }).writeVerificationAttestation({ runCypher, verdict: 'pass', detail: 'd', exemplarCount: 2, verifiedCount: 2, rowCountByPatternName }, (err) => done({ err: err || '', statementList }));
};

const conjunctJudgeByRefId = {
	a_emittedNodesCarryTheDeclaredFields: (mutationList, done) =>
		doubleOrReal(FINISHER_PATH, mutationList)({ vocabulary }).emit({ readQuery: readQueryDouble }, (err, result) => {
			const declaredNameList = vocabulary.USAGE_PATTERN_FIELD_LIST.map((oneRow) => oneRow.name).filter((oneName) => oneName !== 'finishTimeRowCount');
			const lackingList = ((result || {}).nodes || []).filter((oneNode) => declaredNameList.some((oneName) => oneNode.properties[oneName] === undefined)).map((oneNode) => oneNode.stableId);
			done({ pass: !err && result.nodes.length > 0 && lackingList.length === 0, detail: err || `${result.nodes.length} node(s); lacking: [${lackingList.join(', ')}]` });
		}),
	b_passportExemplarPresent: (mutationList, done) => {
		const exemplar = doubleOrReal(FINISHER_PATH, mutationList)({ vocabulary }).EXEMPLAR_LIST.find((oneExemplar) => oneExemplar.entryLabel === 'GraphProvenance');
		done({ pass: !!exemplar && exemplar.patternName === 'howWasThisGraphChecked' && /MATCH \(:GraphProvenance\)-\[:ATTESTS\]->\(a:BuildAttestation\)/.test(exemplar.cypher) && exemplar.zeroRowMeaning === 'defect', detail: exemplar ? exemplar.patternName : 'no exemplar enters from GraphProvenance' });
	},
	c_finishTimeCountWrittenPerPattern: (mutationList, done) =>
		writerRun({ mutationList, rowCountByPatternName: { whereDoIStart: 95, howWasThisGraphChecked: 5 } }, ({ err, statementList }) => {
			const setList = statementList.filter((oneStatement) => /SET u\.finishTimeRowCount = /.test(oneStatement));
			const attestationIndex = statementList.findIndex((oneStatement) => /writtenOnChannel/.test(oneStatement));
			const pass = !err && setList.length === 2 && /\{patternName: 'howWasThisGraphChecked'\} \) ?SET u\.finishTimeRowCount = 5|\{patternName: 'howWasThisGraphChecked'\}\) SET u\.finishTimeRowCount = 5/.test(setList.join('\n')) && statementList.indexOf(setList[1]) < attestationIndex;
			done({ pass, detail: err || setList.join(' | ').slice(0, 220) });
		}),
	d_unwritableCountRefusedByName: (mutationList, done) =>
		writerRun({ mutationList, rowCountByPatternName: { whereDoIStart: 95 }, updatedCount: 0 }, (zeroOutcome) =>
			writerRun({ mutationList, rowCountByPatternName: undefined }, (absentOutcome) =>
				done({
					pass: /finishTimeRowCount for 'whereDoIStart' updated 0 UsagePattern node\(s\), not 1/.test(zeroOutcome.err) && /rowCountByPatternName is REQUIRED/.test(absentOutcome.err),
					detail: `zero: ${zeroOutcome.err.slice(0, 90) || 'written'} | absent: ${absentOutcome.err.slice(0, 60) || 'written'}`,
				}))),
};
const TWIN_LIST = [
	{ conjunctRefId: 'b_passportExemplarPresent', twinName: 'passportExemplarRemoved', find: "				entryLabel: NODE_LABELS.GRAPH_PROVENANCE,", replace: "				entryLabel: 'BuildAttestation'," },
	{ conjunctRefId: 'c_finishTimeCountWrittenPerPattern', twinName: 'finishTimeCountNotWritten', find: 'SET u.finishTimeRowCount = ${rowCount} RETURN', replace: 'SET u.finishTimeRowCountX = ${rowCount} RETURN' },
	{ conjunctRefId: 'd_unwritableCountRefusedByName', twinName: 'updateCountUnchecked', find: '						if (err || updatedCount !== 1) {', replace: '						if (err) {' },
	{ conjunctRefId: 'a_emittedNodesCarryTheDeclaredFields', twinName: 'zeroRowMeaningDropped', find: '							zeroRowMeaning: oneExemplar.zeroRowMeaning,', replace: '' },
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
