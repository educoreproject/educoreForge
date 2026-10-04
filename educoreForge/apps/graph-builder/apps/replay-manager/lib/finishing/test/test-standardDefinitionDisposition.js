#!/usr/bin/env node
'use strict';

// test-standardDefinitionDisposition.js — the StandardDefinition's mappingDisposition is read from the mappingKind its
// mapping edges carry, NEVER from their relation type (lane P, mappingProvenance 2026-10-04). Before lane P an EXACT_MATCH
// made a standard 'authored': GOLD_EVAL_261002_jevFresh called 9 of its 10 standards authored while all 12,698 of their
// edges were Jev judgments. Pure: the finisher's shapeOne and emit, over rows a readQuery double returns.
//   (a) a standard with EXACT_MATCH edges whose every edge is inferred is 'inferred'
//   (b) the four kind-presence cases map to authored / inferred / authoredAndInferred / island
//   (c) a mapping edge with NO mappingKind is REFUSED by name, naming the standard
//   (d) the derivation cypher reads mappingKind
// RED TWINS, each observed: the pre-lane-P relation-type rule restored (a red); the refusal removed (c red); the cypher
// reading the relation instead (d red).

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gate: StandardDefinition.mappingDisposition comes from mappingKind, not the relation type
SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]
EXIT STATUS
     0 all assertions passed and every twin observed red;  1 otherwise.
`;

require('../../../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const harness = require('../../../../../../../test/testLib/harness')(moduleName);
const vocabulary = require('../../../../../../../lib/vocabulary/vocabulary');
const moduleDouble = require('../../../../../../../lib/forge-framework/test/testSupport/moduleDouble');

const FINISHER_PATH = path.join(__dirname, '..', 'lib', 'standard-definition-finisher.js');
const realFinisherFactory = require(FINISHER_PATH);
const finisherFor = (mutationList) => (mutationList.length === 0 ? realFinisherFactory : moduleDouble.loadWithMutations({ modulePath: FINISHER_PATH, mutationList }))({ vocabulary });

// a root row as the derivation query returns it; the counts are what the conjunct varies
const rootRow = ({ exactMappedProperties, authoredMappedNodeCount, inferredMappedNodeCount, unkindedMappingEdgeCount = 0 }) => ({
	sourceKey: 'Toy',
	standardKey: 'toy',
	standardName: 'Toy',
	version: '1',
	rootStableId: 'toy:root',
	propertyCount: 10,
	classCount: 2,
	optionValueCount: 0,
	exactMappedProperties,
	closeMappedProperties: 0,
	authoredMappedNodeCount,
	inferredMappedNodeCount,
	unkindedMappingEdgeCount,
	mappingEdgeTypes: ['EXACT_MATCH'],
});
const readQueryOver = (rowList) => (queryArguments, callback) => callback('', { records: rowList.map((oneRow) => ({ get: (fieldName) => oneRow[fieldName] })) });

const conjunctJudgeByRefId = {
	a_exactButInferredIsInferred: (finisher, done) => {
		const disposition = finisher.shapeOne(rootRow({ exactMappedProperties: 5, authoredMappedNodeCount: 0, inferredMappedNodeCount: 5 })).properties.mappingDisposition;
		done({ pass: disposition === 'inferred', detail: `five EXACT_MATCH edges, all inferred → '${disposition}'` });
	},
	b_fourCasesFromKindPresence: (finisher, done) => {
		const caseList = [
			[3, 0, 'authored'],
			[0, 3, 'inferred'],
			[3, 3, 'authoredAndInferred'],
			[0, 0, 'island'],
		];
		const faultList = caseList
			.map(([authoredMappedNodeCount, inferredMappedNodeCount, expected]) => ({ expected, got: finisher.shapeOne(rootRow({ exactMappedProperties: 0, authoredMappedNodeCount, inferredMappedNodeCount })).properties.mappingDisposition }))
			.filter((oneCase) => oneCase.got !== oneCase.expected);
		done({ pass: faultList.length === 0, detail: faultList.length === 0 ? 'all four' : faultList.map((oneCase) => `expected ${oneCase.expected} got ${oneCase.got}`).join('; ') });
	},
	c_unkindedEdgeRefusedByName: (finisher, done) => {
		finisher.emit({ readQuery: readQueryOver([rootRow({ exactMappedProperties: 2, authoredMappedNodeCount: 0, inferredMappedNodeCount: 0, unkindedMappingEdgeCount: 2 })]) }, (emitError) => {
			const refusedByName = typeof emitError === 'string' && /REFUSED: Toy \(2\) carry mapping edges with no mappingKind/.test(emitError);
			done({ pass: refusedByName, detail: emitError ? emitError.slice(0, 160) : 'emitted without refusing' });
		});
	},
	d_cypherReadsMappingKind: (finisher, done) => {
		const readsKind = finisher.DERIVATION_CYPHER.indexOf(`mkEdge.mappingKind = '${vocabulary.MAPPING_KIND.AUTHORED}'`) !== -1 && finisher.DERIVATION_CYPHER.indexOf(`mkEdge.mappingKind = '${vocabulary.MAPPING_KIND.INFERRED}'`) !== -1;
		done({ pass: readsKind, detail: readsKind ? 'reads mappingKind for both kinds' : 'the derivation cypher does not read mappingKind' });
	},
};

const TWIN_LIST = [
	{
		conjunctRefId: 'a_exactButInferredIsInferred',
		twinName: 'relationTypeRuleRestored',
		find: "MAPPING_DISPOSITION_BY_KIND_PRESENCE[`${authoredMappedNodeCount > 0}|${inferredMappedNodeCount > 0}`];",
		replace: "(Number(oneRow.exactMappedProperties || 0) > 0 ? 'authored' : MAPPING_DISPOSITION_BY_KIND_PRESENCE[`${authoredMappedNodeCount > 0}|${inferredMappedNodeCount > 0}`]);",
	},
	{
		conjunctRefId: 'b_fourCasesFromKindPresence',
		twinName: 'mixedReadAsAuthored',
		find: "'true|true': 'authoredAndInferred',",
		replace: "'true|true': 'authored',",
	},
	{ conjunctRefId: 'c_unkindedEdgeRefusedByName', twinName: 'refusalRemoved', find: '\t\t\t\tif (unkindedRowList.length > 0) {', replace: '\t\t\t\tif (false) {' },
	{
		conjunctRefId: 'd_cypherReadsMappingKind',
		twinName: 'cypherReadsRelation',
		find: "count(DISTINCT CASE WHEN mkEdge.mappingKind = '${MAPPING_KIND.AUTHORED}' THEN mk END)",
		replace: "count(DISTINCT CASE WHEN type(mkEdge) = 'EXACT_MATCH' THEN mk END)",
	},
];

const runJudge = (refId, finisher, callback) => conjunctJudgeByRefId[refId](finisher, callback);
const refIdList = Object.keys(conjunctJudgeByRefId);

harness.section('BASELINE — the real finisher passes every conjunct');
let baselineIndex = 0;
const nextBaseline = () => {
	if (baselineIndex >= refIdList.length) {
		runTwins();
		return;
	}
	const refId = refIdList[baselineIndex];
	baselineIndex += 1;
	runJudge(refId, finisherFor([]), (verdict) => {
		harness.ok(`${refId} PASS`, verdict.pass, verdict.detail);
		nextBaseline();
	});
};

const runTwins = () => {
	harness.section('THE TWIN SWEEP — every conjunct OBSERVED RED under a finisher double (in memory)');
	harness.equal('every conjunct has exactly one twin', TWIN_LIST.map((oneTwin) => oneTwin.conjunctRefId).sort().join(','), refIdList.slice().sort().join(','));
	let twinIndex = 0;
	const nextTwin = () => {
		if (twinIndex >= TWIN_LIST.length) {
			harness.report();
			return;
		}
		const oneTwin = TWIN_LIST[twinIndex];
		twinIndex += 1;
		moduleDouble.assertMutationApplies({ modulePath: FINISHER_PATH, find: oneTwin.find });
		runJudge(oneTwin.conjunctRefId, finisherFor([{ modulePath: FINISHER_PATH, find: oneTwin.find, replace: oneTwin.replace }]), (verdict) => {
			harness.ok(`${oneTwin.conjunctRefId} observed RED under '${oneTwin.twinName}'`, !verdict.pass, verdict.detail);
			harness.note(`RED-OBSERVED ${oneTwin.conjunctRefId} twin='${oneTwin.twinName}' → ${verdict.pass ? 'STILL PASSING' : 'FAIL'}: ${verdict.detail}`);
			nextTwin();
		});
	};
	nextTwin();
};

nextBaseline();
