#!/usr/bin/env node
'use strict';

// test-passportContract.js — gate for W-A-3 (V1-C02, V1-C03, V1-C23, V1-C24; campaign P2): the passport writer writes the
// passport DECLARED by graph-contract §3 PASSPORT_FIELD_LIST, its SET lines generated from the declaration, and refuses by
// name whatever would make a field unwritable. Pure: a runCypher double answers each census and records every statement.
//
// PROVES:
//   (a) every required finish-written field appears as `p.<name> =` in the MERGE, with the census values
//       (voyage-4-large x 1024, the judge identity, the recipe, both index names, the contract sha, the five engine versions)
//   (b) refusals by name: no graphName; an engineVersions member missing; two embedding models; two vector widths;
//       no ManifestRecipe row; a VECTOR index named off another graph; a contract sha that is not 64 hex
//   (c) the round trip refuses when keys(p) comes back without a required name
//   (d) a vector-less graph writes embeddingBasis and REMOVEs the model/width pair; no decision block writes
//       frameworkFingerprintBasis and REMOVEs frameworkFingerprint
// RED TWINS (in memory, loadBuildJsDouble on passport-writer.js):
//   setLineDropped — the generated SET line never pushed -> (a) red
//   graphNameCheckRemoved — the graphName refusal gone -> (b) red
//   modelCountUnchecked — two models admitted -> (b) red
//   roundTripUnchecked — the read-back filter emptied -> (c) red
//   alternativeNotRemoved — the REMOVE clause dropped -> (d) red

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate: the passport is written as graph-contract §3 declares it
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;

require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../../../../../test/testLib/harness')(moduleName);
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
const { loadBuildJsDouble } = require('../../../../../../../lib/bridge-framework/test/testSupport/bridgeTwinFactories');

const WRITER_PATH = path.join(__dirname, '..', 'passport-writer.js');
const writerFor = (mutationList) => (mutationList.length === 0 ? require(WRITER_PATH) : loadBuildJsDouble({ buildJsPath: WRITER_PATH, mutationList }))({ vocabulary, debugMappingSource: 'bridge-debug' });

const GRAPH_NAME = 'DEV_gb_materialize_1_1';
const MANIFEST_REF_ID = 'e'.repeat(64);
const CONTRACT_SHA = vocabulary.graphContractSha256();
const ENGINE_VERSIONS = { replayManager: 'finish/1', replayEngine: 'a'.repeat(64), serializer: '1', forgeFramework: 'b'.repeat(64), bridgeFramework: 'c'.repeat(64) };
const recordOf = (fieldValueByName) => ({ get: (fieldName) => fieldValueByName[fieldName] });

const DEFAULT_ANSWER = Object.freeze({
	embeddingModelVersionList: ['voyage-4-large'],
	embeddingWidthList: [1024],
	textEmbeddingWidthList: [1024],
	recipeRowList: [{ recipeHash: 'd'.repeat(64), recipeName: 'goldJevFresh' }],
	indexRowList: [
		{ name: `${GRAPH_NAME}_embedText_vector`, labelsOrTypes: ['DmeEmbedText'], properties: ['textEmbedding'] },
		{ name: `${GRAPH_NAME}_vector`, labelsOrTypes: ['ForgedNode'], properties: ['embedding'] },
	],
	droppedWrittenKeyList: [],
});

// runCypherDouble — answers each statement the writer issues; the MERGE's keys(p) is read off the SET text it was sent
const runCypherDouble = (answerOverride = {}) => {
	const answer = { ...DEFAULT_ANSWER, ...answerOverride };
	const statementList = [];
	const runCypher = ({ cypher }, callback) => {
		statementList.push(cypher);
		const reply = (rowList) => callback('', { records: rowList.map(recordOf) });
		if (/AS contentNodeCount/.test(cypher)) return reply([{ contentNodeCount: 243796, standardCount: 10, standardsIncluded: ['CEDS', 'SIF260928'] }]);
		if (/AS contentEdgeCount/.test(cypher)) return reply([{ contentEdgeCount: 641000 }]);
		if (/AS tierCount/.test(cypher)) return reply([{ edgeType: 'EXACT_MATCH', provenanceTier: null, mappingKind: 'inferred', mappingSource: 'bridge-jev', tierCount: 12681 }]);
		if (/AS embeddingModelVersionList/.test(cypher)) return reply([{ embeddingModelVersionList: answer.embeddingModelVersionList, embeddingWidthList: answer.embeddingWidthList, textEmbeddingWidthList: answer.textEmbeddingWidthList }]);
		if (/AS judgeIdentityList/.test(cypher)) return reply([{ judgeIdentityList: ['jev:jev-1.13.0:data:rel-04bab2bc4b28'], rendererVersionList: ['bridgeEvidenceRenderer-derivedJudgeSlot-v1'] }]);
		if (/AS recipeHash/.test(cypher)) return reply(answer.recipeRowList);
		if (/^SHOW INDEXES/.test(cypher)) return reply(answer.indexRowList);
		if (/MERGE \(p:`GraphProvenance`/.test(cypher)) {
			const writtenKeyList = ['passportKey'].concat((cypher.match(/p\.`([A-Za-z0-9]+)` =/g) || []).map((oneMatch) => /`([A-Za-z0-9]+)`/.exec(oneMatch)[1])).filter((oneName) => answer.droppedWrittenKeyList.indexOf(oneName) === -1);
			return reply([{ passportElementId: '4:x:1', writtenKeyList }]);
		}
		if (/MERGE \(p\)-\[e:/.test(cypher)) return reply([{ edgeCount: 1 }]);
		if (/AS passportCount/.test(cypher)) return reply([{ passportCount: 1, unstampedCount: 0 }]);
		callback(`unexpected statement: ${cypher.slice(0, 80)}`);
	};
	return { runCypher, statementList };
};

const writeWith = ({ mutationList = [], answerOverride, writeOverride = {} }, done) => {
	const cypherDouble = runCypherDouble(answerOverride);
	writerFor(mutationList).write(
		{ runCypher: cypherDouble.runCypher, manifestRefId: MANIFEST_REF_ID, graphName: GRAPH_NAME, engineVersions: ENGINE_VERSIONS, graphContractSha256: CONTRACT_SHA, frameworkFingerprintList: ['f'.repeat(64)], builtAt: '2026-10-06T00:00:00.000Z', ...writeOverride },
		(err, report) => done({ err: err || '', report, mergeText: cypherDouble.statementList.find((oneStatement) => /MERGE \(p:`GraphProvenance`/.test(oneStatement)) || '' }),
	);
};

const REFUSAL_CASE_LIST = [
	{ caseName: 'noGraphName', writeOverride: { graphName: undefined }, pattern: /a graphName is REQUIRED/ },
	{ caseName: 'engineVersionMissing', writeOverride: { engineVersions: { ...ENGINE_VERSIONS, forgeFramework: undefined } }, pattern: /engineVersions lacks 'forgeFramework'/ },
	{ caseName: 'twoModels', answerOverride: { embeddingModelVersionList: ['voyage-3', 'voyage-4-large'] }, pattern: /2 distinct embeddingModelVersion value\(s\) \[voyage-3, voyage-4-large\]/ },
	{ caseName: 'twoWidths', answerOverride: { textEmbeddingWidthList: [512] }, pattern: /2 distinct width\(s\) \[512, 1024\]/ },
	{ caseName: 'noRecipe', answerOverride: { recipeRowList: [] }, pattern: /the ManifestRecipe for e+ is absent/ },
	{ caseName: 'indexOffContract', answerOverride: { indexRowList: [{ name: 'replay_vector', labelsOrTypes: ['ForgedNode'], properties: ['embedding'] }] }, pattern: /'replay_vector' is not the name graph-contract §10 declares/ },
	{ caseName: 'contractShaMalformed', writeOverride: { graphContractSha256: 'abc' }, pattern: /graphContractSha256 is REQUIRED as 64 hex/ },
];

const conjunctJudgeByRefId = {
	a_everyRequiredFieldIsSet: (mutationList, done) =>
		writeWith({ mutationList }, ({ err, mergeText }) => {
			const requiredNameList = vocabulary.PASSPORT_FIELD_LIST.filter((oneRow) => oneRow.required && oneRow.writer.split('+').indexOf('finish') !== -1).map((oneRow) => oneRow.name);
			const unsetList = requiredNameList.filter((oneName) => mergeText.indexOf(`p.\`${oneName}\` = `) === -1);
			const valuesLand = /p\.`embeddingModelVersion` = 'voyage-4-large'/.test(mergeText) && /p\.`embeddingDims` = 1024/.test(mergeText) && mergeText.indexOf(`p.\`graphContractSha256\` = '${CONTRACT_SHA}'`) !== -1 && /p\.`judgeIdentityList` = \['jev:jev-1\.13\.0:data:rel-04bab2bc4b28'\]/.test(mergeText) && mergeText.indexOf(`p.\`vectorIndexNameList\` = ['${GRAPH_NAME}_embedText_vector', '${GRAPH_NAME}_vector']`) !== -1;
			done({ pass: !err && unsetList.length === 0 && valuesLand, detail: err || (unsetList.length ? `unset: ${unsetList.join(', ')}` : `values land ${valuesLand}`) });
		}),
	b_unwritableFieldsRefusedByName: (mutationList, done) => {
		const outcomeList = [];
		const runCase = (caseIndex) => {
			if (caseIndex >= REFUSAL_CASE_LIST.length) {
				const failedList = outcomeList.filter((oneOutcome) => !oneOutcome.refused);
				done({ pass: failedList.length === 0, detail: failedList.length ? `not refused: ${failedList.map((oneOutcome) => `${oneOutcome.caseName} (${oneOutcome.err.slice(0, 80) || 'written'})`).join('; ')}` : `${outcomeList.length} cases refused by name` });
				return;
			}
			const oneCase = REFUSAL_CASE_LIST[caseIndex];
			writeWith({ mutationList, answerOverride: oneCase.answerOverride, writeOverride: oneCase.writeOverride }, ({ err }) => {
				outcomeList.push({ caseName: oneCase.caseName, err, refused: oneCase.pattern.test(err) });
				runCase(caseIndex + 1);
			});
		};
		runCase(0);
	},
	c_readBackWithoutARequiredNameRefused: (mutationList, done) =>
		writeWith({ mutationList, answerOverride: { droppedWrittenKeyList: ['embeddingDims'] } }, ({ err }) =>
			done({ pass: /read back WITHOUT required field\(s\) embeddingDims/.test(err), detail: err || 'written although the read-back lacked embeddingDims' })),
	d_alternativesWrittenAndTheirPairRemoved: (mutationList, done) =>
		writeWith({ mutationList, answerOverride: { embeddingModelVersionList: [], embeddingWidthList: [], textEmbeddingWidthList: [], indexRowList: [] }, writeOverride: { frameworkFingerprintList: [] } }, ({ err, mergeText }) => {
			const pass = !err && /p\.`embeddingBasis` = 'noVectors:/.test(mergeText) && /p\.`frameworkFingerprintBasis` = 'no bridge run report/.test(mergeText) && /REMOVE p\.`embeddingModelVersion`, p\.`embeddingDims`, p\.`frameworkFingerprint`/.test(mergeText);
			done({ pass, detail: err || mergeText.split('\n').filter((oneLine) => /Basis|REMOVE/.test(oneLine)).join(' | ').slice(0, 300) });
		}),
};

const TWIN_LIST = [
	{ conjunctRefId: 'a_everyRequiredFieldIsSet', twinName: 'setLineDropped', find: '				setLineList.push(`p.\\`${oneRow.name}\\` = ${CYPHER_LITERAL_BY_TYPE[oneRow.type](oneValue)}`);', replace: '				void 0;' },
	{ conjunctRefId: 'b_unwritableFieldsRefusedByName', twinName: 'graphNameCheckRemoved', find: "			if (typeof graphName !== 'string' || !graphName.trim()) {", replace: '			if (false) {' },
	{ conjunctRefId: 'b_unwritableFieldsRefusedByName', twinName: 'modelCountUnchecked', find: '			if (modelList.length !== 1) {', replace: '			if (false) {' },
	{ conjunctRefId: 'c_readBackWithoutARequiredNameRefused', twinName: 'roundTripUnchecked', find: "const unwrittenNameList = setPlan.requiredNameList.filter((oneName) => writtenKeyList.indexOf(oneName) === -1);", replace: 'const unwrittenNameList = [];' },
	{ conjunctRefId: 'd_alternativesWrittenAndTheirPairRemoved', twinName: 'alternativeNotRemoved', find: "				const removeClause = setPlan.removeNameList.length ?", replace: "				const removeClause = false ?" },
];

const refIdList = Object.keys(conjunctJudgeByRefId);
const runSequence = (stepList, whenDone) => {
	const nextStep = (stepIndex) => (stepIndex >= stepList.length ? whenDone() : stepList[stepIndex](() => nextStep(stepIndex + 1)));
	nextStep(0);
};

harness.section('BASELINE — the real passport writer passes every conjunct');
runSequence(
	refIdList.map((oneRefId) => (stepDone) => conjunctJudgeByRefId[oneRefId]([], (verdict) => { harness.ok(`${oneRefId} PASS`, verdict.pass, verdict.detail); stepDone(); })),
	() => {
		harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a writer double (in memory)');
		harness.ok('every conjunct has at least one twin', refIdList.every((oneRefId) => TWIN_LIST.some((oneTwin) => oneTwin.conjunctRefId === oneRefId)));
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
